// Runs: every Send and Stop from the canvas is kept as a record (what was asked, the plan the user confirmed, how it ended),
// and the board last applied is kept as the live state the next plan is compared with. Names only, never secret values.
// Usage: koppler plan [--json]                      what the newest unapplied Send will do, checked against what is running
//        koppler history done [<id>] [--failed <why>]    the agent finished (or gave up on) a run
//        koppler history                            recent runs and how they ended
import fs from 'node:fs';
import path from 'node:path';
import { fail } from '../failure.ts';
import * as kp from '../core/plan.ts';
import { readData, readStack } from '../data.ts';
import { stateDir, tempDir } from '../paths.ts';
import { redact } from '../scrub.ts';
import { APP_ID, RUN_ID } from '../ids.ts';
import { alive, records } from './processes.ts';
import { writeJson } from '../json-files.ts';

type Loose = Record<string, unknown>;
type Steps = Pick<kp.Plan, 'starts' | 'restarts' | 'stops' | 'keeps'>;
/** What is kept of a Send or a Stop. */
export interface RunRecord {
  id: string;
  at: string;
  kind: 'run' | 'stop';
  env: string | null;
  mode: string | null;
  note?: string;
  nodes: Record<string, kp.BoardNode>;
  edges: kp.Edge[];
  queues?: Record<string, 'local'>;
  /** The plan the user confirmed. */
  plan: Steps;
}
/** One code change of a run, as removed and added lines, for the History's diffs. */
export interface CodeChange {
  app: string;
  kind: string;
  file: string;
  title: string;
  removed: string[];
  added: string[];
  /** Not shown by an earlier run. */
  fresh?: true;
}
export type RunState = 'waiting' | 'applying' | 'done' | 'failed' | 'replaced';
/** A run as the history file has it: a record written by an older Koppler may lack its plan. */
export interface Run extends Omit<RunRecord, 'plan'> {
  plan?: Partial<Steps>;
  state: RunState;
  endedAt?: string;
  changes?: CodeChange[];
  reason?: string;
}
/** The board last applied, as far as it really runs. */
export interface LiveBoard {
  id?: string;
  at?: string;
  env: string | null;
  nodes: Record<string, kp.BoardNode>;
  edges: kp.Edge[];
  queues?: Record<string, 'local'>;
}
/** A prompt from the canvas, as it sits in the queue. */
interface Prompt {
  tag?: string;
  at?: string;
  data?: Loose;
}

const historyFile = () => path.join(tempDir(), 'history.jsonl');
const liveFile = () => path.join(tempDir(), 'live.json');
const actionsFile = () => path.join(tempDir(), 'actions.json');
const ID = APP_ID;
const MAX_RUNS = 200;
const LIBRARY = /^[\w@./-]{1,100}$/;
const text = (value: unknown, max = 200) => (typeof value === 'string' ? value.slice(0, max) : '');
const isId = (value: unknown, pattern = ID): value is string => typeof value === 'string' && pattern.test(value);
const listOf = (value: unknown) => (Array.isArray(value) ? (value as unknown[]) : []);
const steps = (list: unknown): kp.Step[] =>
  listOf(list)
    .map(step => (step ?? {}) as Loose)
    .filter(step => isId(step['id']))
    .slice(0, 100)
    .map(step => ({
      id: step['id'] as string,
      why: listOf(step['why'])
        .slice(0, 10)
        .map(why => text(why, 200)),
    }));
const append = (line: object) => {
  fs.appendFileSync(historyFile(), JSON.stringify(line) + '\n', { mode: 0o600 });
};
const stamp = () => new Date().toISOString();

/** What is kept of a prompt from the canvas: only known fields, so the file cannot be used to store anything else. */
export function runRecord(prompt: Prompt | null | undefined): RunRecord | null {
  const data = prompt?.data ?? {};
  const id = data['id'];
  if (!isId(id, RUN_ID)) return null;
  const stop = prompt?.tag === 'koppler-stop';
  const board = kp.board(stop ? {} : data);
  // An app with nothing to run here (`outside` in the stack: a SaaS, a library, a config repo) is never part of a run.
  const stack = readStack();
  const kept = Object.entries(board.nodes).filter(([app]) => ID.test(app) && !stack?.apps[app]?.outside);
  const nodes = Object.fromEntries(
    kept.map(([app, node]): [string, kp.BoardNode] => [
      app,
      {
        branch: text(node.branch),
        run: text(node.run, 16) as kp.RunIn,
        ...(node.platform && { platform: text(node.platform, 16) }),
        ...(node.note && { note: text(node.note, 4000) }),
        ...(node.tunnels === false && { tunnels: false }),
        ...(node.queues === true && { queues: true }),
        ...(node.restart && { restart: true }),
        ...(['set-aside', 'take-along'].includes(node.changes ?? '') && { changes: node.changes }),
        ...(node.libraries?.length && {
          libraries: node.libraries.filter(library => LIBRARY.test(library)).slice(0, 20),
        }),
      },
    ]),
  );
  // Queues the board switched to a local copy; the rest stay the deployed ones.
  const local = Object.entries((data['queues'] ?? {}) as Loose).filter(
    ([queue, where]) => ID.test(queue) && where === 'local',
  );
  const queues = Object.fromEntries(local.slice(0, 50)) as Record<string, 'local'>;
  const plan = (data['plan'] ?? {}) as Loose;
  return {
    id,
    at: prompt?.at ?? stamp(),
    kind: stop ? 'stop' : 'run',
    env: stop ? null : text(data['env'], 16),
    mode: stop ? null : text(data['mode'], 16),
    ...(!!data['note'] && { note: text(data['note'], 4000) }),
    nodes,
    edges: board.edges.filter(edge => nodes[edge.from] && nodes[edge.to]),
    ...(Object.keys(queues).length && { queues }),
    plan: {
      starts: steps(plan['starts']),
      restarts: steps(plan['restarts']),
      stops: steps(plan['stops']),
      keeps: steps(plan['keeps']),
    },
  };
}
/** Something that stopped outside a run, kept so the history says why things are no longer running. */
export interface Note {
  note: 'stop-apps' | 'stop-all' | 'canvas-closed';
  at: string;
  /** What was stopped, by the name Koppler ran it under. */
  stopped: string[];
}
const NOTES: readonly string[] = ['stop-apps', 'stop-all', 'canvas-closed'];
export const appendNote = (note: Note['note'], stopped: string[] = []): void => {
  fs.mkdirSync(tempDir(), { recursive: true });
  append({ note, at: stamp(), stopped: stopped.filter(name => ID.test(name)).slice(0, 100) });
};
/** The notes in the history, oldest first. They are not runs: no plan or live state looks at them. */
export function readNotes(raw: string | null | undefined): Note[] {
  return (raw ?? '').split('\n').flatMap(line => {
    try {
      const { note, at, stopped } = JSON.parse(line) as Partial<Note>;
      if (!NOTES.includes(note ?? '') || typeof at !== 'string') return [];
      const names = (Array.isArray(stopped) ? stopped : []).filter(name => typeof name === 'string' && ID.test(name));
      return [{ note, at: at.slice(0, 40), stopped: names.slice(0, 100) } as Note];
    } catch {
      return [];
    }
  });
}
export const notes = (): Note[] => {
  try {
    return readNotes(fs.readFileSync(historyFile(), 'utf8')).slice(-MAX_RUNS);
  } catch {
    return [];
  }
};
const NOTE_WORDS = {
  'stop-apps': 'apps stopped, changes kept',
  'stop-all': 'everything stopped, changes kept',
  'canvas-closed': 'canvas closed',
};

export const appendRun = (record: RunRecord): void => {
  append(record);
};
export const appendEvent = (id: string, event: string, reason?: string): void => {
  append({ id, event, at: stamp(), ...(reason && { reason: text(reason, 500) }) });
};

const CODE_KINDS = ['edit', 'profile', 'env-file', 'checkout'];
/**
 * The code changes in the action log, as removed and added lines per app and file, for the History's diffs.
 * Kept with the run, so a past run still shows them after a revert. Bounded, and passed through `clean` (secret redaction).
 */
export function codeChanges(
  actions: unknown,
  {
    clean = line => line,
    profileEnv = () => null,
  }: { clean?: (line: string) => string; profileEnv?: (action: Loose) => unknown } = {},
): CodeChange[] {
  const cleaned = (line: unknown) => clean(String(line)).slice(0, 300);
  const lines = (value: unknown) => (typeof value === 'string' ? value : '').split('\n').slice(0, 60).map(cleaned);
  const settings = (value: unknown) =>
    value && typeof value === 'object'
      ? Object.entries(value)
          .slice(0, 60)
          .map(([name, set]) => cleaned(`${name}=${String(set)}`))
      : [];
  return listOf(actions)
    .map(action => (action ?? {}) as Loose)
    .filter(action => CODE_KINDS.includes(action['kind'] as string))
    .slice(0, 40)
    .map(action => {
      const kind = action['kind'] as string;
      const base = { app: text(action['app'] ?? action['repo'], 64), kind, file: text(action['file'], 300) };
      if (kind === 'edit')
        return { ...base, title: 'Temporary edit', removed: lines(action['before']), added: lines(action['after']) };
      if (kind === 'env-file') {
        const added = Array.isArray(action['lines']) ? (action['lines'] as unknown[]) : lines(action['lines']);
        const title = action['created'] ? 'New file' : 'Lines added';
        return { ...base, title, removed: [], added: added.slice(0, 60).map(cleaned) };
      }
      if (kind === 'checkout')
        return { ...base, title: 'Branch switched', removed: [text(action['from'])], added: [text(action['to'])] };
      const title = `${action['created'] ? 'New' : 'Changed'} launch profile ${text(action['name'], 80)}`;
      return { ...base, title, removed: settings(action['previous']), added: settings(profileEnv(action)) };
    });
}

/**
 * Runs oldest first, each with its state: waiting (nobody picked it up), applying, done, failed, or replaced by a
 * newer Send before it was picked up.
 */
export function readRuns(raw: string | null | undefined): Run[] {
  const runs = new Map<string, Run>();
  for (const line of (raw ?? '').split('\n')) {
    let entry: Loose | null;
    try {
      entry = JSON.parse(line) as Loose | null;
    } catch {
      continue;
    }
    const id = entry?.['id'];
    if (!entry || !isId(id, RUN_ID)) continue;
    if (entry['event']) {
      const run = runs.get(id);
      if (!run) continue;
      if (entry['event'] === 'picked') run.state = run.state === 'waiting' ? 'applying' : run.state;
      else
        Object.assign(run, {
          state: entry['event'] === 'failed' ? 'failed' : 'done',
          endedAt: entry['at'],
          ...(Array.isArray(entry['changes']) && { changes: entry['changes'] as CodeChange[] }),
          ...(!!entry['reason'] && { reason: entry['reason'] }),
        });
    } else if (entry['nodes']) runs.set(id, { ...(entry as unknown as RunRecord), state: 'waiting' });
  }
  const list = [...runs.values()];
  // A waiting Send is replaced by any newer one; one being applied only by a newer one the agent picked up.
  list.forEach((run, at) => {
    const later = list.slice(at + 1) as Partial<Run>[];
    const newer = later.some(next => next.kind);
    const pickedUp = later.some(next => next.kind && next.state !== 'waiting' && next.state !== 'replaced');
    if ((run.state === 'waiting' && newer) || (run.state === 'applying' && pickedUp)) run.state = 'replaced';
  });
  return list.slice(-MAX_RUNS);
}
export const runs = (): Run[] => {
  try {
    return readRuns(fs.readFileSync(historyFile(), 'utf8'));
  } catch {
    return [];
  }
};
export const live = (): LiveBoard | null => {
  try {
    return JSON.parse(fs.readFileSync(liveFile(), 'utf8')) as LiveBoard | null;
  } catch {
    return null;
  }
};

/**
 * What a listener hands the agent from the queue: of the Sends and Stops only the newest (it replaces the rest, which
 * then show as replaced), every other prompt as it is; each with the minutes it waited, so a stale one is asked about first.
 */
export function pickPrompts(lines: string[], now = Date.now()): (Prompt & { waited: number })[] {
  const all = lines.flatMap(line => {
    try {
      const prompt = JSON.parse(line) as Prompt | null;
      return prompt ? [prompt] : [];
    } catch {
      return [];
    }
  });
  const boards = all.filter(prompt => prompt.tag === 'koppler' || prompt.tag === 'koppler-stop');
  const newest = boards.at(-1);
  return all
    .filter(prompt => !boards.includes(prompt) || prompt === newest)
    .map(prompt => ({
      ...prompt,
      waited: Math.max(0, Math.round((now - Date.parse(prompt.at ?? '')) / 60000)) || 0,
    }));
}

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
    const { finishTaken } = await import('./listen.ts');
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
    const { markRuns } = await import('./recipes.ts');
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
    console.log(JSON.stringify(all, null, 2));
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
