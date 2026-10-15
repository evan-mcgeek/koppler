// Runs: every Send and Stop from the canvas is kept as a record (what was asked, the plan the user confirmed, how it ended),
// and the board last applied is kept as the live state the next plan is compared with. Names only, never secret values.
// Usage: koppler plan [--json]                      what the newest unapplied Send will do, checked against what is running
//        koppler history done [<id>] [--failed <why>]    the agent finished (or gave up on) a run
//        koppler history                            recent runs and how they ended
import fs from 'node:fs';
import path from 'node:path';
import { fail } from '../failure.ts';
import * as kp from '../core/plan.ts';
import { readClones, readData, readStack } from '../data.ts';
import { stateDir, tempDir } from '../paths.ts';
import { redact } from '../scrub.ts';
import { alive, records } from './processes.ts';
import { writeJson } from '../json-files.ts';
import {
  actionsFile,
  append,
  codeChanges,
  live,
  liveFile,
  NOTE_WORDS,
  notes,
  runs,
  type CodeChange,
  type LiveBoard,
  type Run,
} from './history.ts';
import { finishTaken } from './listen.ts';
import { pinned, runLogs } from './run-logs.ts';
import { markRuns } from './recipes.ts';

type Loose = Record<string, unknown>;
const text = (value: unknown, max = 200) => (typeof value === 'string' ? value.slice(0, max) : '');
const stamp = () => new Date().toISOString();

/** What Koppler is running right now (apps, tunnels, the canvas): its own records, each checked to still be that process. */
const runningRecords = () => records().filter(alive);
export const runningNames = (): string[] => runningRecords().map(record => record.name);
export const runningEnvs = (): Record<string, string> =>
  Object.fromEntries(runningRecords().flatMap(record => (record.env ? [[record.name, record.env]] : [])));

type BoardPart = Partial<Pick<LiveBoard, 'nodes' | 'edges'>>;
/** The part of a board that really runs: apps Koppler runs now, and apps the user starts in an IDE; `off` lists the rest. */
export function runningPart(board: BoardPart, names = runningNames()) {
  const all = board.nodes ?? {};
  const on = (id: string) => names.includes(id) || all[id]?.run === 'ide';
  const nodes = Object.fromEntries(Object.entries(all).filter(([id]) => on(id)));
  const edges = (board.edges ?? []).filter(edge => nodes[edge.from] && nodes[edge.to]);
  return { nodes, edges, off: Object.keys(all).filter(id => !on(id)) };
}
/** Apps Koppler runs that the applied board does not explain. */
export const strays = (
  liveBoard: { nodes?: Record<string, unknown> } | null | undefined,
  names: string[],
  appIds: string[],
): string[] => names.filter(name => appIds.includes(name) && !liveBoard?.nodes?.[name]);

const nameIn = (stack: ReturnType<typeof readStack>) => (id: string) => stack?.apps[id]?.name ?? id;

/** What running a board would start, restart, stop and keep, against what runs now. */
export function planFor(board: kp.BoardInput): kp.Plan {
  const stack = readStack();
  const names = runningNames();
  const envs = runningEnvs();
  const liveBoard = live();
  return kp.plan(liveBoard, board, {
    name: nameIn(stack),
    running: id => names.includes(id),
    strays: strays(liveBoard, names, Object.keys(stack?.apps ?? {})),
    startedOn: id => envs[id],
    queuesOf: id => kp.queuesOf(stack, id),
    current: id => readClones()[id]?.branch ?? undefined,
  });
}
/** The plan for the newest Send that has not been applied, worked out again now, and whether it is still what the user confirmed. */
export function currentPlan() {
  const run = runs().findLast(one => one.kind === 'run' && (one.state === 'waiting' || one.state === 'applying'));
  if (!run) return null;
  const plan = planFor(run);
  return { run, plan, confirmed: kp.same(plan, run.plan), name: nameIn(readStack()) };
}

export function planCommand(args: string[]): void {
  const current = currentPlan();
  if (!current) {
    console.log('No Send is waiting to be applied.');
    return;
  }
  const { run, plan, confirmed, name } = current;
  if (args.includes('--json')) {
    const shown = { id: run.id, env: run.env, mode: run.mode, confirmed, plan, asConfirmed: run.plan };
    console.log(JSON.stringify(shown, null, 2));
    return;
  }
  console.log(`Run ${run.id} on ${String(run.env).toUpperCase()} (${String(run.mode)}), sent ${run.at}`);
  for (const line of kp.describe(plan, { name })) console.log(`  ${line}`);
  const asConfirmed = kp.describe(run.plan as kp.Plan, { name }).join(' | ');
  console.log(
    confirmed
      ? '  This is what the user confirmed on the canvas.'
      : `  DIFFERS from what the user confirmed (${asConfirmed}): things changed since. Tell the user and ask before doing anything.`,
  );
}

/** The environment variables a launch profile has right now, read from the app's clone. */
function profileEnvNow(action: Loose): unknown {
  try {
    const clones = (readData('local')?.['apps'] ?? {}) as Record<string, { path?: string } | null>;
    const { app, file, name } = action as { app: string; file: string; name: string };
    const repo = clones[app]?.path;
    const settings = JSON.parse(
      fs.readFileSync(path.isAbsolute(file) ? file : path.join(repo as string, file), 'utf8').replace(/^\uFEFF/, ''),
    ) as { profiles?: Record<string, { environmentVariables?: unknown } | undefined> };
    return settings.profiles?.[name]?.environmentVariables ?? null;
  } catch {
    return null;
  }
}

/** The code changes in effect after a run; ones an earlier run already showed are not marked new. */
function changesAfter(run: Run, all: Run[]): CodeChange[] {
  try {
    const shown = all.filter(other => other.id !== run.id).flatMap(other => other.changes ?? []);
    const seen = new Set(shown.map(change => JSON.stringify({ ...change, fresh: undefined })));
    const actions: unknown = JSON.parse(fs.readFileSync(actionsFile(), 'utf8'));
    return codeChanges(actions, { clean: redact, profileEnv: profileEnvNow }).map(change => ({
      ...change,
      ...(!seen.has(JSON.stringify(change)) && { fresh: true as const }),
    }));
  } catch {
    // No action log yet: nothing was changed.
    return [];
  }
}

/** While Koppler itself is worked on, a finished Stop ends a session: it is gathered, and the agent is asked to review it. */
async function gatherSession(stop: Run): Promise<void> {
  try {
    const { isDev, collectSession } = await import('./session.ts');
    if (!isDev()) return;
    const { dir, quiet } = collectSession({
      temp: tempDir(),
      logsDir: path.join(stateDir(), 'logs'),
      stop,
      runs: runs(),
    });
    if (quiet) {
      console.log(`Session gathered in ${dir}; nothing went wrong, so no review is queued.`);
      return;
    }
    const review = `The session ended with a full Stop. Review it using the koppler-run skill: read ${dir}/summary.md and the files next to it, find every problem the user ran into, fix them in Koppler, verify each fix, and report.`;
    const prompt = { tag: 'koppler-review', at: stamp(), text: review, data: { dir } };
    fs.appendFileSync(path.join(tempDir(), 'prompts.jsonl'), JSON.stringify(prompt) + '\n', { mode: 0o600 });
    console.log(`Session gathered in ${dir}; a review request is queued for the agent.`);
  } catch (error) {
    console.error(`koppler: could not gather the session (${(error as Error).message})`);
  }
}

/** `koppler history session`: what happened since the last finished Stop, gathered for the agent to read. */
export async function sessionCommand(): Promise<void> {
  const { collectSession } = await import('./session.ts');
  const { dir } = collectSession({ temp: tempDir(), logsDir: path.join(stateDir(), 'logs'), runs: runs() });
  console.log(fs.readFileSync(path.join(dir, 'summary.md'), 'utf8').trimEnd());
  console.log(`\nThe files are in ${dir}; they stay on this Mac.`);
}

/** `koppler history done [<id>] [--failed <why>]`: the run ended, and the live state becomes what really runs from it. */
export async function appliedCommand(args: string[]): Promise<void> {
  const failAt = args.indexOf('--failed');
  const failed = failAt >= 0;
  const reason = failed ? args[failAt + 1] : undefined;
  const given = args.find((arg, at) => !arg.startsWith('--') && (!failed || at !== failAt + 1));
  const all = runs();
  const run = given
    ? all.find(one => one.id === given)
    : all.findLast(one => one.state === 'waiting' || one.state === 'applying');
  if (!run && !given && !failed) {
    // A request that was no run (filling in settings, answering a question): done means the agent is no longer at it.
    if (finishTaken()) {
      console.log('The request is finished: the canvas no longer shows the agent as working.');
      return;
    }
  }
  if (!run) fail(given ? `no run ${given} in the history` : 'no run is waiting to be applied');
  if (failed && !reason) fail('say why: koppler history done --failed "<what went wrong>"');
  const changes = changesAfter(run, all);
  // How each remembered change did on this Mac, and when; private, never in the shared stack.
  try {
    markRuns(actionsFile(), !failed);
  } catch {
    // Remembered changes are a convenience: a run still ends without them.
  }
  append({
    id: run.id,
    event: failed ? 'failed' : 'done',
    at: stamp(),
    ...(reason && { reason: text(reason, 500) }),
    ...(changes.length && { changes }),
  });
  // The live state is what really runs from this board, done or failed: what Koppler runs, and what the user starts in
  // an IDE. An app that did not start is left out and named, so the next Send starts it instead of keeping a ghost.
  const { nodes, edges, off } = runningPart(run);
  const now: LiveBoard = {
    id: run.id,
    at: stamp(),
    env: run.env,
    nodes,
    edges,
    ...(run.queues && { queues: run.queues }),
  };
  writeJson(liveFile(), now);
  if (run.kind === 'stop' && !failed) await gatherSession(run);
  const ended = failed ? `failed (${reason ?? ''})` : 'done';
  const running = Object.keys(nodes).join(', ') || 'empty';
  console.log(`${run.kind === 'stop' ? 'Stop' : 'Run'} ${run.id}: ${ended}; live state is now ${running}`);
  if (off.length) {
    const names = off.map(nameIn(readStack())).join(', ');
    console.log(`Not running: ${names}. The next Send starts ${off.length === 1 ? 'it' : 'them'} again.`);
  }
}

/** `koppler history [--json]`: recent runs and how they ended. */
export function historyCommand(args: string[] = []): void {
  const all = runs().slice(-15);
  if (args.includes('--json')) {
    const pins = pinned();
    const told = all.map(run => ({ ...run, logs: runLogs(run.id), pinned: pins.includes(run.id) }));
    console.log(JSON.stringify(told, null, 2));
    return;
  }
  const lines = all.map((run): [string, string] => {
    const what =
      run.kind === 'stop'
        ? 'stop and revert'
        : `${String(run.env).toUpperCase()} ${String(run.mode)}: ${Object.keys(run.nodes).join(', ')}`;
    return [run.at, `${run.at}  ${run.id}  ${what}  [${run.state}${run.reason ? `: ${run.reason}` : ''}]`];
  });
  // What stopped outside a run is told among the runs, in the order it happened.
  const [oldest] = lines;
  for (const { note, at, stopped } of notes())
    if (!oldest || at >= oldest[0])
      lines.push([at, `${at}  ${NOTE_WORDS[note]}${stopped.length ? `: ${stopped.join(', ')}` : ''}`]);
  if (!lines.length) console.log('No runs yet.');
  for (const [, line] of lines.sort((a, b) => a[0].localeCompare(b[0]))) console.log(line);
}
