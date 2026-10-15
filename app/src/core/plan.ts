// What a Run will do: the board the user wants, compared with the board last applied and with what is really running.
// Used by the canvas, the server and the command line, so the user is shown exactly what is then done.

/** Where an app is started: by Koppler from the command line, or by the user in their IDE. */
export type RunIn = 'cli' | 'ide';

export interface BoardNode {
  branch: string;
  run: RunIn;
  platform?: string;
  note?: string;
  tunnels?: false;
  /** It is on its queues: a queue the board runs locally is the local one for it too. Off by default. */
  queues?: true;
  changes?: string;
  libraries?: string[];
  /** Asked to start again, though nothing about it changed. */
  restart?: true;
  /** Restarted whenever a file in its clone changes. */
  watch?: true;
}
export interface Edge {
  from: string;
  to: string;
}
/** A board in one shape, whatever it was read from. */
export interface Board {
  env: string | null;
  nodes: Record<string, BoardNode>;
  edges: Edge[];
  /** Queues switched to a local copy; the others stay deployed. */
  queues: Record<string, 'local'>;
}

/** A board as it arrives: from the page (nodes as a list), a saved run (nodes by id), or nothing at all. */
interface NodeInput {
  branch?: string | null;
  run?: RunIn;
  platform?: string;
  note?: unknown;
  tunnels?: unknown;
  queues?: unknown;
  changes?: unknown;
  libraries?: unknown;
  restart?: unknown;
  watch?: unknown;
}
export interface BoardInput {
  env?: string | null;
  nodes?: Record<string, NodeInput | null> | (NodeInput & { id: string })[];
  edges?: (Edge | null)[];
  queues?: Record<string, unknown>;
}

export interface Step {
  id: string;
  /** Why this happens, in words for the review; empty when the reason is plain (a new app starts). */
  why: string[];
}
export interface Plan {
  env: string | null;
  envChange: { from: string; to: string } | null;
  starts: Step[];
  restarts: Step[];
  stops: Step[];
  keeps: Step[];
  /** True when the board already matches what runs. */
  nothing: boolean;
}

export interface PlanOptions {
  /** An app's name, for the wording. */
  name?: (id: string) => string;
  /** Whether Koppler itself runs the app now; undefined when that is not known. */
  running?: (id: string) => boolean | undefined;
  /** Apps Koppler runs that no applied board explains. */
  strays?: string[];
  /** The environment `koppler run <app>` started a stray on. */
  startedOn?: (id: string) => string | undefined;
  /** The queues an app publishes to or reads. */
  queuesOf?: (id: string) => string[];
  /** The branch an app's clone is on, for an app that runs on whatever that is. */
  current?: (id: string) => string | undefined;
}

// A note or a list of changes is text; anything else that arrives in its place is dropped.
const text = (value: unknown) => (typeof value === 'string' ? value : '');
const nodeOf = (n: NodeInput | null): BoardNode => ({
  branch: n?.branch || '',
  run: n?.run || 'cli',
  ...(n?.platform && { platform: n.platform }),
  ...(text(n?.note) && { note: text(n?.note) }),
  ...(n?.tunnels === false && { tunnels: false as const }),
  ...(n?.queues === true && { queues: true as const }),
  ...(text(n?.changes) && { changes: text(n?.changes) }),
  ...(Array.isArray(n?.libraries) && n.libraries.length > 0 && { libraries: n.libraries.map(String).sort() }),
  ...(n?.restart === true && { restart: true as const }),
  ...(n?.watch === true && { watch: true as const }),
});

export function board(input: BoardInput | null | undefined): Board {
  const given = input?.nodes ?? {};
  const list: [string, NodeInput | null][] = Array.isArray(given) ? given.map(n => [n.id, n]) : Object.entries(given);
  const nodes = Object.fromEntries(list.filter(([id]) => typeof id === 'string').map(([id, n]) => [id, nodeOf(n)]));
  const edges = (Array.isArray(input?.edges) ? input.edges : [])
    .filter((e): e is Edge => !!e && Object.hasOwn(nodes, e.from) && Object.hasOwn(nodes, e.to))
    .map(e => ({ from: e.from, to: e.to }));
  const queues = Object.fromEntries(
    Object.entries(input?.queues ?? {}).flatMap(([id, where]) => (where === 'local' ? [[id, 'local' as const]] : [])),
  );
  return { env: input?.env ?? null, nodes, edges, queues };
}

const callees = (b: Board, id: string) =>
  b.edges
    .filter(e => e.from === id)
    .map(e => e.to)
    .sort();
const upper = (env: string) => env.toUpperCase();
const where = (run: RunIn) => (run === 'ide' ? 'your IDE' : 'the command line');

/** Why an app that runs and stays on the board has to start again; empty when it can keep running. */
function reasonsToRestart(
  id: string,
  live: Board,
  want: Board,
  envChange: Plan['envChange'],
  o: PlanOptions,
): string[] {
  const now = live.nodes[id];
  const next = want.nodes[id];
  if (!now || !next) return [];
  const name = (other: string) => o.name?.(other) ?? other;
  const why: string[] = [];
  if (next.restart) why.push('you asked to restart it');
  if (envChange) why.push(`the environment changes from ${upper(envChange.from)} to ${upper(envChange.to)}`);
  if (now.branch !== next.branch)
    why.push(
      `its branch changes from ${now.branch || o.current?.(id) || 'the current one'} to ${next.branch || 'the current one'}`,
    );
  if (now.run !== next.run) why.push(`it moves from ${where(now.run)} to ${where(next.run)}`);
  if ((now.platform ?? '') !== (next.platform ?? '') && next.run === 'cli')
    why.push(`its device changes to ${String(next.platform)}`);
  const before = callees(live, id);
  const after = callees(want, id);
  for (const c of after.filter(x => !before.includes(x))) why.push(`it starts calling your local ${name(c)}`);
  for (const c of before.filter(x => !after.includes(x))) why.push(`it goes back to the deployed ${name(c)}`);
  if ((now.note ?? '') !== (next.note ?? '')) why.push('its note changed');
  // Libraries switched to (or away from) the local copy are picked up when it starts again.
  const had = now.libraries ?? [];
  const has = next.libraries ?? [];
  for (const l of has.filter(x => !had.includes(x))) why.push(`it uses your local ${l}`);
  for (const l of had.filter(x => !has.includes(x))) why.push(`it goes back to the published ${l}`);
  // An app on a queue that moves between local and deployed starts again with the other queue's address. An app
  // that keeps the deployed queues is on the deployed one whatever the board runs locally.
  const onLocal = (side: Board, node: BoardNode, q: string) => node.queues === true && Object.hasOwn(side.queues, q);
  for (const q of o.queuesOf?.(id) ?? [])
    if (onLocal(live, now, q) !== onLocal(want, next, q))
      why.push(`it moves to the ${onLocal(want, next, q) ? 'local' : 'deployed'} ${q} queue`);
  return why;
}

export function plan(
  liveInput: BoardInput | null | undefined,
  desiredInput: BoardInput | null | undefined,
  options: PlanOptions = {},
): Plan {
  const live = board(liveInput);
  const want = board(desiredInput);
  const strays = options.strays ?? [];
  const envChange =
    live.env && want.env && live.env !== want.env && Object.keys(live.nodes).length > 0
      ? { from: live.env, to: want.env }
      : null;
  const starts: Step[] = [];
  const restarts: Step[] = [];
  const stops: Step[] = [];
  const keeps: Step[] = [];
  for (const [id, next] of Object.entries(want.nodes)) {
    if (!Object.hasOwn(live.nodes, id)) {
      // Started by id on this environment and calling nothing local: it already is what the board asks for.
      const asAsked =
        options.startedOn?.(id) === want.env && callees(want, id).length === 0 && !next.note && !next.branch;
      if (!strays.includes(id)) starts.push({ id, why: [] });
      else if (asAsked) keeps.push({ id, why: ['you started it with koppler run'] });
      else restarts.push({ id, why: ['it is running, but not from a run Koppler recorded'] });
    } else if (options.running?.(id) === false && next.run !== 'ide') {
      starts.push({ id, why: ['it was started before but is not running now'] });
    } else {
      const why = reasonsToRestart(id, live, want, envChange, options);
      (why.length > 0 ? restarts : keeps).push({ id, why });
    }
  }
  for (const id of [...Object.keys(live.nodes), ...strays])
    if (!Object.hasOwn(want.nodes, id) && !stops.some(s => s.id === id)) stops.push({ id, why: [] });
  const nothing = starts.length + restarts.length + stops.length === 0;
  return { env: want.env, envChange, starts, restarts, stops, keeps, nothing };
}

const KINDS_OF_STEP = [
  ['starts', 'START'],
  ['restarts', 'RESTART'],
  ['stops', 'STOP AND REVERT'],
  ['keeps', 'KEEP RUNNING'],
] as const;

/** The plan in plain lines, for the review before a Run, the prompt and the terminal. */
export function describe(p: Plan, options: Pick<PlanOptions, 'name'> = {}): string[] {
  const name = (id: string) => options.name?.(id) ?? id;
  const line = (step: Step) => name(step.id) + (step.why.length > 0 ? ` (${step.why.join('; ')})` : '');
  const lines = KINDS_OF_STEP.filter(([key]) => p[key].length > 0).map(
    ([key, title]) => `${title}: ${p[key].map(line).join(', ')}`,
  );
  return lines.length > 0 ? lines : ['NOTHING TO CHANGE'];
}

type StepsOnly = Partial<Pick<Plan, 'starts' | 'restarts' | 'stops' | 'keeps'>>;
const idsOf = (p: StepsOnly | null | undefined) =>
  JSON.stringify(KINDS_OF_STEP.map(([key]) => (p?.[key] ?? []).map(step => step.id).sort()));
/** True when two plans would start, restart, stop and keep the same apps. */
export const same = (a: StepsOnly | null | undefined, b: StepsOnly | null | undefined) => idsOf(a) === idsOf(b);

/** Queue types a stack can name, and the ones Koppler can run on this machine (in an emulator). */
export const QUEUE_TYPES = ['sqs', 'sns', 'eventbridge', 'kafka', 'other'] as const;
export const LOCAL_QUEUE_TYPES = ['sqs', 'kafka'] as const;

interface AppQueues {
  publishes?: Record<string, unknown> | undefined;
  reads?: Record<string, unknown> | undefined;
}
/** The queues an app publishes to or reads, from the stack. */
export function queuesOf(stack: { apps?: Record<string, AppQueues> } | null | undefined, id: string): string[] {
  const app = stack?.apps?.[id];
  return [...new Set([...Object.keys(app?.publishes ?? {}), ...Object.keys(app?.reads ?? {})])];
}

interface Environments {
  envs?: string[] | undefined;
  protected?: string[] | undefined;
}
/**
 * The environments where a mistake costs something (production, usually). The stack names them in `protected`;
 * without that, every environment except the first. They get the red frame, a review that blocks on what is missing,
 * and secrets that ask on every read. Never decided by an environment's name.
 */
export function protectedEnvs(stack: Environments | null | undefined): string[] {
  const envs = stack?.envs ?? [];
  const named = stack?.protected;
  return Array.isArray(named) ? envs.filter(env => named.includes(env)) : envs.slice(1);
}
export const isProtected = (stack: Environments | null | undefined, env: string) => protectedEnvs(stack).includes(env);
