// What the canvas shows about each app, put together every second and a half: temp/status.json as the agent wrote it,
// plus live port state, log tails, credentials, the run history and everything else the page re-loads on a timer.
import fs from 'node:fs';
import net from 'node:net';
import path from 'node:path';
import { of as kindOf } from '../core/kinds.ts';
import { readStack } from '../data.ts';
import { linkedStatus } from '../engine/linked.ts';
import { listenerPid } from '../engine/listen.ts';
import { boardEdits } from '../engine/boards.ts';
import { lockedPaths } from '../engine/locks.ts';
import { stackSource } from '../engine/sync.ts';
import { readMessages } from '../engine/messages.ts';
import { recipesFor } from '../engine/recipes.ts';
import { live, notes, runningEnvs, runningNames, runs } from '../engine/runs.ts';
import { currentStack, LOADING, stacksHere } from '../engine/sync.ts';
import { CODE, logsDir, stateDir, tempDir } from '../paths.ts';
import { redact } from '../scrub.ts';
import { tail } from './logs.ts';
import { mobileState, refreshMobile, type MobileApp } from './mobile.ts';
import { secretsStatus } from './secrets.ts';
import { waiting } from './waiting.ts';
import { APP_ID, RUN_ID } from '../ids.ts';

type Loose = Record<string, unknown>;
interface Step {
  label: string;
  state: string;
  detail?: string;
}
/** One app's card. */
interface AppStatus extends Loose {
  port?: number;
  log?: string;
  steps?: Step[];
  listening?: boolean;
  running?: MobileApp[];
  logTail?: string | null;
}
type Status = Loose & { apps: Record<string, AppStatus> };

export const SOURCE = path.join(tempDir(), 'status.json');
const OUT = path.join(tempDir(), 'status.js');
const STEP_STATES = ['done', 'failed', 'user', 'todo'];
/** A value from a file as text, cut to size. */
const cut = (value: unknown, most: number) => String(value).slice(0, most);
const readJson = (file: string): unknown => JSON.parse(fs.readFileSync(file, 'utf8'));
const procFile = (name: string) => path.join(stateDir(), 'procs', name);

/** The newest of the server's own files: the page reloads itself, but the server's code only takes effect after a restart. */
const codeVersion = () => {
  try {
    const own = fs.readdirSync(CODE).filter(file => /\.m?js$/.test(file) && !file.includes('.test.'));
    return Math.max(...own.map(file => fs.statSync(path.join(CODE, file)).mtimeMs));
  } catch {
    return 0;
  }
};
const STARTED_CODE = codeVersion();
const STARTED_AT = new Date().toISOString();
// Run from its source folder rather than an installed plugin: Koppler itself is being worked on, so the debug log stays on.
const DEV = !fs.realpathSync(CODE).split(path.sep).join('/').includes('/plugins/cache/');

const portOpen = (port: number) =>
  new Promise<boolean>(resolve => {
    const socket = net.connect({ host: '127.0.0.1', port, timeout: 400 });
    const done = (open: boolean) => {
      socket.destroy();
      resolve(open);
    };
    socket.once('connect', () => {
      done(true);
    });
    socket.once('timeout', () => {
      done(false);
    });
    socket.once('error', () => {
      done(false);
    });
  });

/** Every tunnel port in the stack, so cards can show whether their database or cache is reachable. */
function tunnelPorts(): number[] {
  const stack = readStack();
  if (!stack) return [];
  const needs = Object.values(stack.apps).flatMap(app => [
    ...(app.prereqs ?? []),
    ...Object.values(app.envs ?? {}).flatMap(env => env.prereqs ?? []),
  ]);
  const declared = needs.flatMap(({ tunnel, port }) =>
    tunnel && port !== undefined && Number.isInteger(port) && port > 0 && port < 65536 ? [port] : [],
  );
  // Tunnels koppler moved to another port are checked there too.
  let running: number[] = [];
  try {
    running = fs.readdirSync(procFile('')).flatMap(file => {
      try {
        return (readJson(procFile(file)) as { port?: number }).port || [];
      } catch {
        return [];
      }
    });
  } catch {
    // Nothing was started yet.
  }
  return [...new Set([...declared, ...running])];
}

/** The steps of the run Koppler applies itself (koppler up), for cards the agent wrote no checklist for. */
function addProgress(status: Status): void {
  try {
    const progress = readJson(path.join(tempDir(), 'progress.json')) as { run?: string; env?: unknown; apps?: Loose };
    if (!RUN_ID.test(progress.run ?? '')) return;
    const apps = Object.entries(progress.apps ?? {}).filter(([id]) => APP_ID.test(id));
    status['progress'] = { run: progress.run, env: cut(progress.env ?? '', 16), apps: apps.map(([id]) => id) };
    for (const [id, steps] of apps) {
      if (!Array.isArray(steps)) continue;
      const app = (status.apps[id] ??= {});
      if (app.steps?.length) continue;
      app.steps = (steps as (Loose & { state: string })[]).slice(0, 12).map(step => ({
        label: cut(step['label'], 60),
        state: STEP_STATES.includes(step.state) ? step.state : 'todo',
        ...(!!step['detail'] && { detail: cut(step['detail'], 300) }),
      }));
    }
  } catch {
    // No run of Koppler's own in progress.
  }
}

/** What the stack needs on this Mac, as `koppler doctor` last found it. */
function lastChecks(): object[] | null {
  try {
    const { results } = readJson(path.join(tempDir(), 'checks.json')) as { results: (Loose & { state: string })[] };
    return results.slice(0, 80).map(result => ({
      name: cut(result['name'], 80),
      state: cut(result.state, 16),
      detail: redact(cut(result['detail'] ?? '', Infinity)).slice(0, 400),
      ...(Array.isArray(result['for']) && { for: (result['for'] as unknown[]).slice(0, 10).map(who => cut(who, 80)) }),
      ...(result.state === 'gap' && {
        app: cut(result['app'], 64),
        env: cut(result['env'], 16),
        kind: cut(result['kind'], 16),
      }),
    }));
  } catch {
    return null;
  }
}

/** Remembered code changes per app, with how each did on this Mac; the review lists the ones a Send applies. */
function recipesByApp(): Record<string, object[]> {
  try {
    const stack = readStack();
    const byApp = Object.keys(stack?.apps ?? {}).map((id): [string, object[]] => [
      id,
      recipesFor(stack, id)
        .filter(recipe => !recipe.os || recipe.os === 'any' || recipe.os === process.platform)
        .map(({ id: recipe, why, file, when, scope, here }) => ({
          id: recipe,
          why: cut(why, 200),
          file: cut(file, 200),
          when,
          scope,
          ...(here && { here: { ok: here.ok, at: cut(here.at, 10) } }),
        })),
    ]);
    return Object.fromEntries(byApp.filter(([, list]) => list.length));
  } catch {
    return {};
  }
}

/** Whether an agent session takes Sends: listening now, working on one it took (for up to two hours), or none. */
function agentState(): { state: string; since?: string | undefined; busy?: string } {
  let listener: { pid: number | null; since?: string; busy?: string; started?: string | null } | null;
  try {
    listener = readJson(path.join(tempDir(), 'listener.json')) as typeof listener;
  } catch {
    return { state: 'none' };
  }
  if (typeof listener !== 'object' || listener === null) return { state: 'none' };
  if (listener.pid) return listenerPid(listener) ? { state: 'listening', since: listener.since } : { state: 'none' };
  // Working on what it took, until it marks a run done or failed after that: then it has finished and is not listening.
  const ended = Math.max(0, ...runs().map(run => Date.parse(run.endedAt ?? '') || 0));
  const took = Date.parse(listener.busy ?? '');
  return listener.busy && took > ended && Date.now() - took < 2 * 3600 * 1000
    ? { state: 'busy', since: listener.since, busy: listener.busy }
    : { state: 'none' };
}

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === 'object' && value !== null && !Array.isArray(value);
/** Where an app's log is read from: the file it names when that is a log, else where Koppler keeps its own. */
export const logFile = (id: string, named: unknown): string =>
  typeof named === 'string' && path.isAbsolute(named) && /\.(log|out|txt)$/i.test(named)
    ? named
    : path.join(logsDir(), `${id}.log`);

async function snapshot(serving: boolean): Promise<Status> {
  let written: Partial<Status> = {};
  try {
    written = readJson(SOURCE) as Partial<Status>;
  } catch {
    // No agent wrote a status yet.
  }
  // An app Koppler started itself (koppler up) has a card too, even when no agent wrote a status for it.
  // Anyone can have written that file: only what is shaped like an app's status is kept.
  const given = isRecord(written) ? written : {};
  const apps = Object.entries(isRecord(given.apps) ? given.apps : {}).filter(
    ([id, app]) => APP_ID.test(id) && isRecord(app),
  );
  const status: Status = { ...given, apps: Object.fromEntries(apps) };
  for (const name of runningNames()) {
    if (status.apps[name] || name === 'canvas' || name.startsWith('tunnel-')) continue;
    try {
      const record = readJson(procFile(`${name}.json`)) as { port?: number; log: string };
      status.apps[name] = { ...(record.port && { port: record.port }), log: record.log };
    } catch {
      // Its record went away between the two looks.
    }
  }
  addProgress(status);
  // A mobile app on the applied board is looked for on the simulators and devices too, even when started from the IDE.
  const stack = readStack();
  for (const id of Object.keys(live()?.nodes ?? {}))
    if (!status.apps[id] && stack?.apps[id] && kindOf(stack.apps[id]).platforms) status.apps[id] = {};
  await refreshMobile(Object.keys(status.apps));
  for (const [id, app] of Object.entries(status.apps)) {
    if (app.port) app.listening = await portOpen(app.port);
    if (mobileState[id]) app.running = mobileState[id];
    app.logTail = tail(logFile(id, app.log));
    delete app.log;
  }
  const ports = await Promise.all(
    tunnelPorts().map(async (port): Promise<[number, boolean]> => [port, await portOpen(port)]),
  );
  status['ports'] = Object.fromEntries(ports);
  status['secrets'] = await secretsStatus().catch(() => ({}));
  status['recipes'] = recipesByApp();
  const inUse = currentStack();
  status['stack'] = loadedStack(inUse);
  status['loading'] = loadingStack();
  status['checks'] = lastChecks();
  status['stacks'] = stacksHere();
  status['linked'] = inUse ? linkedStatus(inUse) : null;
  status['live'] = live();
  status['messages'] = readMessages();
  status['boardEdits'] = boardEdits();
  const source = stackSource();
  status['locks'] = source ? lockedPaths(source) : [];
  status['agent'] = agentState();
  // Sends, Stops and answers no session has taken yet.
  status['waiting'] = waiting();
  status['queued'] = (status['waiting'] as unknown[]).length;
  status['running'] = runningNames();
  status['runningEnvs'] = runningEnvs();
  status['runs'] = runs()
    .slice(-20)
    .map(({ nodes, edges, ...run }) => ({ ...run, nodes, edges }));
  status['notes'] = notes().slice(-20);
  status['at'] = new Date().toISOString();
  // The page works out the server's addresses from its own, so the token is in no file but its own.
  if (serving) status['server'] = true;
  try {
    status['pageVersion'] = fs.statSync(path.join(CODE, 'page', 'index.html')).mtimeMs;
  } catch {
    // The page is gone: nothing to reload.
  }
  status['startedAt'] = STARTED_AT;
  if (DEV) status['dev'] = true;
  status['start'] = 'koppler canvas';
  if (codeVersion() > STARTED_CODE) status['restart'] = 'koppler canvas stop && koppler canvas start';
  return status;
}

let shown: string | null = null;
/** The stack the page is told about: one just switched to is named once its data is loaded, never half way. */
function loadedStack(inUse: string | null): string | null {
  const registry = readStack();
  if (!inUse || (registry?.source === path.join(inUse, 'stack.json') && registry.found)) shown = inUse;
  return shown;
}

/** The stack a running `koppler sync` is loading, when it is not the one the page shows already. */
function loadingStack(): string | null {
  try {
    const { stack, pid } = readJson(LOADING) as { stack: unknown; pid: number };
    process.kill(pid, 0);
    return typeof stack === 'string' && stack !== shown ? stack : null;
  } catch {
    return null;
  }
}

let latest: string | null = null;
/** The status as last put together, as JSON, for the page that asks for it instead of loading it as a script. */
export const statusJson = () => latest;

/** Writes the status where the page loads it from, whole or not at all. */
export async function publish(serving: boolean): Promise<void> {
  latest = JSON.stringify(await snapshot(serving));
  const body = `window.__kopplerStatus && window.__kopplerStatus(${latest});\n`;
  fs.writeFileSync(OUT + '.tmp', body, { mode: 0o600 });
  fs.renameSync(OUT + '.tmp', OUT);
}
