// `koppler wait`: blocks until apps Koppler runs are up, healthy or down, for agents and scripts.
import { processState } from '../engine/app-state.ts';
import { NAME, readRecord, sleep, tailOf } from '../engine/processes.ts';
import { fail } from '../failure.ts';
import { flagValue, positional } from './output.ts';

const USAGE = 'usage: koppler wait <app...> --healthy|--up|--down [--timeout <seconds>] [--json]';
const GOALS = ['healthy', 'up', 'down'] as const;
type Goal = (typeof GOALS)[number];
/** An app's state, as `koppler wait` names it. */
export type WaitState = 'not started' | 'exited' | 'building' | 'unhealthy' | 'running';
const waitState = async (name: string): Promise<WaitState> => {
  const now = await processState(name);
  return (now?.state as WaitState | undefined) ?? 'not started';
};

const met = (goal: Goal, state: WaitState) =>
  goal === 'down'
    ? state === 'not started' || state === 'exited'
    : goal === 'up'
      ? state !== 'not started' && state !== 'exited'
      : state === 'running';

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
