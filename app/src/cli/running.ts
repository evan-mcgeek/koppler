// The commands about what Koppler runs: stop, the canvas, logs and status.
import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { readClones, readData, readStack } from '../data.ts';
import { alive, listener, NAME, readRecord, records, sh, sleep, stopOne, uptime } from '../engine/processes.ts';
import { run } from '../engine/run.ts';
import { appendNote, live } from '../engine/history.ts';
import { runLog } from '../engine/run-logs.ts';
import { CODE, logsDir, tempDir } from '../paths.ts';
import { redact, scrub } from '../scrub.ts';
import { confirm, flagValue, positional, table } from './output.ts';
import { fail } from '../failure.ts';
import { newToken } from '../server/token.ts';
import { sharedLog } from '../server/shared-log.ts';
import type { Entry } from '../core/shared-log.ts';

const notAName = (name: string) => `${name} is not a name Koppler gives its processes`;

export async function stop(args: string[]): Promise<void> {
  // --all: every app, API and tunnel Koppler runs, but not the canvas; code changes and branches stay as they are.
  const all = args.includes('--all');
  const names = args.filter(arg => !arg.startsWith('-'));
  if (!all && !names.length) fail('usage: koppler stop <name...> | --all [--yes]');
  for (const name of names) if (!NAME.test(name)) fail(notAName(name));
  const targets = all
    ? records().filter(record => record.name !== 'canvas')
    : names.map(name => readRecord(name) ?? fail(`${name} is not started by koppler`));
  if (!targets.length) {
    console.log('nothing to stop');
    return;
  }
  const asked = `Stop ${targets.map(record => record.name).join(', ')}?`;
  if (all && !(await confirm(asked, args))) fail('nothing stopped (in a script, add --yes)');
  for (const line of await Promise.all(targets.map(stopOne))) console.log(line);
  // Stopping in bulk is not a run, so the history gets a note of it: later it says why nothing runs any more.
  const stopped = targets.map(record => record.name);
  if (all) appendNote('stop-apps', stopped);
}

/** The canvas: started when it is not running, then opened in the browser. */
export async function canvas(args: string[]): Promise<void> {
  if (args[0] === 'stop') {
    await stop(['canvas']);
    return;
  }
  const record = readRecord('canvas');
  const urlFile = path.join(tempDir(), 'canvas-url');
  // A new address: a running canvas switches to it, so every address given out before stops working.
  if (args.includes('--new-address')) {
    if (record && alive(record)) {
      const old = new URL(fs.readFileSync(urlFile, 'utf8').trim());
      const token = old.pathname.split('/')[2] ?? '';
      const answer = await fetch(`${old.origin}/new-address?token=${encodeURIComponent(token)}`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ port: old.port }),
      }).catch(() => null);
      if (!answer?.ok)
        fail('the canvas did not take a new address; koppler canvas stop, then koppler canvas --new-address');
    } else newToken();
    console.log('The canvas has a new address; every address given out before no longer works.');
  }
  if (!record || !alive(record)) {
    const port = String(Number(process.env['KOPPLER_PORT']) || 4747);
    await run(['canvas', '--port', port, '--', process.execPath, path.join(CODE, 'status-watch.mjs')]);
  }
  for (let tries = 0; tries < 40 && !fs.existsSync(urlFile); tries++) await sleep(250);
  if (!fs.existsSync(urlFile)) fail('the canvas did not start; see koppler logs canvas');
  // The address carries the page's access token, so it goes to the browser and is not printed.
  const board = flagValue(args, '--board');
  const hash = args.includes('--pick') ? '#pick' : board ? `#board=${encodeURIComponent(board)}` : '';
  const url = fs.readFileSync(urlFile, 'utf8').trim() + hash;
  if (args.includes('--no-open') || process.platform !== 'darwin') {
    console.log(`The canvas runs on port ${new URL(url).port}; its address is in ${urlFile}`);
    return;
  }
  sh('open', [url]);
  console.log('The canvas is open in your browser.');
}

/** The log of every app on the board in one stream, as the canvas's All apps tab shows it; `-f` follows it. */
function allLogs(args: string[]): void {
  const state = readData('state') ?? {};
  const hidden = new Set(Object.keys(state['hiddenLogs'] ?? {}));
  const except = new Set((flagValue(args, '--except') ?? '').split(',').filter(Boolean));
  const apps = Object.keys((state['nodes'] ?? {}) as Record<string, unknown>).filter(
    app => !hidden.has(app) && !except.has(app),
  );
  if (!apps.length) fail('no app on the board to show the log of (koppler use --boards lists the boards)');
  const asked = flagValue(args, '--since');
  if (asked !== undefined && !['run', '1h', 'all'].includes(asked)) fail('--since is run, 1h or all');
  const since = asked === '1h' ? 'hour' : asked === 'all' ? 'all' : 'run';
  const lines = Number(flagValue(args, '--lines')) || undefined;
  const names = readStack()?.apps ?? {};
  const width = Math.max(...apps.map(app => (names[app]?.name ?? app).length));
  const time = (at: number) => new Date(at).toTimeString().slice(0, 8) + `.${String(at % 1000).padStart(3, '0')}`;
  const shown = (entry: Entry) =>
    `${entry.approx ? '~' : ' '}${time(entry.at)} ${(names[entry.app]?.name ?? entry.app).padEnd(width)}  ${entry.line}`;
  const key = (entry: Entry) => `${entry.app}\u0000${String(entry.at)}\u0000${entry.line}`;
  const first = sharedLog(apps, { since, ...(lines && { lines }) });
  for (const entry of first) console.log(shown(entry));
  if (!args.includes('-f') && !args.includes('--follow')) return;
  // Followed by time: what came after the last line shown, and what came at its time and was not shown yet.
  let last = first.at(-1)?.at ?? Date.now();
  let atLast = new Set(first.filter(entry => entry.at === last).map(key));
  setInterval(() => {
    const fresh = sharedLog(apps, { since: 'all' }).filter(
      entry => entry.at > last || (entry.at === last && !atLast.has(key(entry))),
    );
    for (const entry of fresh) console.log(shown(entry));
    const newest = fresh.at(-1)?.at;
    if (newest === undefined) return;
    if (newest !== last) atLast = new Set();
    last = newest;
    for (const entry of fresh.filter(one => one.at === last)) atLast.add(key(entry));
  }, 1000);
}

/** A log, with secrets masked as on the card; `-f` follows it. */
export function logs(args: string[]): void {
  if (args.includes('--all')) {
    allLogs(args);
    return;
  }
  const [want] = positional(args, ['-n', '--run']);
  const lines = Number(flagValue(args, '-n')) || 50;
  if (!want) fail('usage: koppler logs <name> [-f] [-n <lines>] [--run <id>]');
  if (!NAME.test(want)) fail(notAName(want));
  const run = flagValue(args, '--run');
  const kept = run ? runLog(run, want) : null;
  if (run && !kept) fail(`${run} is not a run id; koppler history lists them`);
  const file = kept ?? path.join(logsDir(), `${want}.log`);
  if (!fs.existsSync(file))
    fail(run ? `run ${run} kept no log of ${want}` : `no log for ${want}; koppler status lists what runs`);
  const last = fs.readFileSync(file, 'utf8').trimEnd().split('\n').slice(-lines);
  process.stdout.write(redact(last.join('\n')) + '\n');
  if (!args.includes('-f') && !args.includes('--follow')) return;
  let at = fs.statSync(file).size;
  // Shown a whole line at a time: a secret is masked by the name before it, which may come in an earlier read.
  let held = Buffer.alloc(0);
  fs.watchFile(file, { interval: 500 }, now => {
    if (now.size < at) at = 0;
    if (now.size === at) return;
    const fd = fs.openSync(file, 'r');
    const added = Buffer.alloc(now.size - at);
    fs.readSync(fd, added, 0, added.length, at);
    fs.closeSync(fd);
    at = now.size;
    const all = Buffer.concat([held, added]);
    const end = all.lastIndexOf(10) + 1;
    held = all.subarray(end);
    if (end) process.stdout.write(redact(all.subarray(0, end).toString('utf8')));
  });
}

const tail = (file: string, lines: number) => {
  try {
    return fs.readFileSync(file, 'utf8').trimEnd().split('\n').slice(-lines).join('\n');
  } catch {
    return null;
  }
};
const read = (file: string): unknown => {
  try {
    return JSON.parse(fs.readFileSync(file, 'utf8'));
  } catch {
    return null;
  }
};
const newestRunLog = () => {
  try {
    const logs = fs.readdirSync(tempDir()).filter(file => /^up-.*\.log$/.test(file));
    const age = (file: string) => fs.statSync(path.join(tempDir(), file)).mtimeMs;
    const [newest] = logs.sort((a, b) => age(b) - age(a));
    return newest ? path.join(tempDir(), newest) : null;
  } catch {
    return null;
  }
};
/** A board's name says nothing about a bug and may name a project, even one no stack lists any more. */
const unnamed = (line: string) => {
  try {
    const entry = JSON.parse(line) as { board?: { name?: string } };
    if (entry.board?.name) entry.board.name = 'board';
    return JSON.stringify(entry);
  } catch {
    return line;
  }
};

/**
 * What a bug report needs, ready to paste into a public issue: versions, then the tails of the canvas debug log, the
 * latest run log and each named log, all scrubbed of secrets and of everything that names the user or their stack.
 */
async function debugReport(names: string[]): Promise<void> {
  const { stacksHere } = await import('../engine/stacks.ts');
  const stacks = stacksHere().map(stack => read(path.join(stack.dir, 'stack.json')));
  let commit: string | null = null;
  try {
    const git = ['-C', CODE, 'rev-parse', '--short', 'HEAD'];
    commit = execFileSync('git', git, { encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] }).trim();
  } catch {
    // An installed copy is not a clone.
  }
  const parts = [`Koppler ${commit ?? 'installed copy'}, Node ${process.version}, ${os.type()} ${os.release()}`];
  const add = (title: string, text: string | null | undefined) => {
    if (text) parts.push(`## ${title}\n\n\`\`\`text\n${text}\n\`\`\``);
  };
  add('Canvas debug log', tail(path.join(tempDir(), 'debug.jsonl'), 40)?.split('\n').map(unnamed).join('\n'));
  const runLog = newestRunLog();
  add(`Latest run (${runLog ? path.basename(runLog) : ''})`, runLog && tail(runLog, 60));
  for (const name of names)
    add(
      `${name} log`,
      NAME.test(name) ? (tail(path.join(logsDir(), `${name}.log`), 80) ?? 'no log') : 'not a log name',
    );
  console.log(scrub(parts.join('\n\n'), [readData('registry'), readData('state'), ...stacks]));
}

/** What runs; --apps adds every app in the stack with its clone; --debug is for a bug report. */
export async function status(args: string[] = []): Promise<void> {
  if (args.includes('--debug')) {
    await debugReport(positional(args));
    return;
  }
  const { processState, stateOf } = await import('../engine/app-state.ts');
  const processes = records().map(record => {
    const up = alive(record);
    return {
      name: record.name,
      state: up ? 'running' : 'exited',
      pid: record.pid,
      up: up ? uptime(record.startedAt) : null,
      port: record.port ?? null,
      open: !!(record.port && up && listener(record.port, record.bind)),
      command: record.command,
    };
  });
  const stack = args.includes('--apps') ? (readStack() ?? fail('no stack loaded (koppler init)')) : null;
  const clones = readClones();
  const apps =
    stack &&
    Object.entries(stack.apps).map(([id, app]) => {
      const clone = clones[id];
      return {
        id,
        name: app.name,
        kind: app.kind,
        clone: clone ? { branch: clone.branch ?? null, changed: clone.dirty ?? 0 } : null,
        state: processes.find(one => one.name === id)?.state ?? null,
      };
    });
  if (args.includes('--json')) {
    // In words, as the canvas shows them: with the run's steps and, for the stack's apps, the secrets they lack.
    type Steps = Record<string, { label: string; state: string; detail?: string }[] | undefined>;
    const steps = (read(path.join(tempDir(), 'progress.json')) as { apps?: Steps } | null)?.apps ?? {};
    const detailed = await Promise.all(
      processes.map(async one => ({ ...one, status: stateOf(await processState(one.name), steps[one.name]) })),
    );
    let missing: Record<string, string[]> = {};
    if (stack) {
      const { secretsStatus } = await import('../server/secrets.ts');
      const env = live()?.env ?? stack.envs[0] ?? '';
      const declared = await secretsStatus().catch(() => ({}));
      missing = Object.fromEntries(
        Object.entries(declared).map(([id, envs]) => [
          id,
          (envs[env] ?? []).filter(secret => !secret.stored).map(secret => secret.name),
        ]),
      );
    }
    const withState = await Promise.all(
      (apps ?? []).map(async app => ({
        ...app,
        status: stateOf(await processState(app.id), steps[app.id], missing[app.id]),
      })),
    );
    console.log(
      JSON.stringify({ processes: detailed, ...(apps && { stack: stack.name ?? null, apps: withState }) }, null, 2),
    );
    return;
  }
  if (stack && apps) {
    console.log(`${stack.name ?? 'stack'}: ${stack.source ?? ''}`);
    const cloneOf = ({ clone }: (typeof apps)[number]) =>
      clone ? `${clone.branch ?? 'detached'}${clone.changed ? ` (${String(clone.changed)} changed)` : ''}` : 'missing';
    table([
      ['APP', 'NAME', 'KIND', 'CLONE', 'KOPPLER'],
      ...apps.map(app => [app.id, app.name, app.kind, cloneOf(app), app.state ?? '-']),
    ]);
    console.log('');
  }
  if (!processes.length) {
    console.log('nothing started by koppler');
    return;
  }
  const short = (command: string) => (command.length > 70 ? command.slice(0, 67) + '...' : command);
  table([
    ['NAME', 'STATE', 'PID', 'UP', 'PORT', 'COMMAND'],
    ...processes.map(one => [
      one.name,
      one.state,
      one.pid,
      one.up ?? '-',
      one.port ? `${String(one.port)} ${one.open ? 'open' : 'closed'}` : '-',
      short(one.command),
    ]),
  ]);
}
