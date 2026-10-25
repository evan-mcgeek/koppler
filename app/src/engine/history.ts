// Run history: every Send and Stop from the canvas is kept as a record (what was asked, the plan the user confirmed, how
// it ended), and the board last applied is kept as the live state the next plan is compared with. Names only, never secrets.
import fs from 'node:fs';
import path from 'node:path';
import * as kp from '../core/plan.ts';
import { APP_ID, RUN_ID } from '../ids.ts';
import { readStack } from '../data.ts';
import { tempDir } from '../paths.ts';

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
  databases?: Record<string, 'local'>;
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
  databases?: Record<string, 'local'>;
}
/** A prompt from the canvas, as it sits in the queue. */
export interface Prompt {
  tag?: string;
  at?: string;
  data?: Loose;
}

const historyFile = () => path.join(tempDir(), 'history.jsonl');
export const liveFile = () => path.join(tempDir(), 'live.json');
export const actionsFile = () => path.join(tempDir(), 'actions.json');
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
export const append = (line: object) => {
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
        ...(node.watch === true && { watch: true }),
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
  // Databases the board switched to the one on this Mac; the rest stay deployed.
  const databases = Object.fromEntries(
    Object.entries((data['databases'] ?? {}) as Loose)
      .filter(([database, where]) => ID.test(database) && where === 'local')
      .slice(0, 50),
  ) as Record<string, 'local'>;
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
    ...(Object.keys(databases).length && { databases }),
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
export const NOTE_WORDS = {
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

const CODE_KINDS = ['edit', 'file', 'profile', 'env-file', 'checkout'];
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
      if (kind === 'edit' || kind === 'file')
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
