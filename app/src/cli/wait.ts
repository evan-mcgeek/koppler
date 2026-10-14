// `koppler wait`: blocks until apps Koppler runs are up, healthy or down, for agents and scripts.
import { readStack } from '../data.ts';
import { alive, listener, NAME, readRecord, sleep, statusOf, tailOf } from '../engine/processes.ts';
import { fail } from '../failure.ts';
import { flagValue, positional } from './output.ts';

const USAGE = 'usage: koppler wait <app...> --healthy|--up|--down [--timeout <seconds>] [--json]';
const GOALS = ['healthy', 'up', 'down'] as const;
type Goal = (typeof GOALS)[number];
/** An app's state, as `koppler wait` names it. */
export type WaitState = 'not started' | 'exited' | 'starting' | 'unhealthy' | 'healthy';

/** Where an app is now: started, answering on its port, and passing its own ready check when the stack gives one. */
export async function waitState(name: string): Promise<WaitState> {
  const record = readRecord(name);
  if (!record) return 'not started';
  if (!alive(record)) return 'exited';
  if (record.port && !listener(record.port, record.bind)) return 'starting';
  const app = readStack()?.apps[name];
  if (!app?.ready || !app.url) return 'healthy';
  const status = await statusOf(new URL(app.ready.path, app.url));
  const ok = status !== null && (app.ready.status === undefined ? status < 400 : status === app.ready.status);
  return ok ? 'healthy' : 'unhealthy';
}

const met = (goal: Goal, state: WaitState) =>
  goal === 'down'
    ? state === 'not started' || state === 'exited'
    : goal === 'up'
      ? state !== 'not started' && state !== 'exited'
      : state === 'healthy';

/** Waits for every named app to reach the goal; exits 1 on a timeout or an app that exits, naming each app's state. */
export async function wait(args: string[]): Promise<void> {
  const goals = GOALS.filter(goal => args.includes(`--${goal}`));
  const [goal] = goals;
  const names = positional(args, ['--timeout']);
  if (!goal || goals.length > 1 || !names.length) fail(USAGE);
  for (const name of names) if (!NAME.test(name)) fail(`${name} is not an app or process name`);
  const seconds = Number(flagValue(args, '--timeout') ?? 120);
  if (!Number.isFinite(seconds) || seconds <= 0) fail(`--timeout takes seconds, more than 0 (${USAGE})`);
  const until = Date.now() + seconds * 1000;
  let states: [string, WaitState][] = [];
  let why = '';
  for (;;) {
    states = await Promise.all(names.map(async (name): Promise<[string, WaitState]> => [name, await waitState(name)]));
    if (states.every(([, state]) => met(goal, state))) break;
    const gone = goal !== 'down' && states.find(([, state]) => state === 'exited');
    if (gone) {
      why = `${gone[0]} exited`;
      break;
    }
    if (Date.now() >= until) {
      why = `timed out after ${String(seconds)}s`;
      break;
    }
    await sleep(500);
  }
  if (args.includes('--json'))
    console.log(JSON.stringify({ goal, met: !why, why: why || null, apps: Object.fromEntries(states) }));
  else for (const [name, state] of states) console.log(`${name}: ${state}`);
  if (!why) return;
  const exited = states.find(([, state]) => state === 'exited' && goal !== 'down');
  const record = exited && readRecord(exited[0]);
  fail(`not ${goal}: ${why}${record ? `; last lines of ${record.log}:\n${tailOf(record.log, 15)}` : ''}`);
}
