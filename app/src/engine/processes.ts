// The processes Koppler starts: apps, tunnels and the canvas. Each runs detached, so it outlives the terminal or agent
// session that started it, writes its log to a file, and has a record that says how to find it and stop it.
import fs from 'node:fs';
import http from 'node:http';
import https from 'node:https';
import path from 'node:path';
import { execFileSync, spawn } from 'node:child_process';
import { fail, Failure } from '../failure.ts';
import { logsDir, stateDir } from '../paths.ts';
import { appEnv } from '../safe-env.ts';
import { redact } from '../scrub.ts';
import { keepPreviousLog } from './session.ts';
import { APP_ID } from '../ids.ts';
import { writeJson } from '../json-files.ts';

const PROCS = path.join(stateDir(), 'procs');
/** What a process started by Koppler can be called. */
export const NAME = APP_ID;
// How long an app with a port may take to answer: a build can take minutes.
const START_WAIT = Number(process.env['KOPPLER_START_WAIT']) * 1000 || 300000;

/** What Koppler keeps about a process it started. */
export interface ProcessRecord {
  name: string;
  pid: number;
  /** The command, as shown. */
  command: string;
  cwd: string;
  restart: boolean;
  port: number | null;
  /** The local address it listens on, when that is not every address or localhost. */
  bind?: string;
  /** The environment a stack app was started on. */
  env?: string;
  /** Commands that end what the process leaves behind: an app on a simulator, a container. */
  onStop: string[][];
  log: string;
  startedAt: string;
  psCommand: string;
  psStart: string;
}
/** What `koppler run` was asked for. */
/** When a started app is ready: a GET of this address answers, with `status` or any status below 400. */
export interface Ready {
  url: string;
  status?: number | undefined;
  /** Seconds. */
  timeout?: number | undefined;
}
export interface RunOptions {
  name: string;
  /** Empty for a stack app started by its id. */
  command: string[];
  restart: boolean;
  cwd?: string;
  port?: number;
  bind?: string;
  env?: string;
  device?: string;
  dryRun?: boolean;
  lan?: boolean;
  test?: boolean;
  onStop?: string[][];
  /** Started with stored secrets: the caller's code-loading variables are kept out of its environment. */
  holdsSecrets?: boolean;
  /** Settings for this start only, such as the address of a local app it calls. */
  setEnv?: Record<string, string>;
  /** An address, or a path on its port. */
  ready?: Ready;
}

/** A program's output, or nothing when it fails or is not there. */
export function sh(command: string, args: string[]): string {
  try {
    return execFileSync(command, args, { encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] }).trim();
  } catch {
    return '';
  }
}
export const sleep = (ms: number) => new Promise(resolve => setTimeout(resolve, ms));

/** A restart wrapper keeps flaky tunnels up; stopping kills the whole process group, wrapper included. */
export function commandFor(argv: string[], restart: boolean): string[] {
  const loop = 'while :; do "$@"; echo "koppler: exited with $?, restarting in 2s"; sleep 2; done';
  return restart ? ['sh', '-c', loop, 'sh', ...argv] : argv;
}

const SWITCHES: Record<string, Partial<RunOptions>> = {
  '--restart': { restart: true },
  '--dry-run': { dryRun: true },
  '--lan': { lan: true },
  '--test': { test: true },
  '--no-test': { test: false },
};
/** Reads `<name> [options] [-- <command...>]`; throws with the reason when it cannot. */
export function parseRun(args: string[]): RunOptions {
  const dash = args.indexOf('--');
  const head = dash < 0 ? args : args.slice(0, dash);
  const command = dash < 0 ? [] : args.slice(dash + 1);
  const options: RunOptions = { name: head[0] ?? '', command, restart: false };
  for (let at = 1; at < head.length; at++) {
    const option = head[at] ?? '';
    const value = () => head[++at] ?? '';
    if (Object.hasOwn(SWITCHES, option)) Object.assign(options, SWITCHES[option]);
    else if (option === '--cwd') options.cwd = value();
    else if (option === '--port') options.port = Number(value());
    else if (option === '--bind') options.bind = value();
    else if (option === '--env') options.env = value();
    else if (option === '--device') options.device = value();
    else if (option === '--ready') options.ready = { url: value() };
    else throw new Error(`unknown option ${option}`);
  }
  if (!NAME.test(options.name)) throw new Error('name must be lowercase letters, digits and dashes');
  if (dash >= 0 && command.length === 0) throw new Error('nothing to run after --');
  if (options.port !== undefined && !(options.port > 0 && options.port < 65536))
    throw new Error('--port must be a TCP port');
  if (options.bind !== undefined && !/^(localhost|127\.\d{1,3}\.\d{1,3}\.\d{1,3})$/.test(options.bind))
    throw new Error('--bind must be an address of this machine (localhost or 127.x.x.x)');
  return options;
}

const recordPath = (name: string) => path.join(PROCS, `${name}.json`);
export function readRecord(name: string): ProcessRecord | null {
  try {
    return JSON.parse(fs.readFileSync(recordPath(name), 'utf8')) as ProcessRecord;
  } catch {
    return null;
  }
}
/** Everything Koppler has started and not yet stopped, running or not. */
export function records(): ProcessRecord[] {
  try {
    const names = fs.readdirSync(PROCS).filter(file => file.endsWith('.json'));
    return names.map(file => readRecord(file.slice(0, -5))).filter(record => record !== null);
  } catch {
    return [];
  }
}

const psCommand = (pid: number) => sh('ps', ['-p', String(pid), '-o', 'command=']);
const psStart = (pid: number) => sh('ps', ['-p', String(pid), '-o', 'lstart=']);
/**
 * Whether the process of a record still runs. A pid alone can be reused by an unrelated process, so it must be the one
 * started then. Its start time says so; its command cannot, because it changes when a wrapper hands over to the app.
 */
export function alive(record: Pick<ProcessRecord, 'pid' | 'psStart' | 'psCommand'>): boolean {
  try {
    process.kill(record.pid, 0);
  } catch {
    return false;
  }
  return record.psStart ? psStart(record.pid) === record.psStart : psCommand(record.pid) === record.psCommand;
}

/**
 * What listens on a port. With an address of its own (a tunnel on 127.0.0.2), only what listens there or on every
 * address counts.
 */
export function listener(port: number, bind?: string): { pid: number; command: string | undefined } | null {
  const output = sh('lsof', ['-nP', `-iTCP:${String(port)}`, '-sTCP:LISTEN', '-Fpcn']);
  const own =
    bind && !['localhost', '127.0.0.1'].includes(bind) ? [`${bind}:${String(port)}`, `*:${String(port)}`] : null;
  // One block per process: its pid, its command, then the addresses it listens on.
  for (const block of output.split(/^(?=p\d)/m)) {
    const pid = /^p(\d+)/m.exec(block)?.[1];
    const addresses = [...block.matchAll(/^n(.+)/gm)].map(match => match[1] ?? '');
    if (pid && (!own || addresses.some(address => own.includes(address))))
      return { pid: Number(pid), command: /^c(.+)/m.exec(block)?.[1] };
  }
  return null;
}

/** The last lines of a log, with secrets masked. */
export function tailOf(file: string, lines: number): string {
  try {
    return redact(fs.readFileSync(file, 'utf8').trimEnd().split('\n').slice(-lines).join('\n'));
  } catch {
    return '';
  }
}
/** How long ago, as "12m" or "3h05m". */
export function uptime(since: string): string {
  const seconds = Math.floor((Date.now() - Date.parse(since)) / 1000);
  const minutes = Math.floor(seconds / 60);
  return seconds < 3600
    ? `${String(minutes)}m`
    : `${String(Math.floor(minutes / 60))}h${String(minutes % 60).padStart(2, '0')}m`;
}

function refuseWhatIsTaken(options: RunOptions): void {
  const existing = readRecord(options.name);
  if (existing && alive(existing))
    fail(`${options.name} is already running (pid ${String(existing.pid)}); koppler stop ${options.name} first`);
  const held = options.port ? listener(options.port, options.bind) : null;
  if (held && options.port)
    fail(
      `port ${String(options.port)} is already held by pid ${String(held.pid)} (${held.command ?? '?'}); stop it or reuse it`,
    );
}

/** Waits until an app with a port answers on it; a crash while it builds is reported, not "started". */
async function waitForPort(record: ProcessRecord, port: number): Promise<void> {
  console.log(`waiting for ${record.name} on port ${String(port)}…`);
  const until = Date.now() + START_WAIT;
  while (Date.now() < until && alive(record) && !listener(port, record.bind)) await sleep(1000);
  if (!alive(record))
    fail(
      `${record.name} exited before answering on port ${String(port)}; last lines of ${record.log}:\n${tailOf(record.log, 15)}`,
    );
  if (listener(port, record.bind)) return;
  const waited = `${String(START_WAIT / 1000)}s`;
  throw new Failure(
    `${record.name} is running (pid ${String(record.pid)}) but nothing answers on port ${String(port)} after ${waited}; see ${record.log}`,
    2,
  );
}

export const statusOf = (url: URL) =>
  new Promise<number | null>(resolve => {
    const get = url.protocol === 'https:' ? https.get : http.get;
    // Its own development certificate is not one this process trusts; the address is on this machine.
    const request = get(url, { rejectUnauthorized: false, timeout: 4000 }, response => {
      response.resume();
      resolve(response.statusCode ?? null);
    });
    request.once('timeout', () => request.destroy());
    request.once('error', () => {
      resolve(null);
    });
  });
/** Waits until the app says it is ready: a port can answer while startup is still failing. */
async function waitUntilReady(record: ProcessRecord, port: number, ready: Ready) {
  const url = new URL(ready.url, `http://${record.bind ?? 'localhost'}:${String(port)}`);
  const wait = ready.timeout ? ready.timeout * 1000 : START_WAIT;
  const wanted = (status: number | null) =>
    status !== null && (ready.status === undefined ? status < 400 : status === ready.status);
  console.log(`waiting for ${record.name} to be ready at ${url.pathname}…`);
  const until = Date.now() + wait;
  let last: number | null = null;
  while (Date.now() < until && alive(record) && !wanted((last = await statusOf(url)))) await sleep(1000);
  if (!alive(record))
    fail(`${record.name} exited before it was ready; last lines of ${record.log}:\n${tailOf(record.log, 15)}`);
  if (wanted(last)) return;
  const said = last === null ? 'nothing answers there' : `it answers ${String(last)}`;
  throw new Failure(
    `${record.name} is running (pid ${String(record.pid)}) but is not ready: ${said} at ${url.pathname} after ${String(wait / 1000)}s; see ${record.log}`,
    2,
  );
}

/** Starts a command detached, with its log and its record, and returns once it runs (and answers, when it has a port). */
export async function startProcess(options: RunOptions): Promise<ProcessRecord> {
  const { name, command } = options;
  refuseWhatIsTaken(options);
  fs.mkdirSync(logsDir(), { recursive: true, mode: 0o700 });
  fs.mkdirSync(PROCS, { recursive: true, mode: 0o700 });
  const log = path.join(logsDir(), `${name}.log`);
  const program = command[0] ?? '';
  const display = [path.isAbsolute(program) ? path.basename(program) : program, ...command.slice(1)].join(' ');
  keepPreviousLog(log);
  const fd = fs.openSync(log, 'w', 0o600);
  fs.writeSync(fd, `${new Date().toLocaleString('sv-SE')} $ ${display}\n`);
  const argv = commandFor(command, options.restart);
  const cwd = path.resolve(options.cwd ?? process.cwd());
  // An app started with its secrets does not inherit variables that would make its runtime load the caller's code.
  const given = { ...process.env, ...options.setEnv };
  const safe = options.holdsSecrets ? appEnv(given) : null;
  if (safe && safe.dropped.length > 0)
    console.log(`left out of ${name}'s environment, since they load extra code: ${safe.dropped.join(', ')}`);
  const child = spawn(argv[0] ?? '', argv.slice(1), {
    cwd,
    detached: true,
    stdio: ['ignore', fd, fd],
    env: safe?.env ?? given,
  });
  let spawnError: Error | null = null as Error | null;
  child.on('error', error => {
    spawnError = error;
  });
  child.unref();
  fs.closeSync(fd);
  await sleep(300);
  if (spawnError || !child.pid) fail(`could not start ${name}: ${spawnError?.message ?? 'no pid'}`);

  const record: ProcessRecord = {
    name,
    pid: child.pid,
    command: display,
    cwd,
    restart: options.restart,
    port: options.port ?? null,
    ...(options.bind && { bind: options.bind }),
    ...(options.env && { env: options.env }),
    onStop: options.onStop ?? [],
    log,
    startedAt: new Date().toISOString(),
    psCommand: psCommand(child.pid),
    psStart: psStart(child.pid),
  };
  writeJson(recordPath(name), record);
  await sleep(700);
  if (!alive(record)) fail(`${name} exited right away; last lines of ${log}:\n${tailOf(log, 15)}`);
  if (record.port) await waitForPort(record, record.port);
  if (record.port && options.ready) await waitUntilReady(record, record.port, options.ready);
  const answering = record.port ? `, answering on port ${String(record.port)}` : '';
  console.log(`started ${name} (pid ${String(record.pid)})${answering}, log ${log}`);
  return record;
}

const runAll = (commands: string[][]) => {
  for (const [command, ...args] of commands) if (command) sh(command, args);
};
/** Stops one process and everything it started, and says in a line what happened. */
export async function stopOne(record: ProcessRecord): Promise<string> {
  const forget = () => {
    // Some apps outlive their process, e.g. a mobile app on a simulator: close them too.
    runAll(record.onStop);
    fs.rmSync(recordPath(record.name), { force: true });
  };
  if (!alive(record)) {
    forget();
    return `${record.name}: was not running`;
  }
  const signal = (name: NodeJS.Signals | 0) => {
    try {
      process.kill(-record.pid, name);
      return true;
    } catch {
      return false;
    }
  };
  // Every process of the app counts, not only the one Koppler started: a worker that outlives it keeps holding its
  // port.
  const running = () => signal(0);
  signal('SIGTERM');
  for (let tenths = 0; tenths < 80 && running(); tenths++) await sleep(100);
  const forced = running();
  if (forced) {
    signal('SIGKILL');
    for (let tenths = 0; tenths < 20 && running(); tenths++) await sleep(100);
  }
  forget();
  return `${record.name}: stopped${forced ? ' (killed after 8s)' : ''}`;
}
