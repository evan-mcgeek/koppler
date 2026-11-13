// An exported page's data: the stack cut down to what its Discover draws for the flows, and nothing else of it.
import type { Point } from './arrange.ts';
import { sourced, type Card } from './discover.ts';
import { featureCards, featureOf, type Feature } from './feature.ts';
import { STACK_FORMAT } from './migrations/stack/index.ts';
import type { Stack } from './stack.ts';

/** A feature board as the page opens it: its accepted steps, and where its author left the cards. */
export interface PageBoard extends Record<string, unknown> {
  name: string;
  version: 1;
  nodes: Record<string, never>;
  edges: never[];
  feature: Feature;
  /** Where its author left the cards, and the layout Arrange last chose. */
  discover: { open: never[]; at: Record<Card, Point>; layout?: number };
}
export interface Exported {
  stack: string;
  /** ISO date. */
  exported: string;
  /** The environment the page was made for, when one board was shared from a canvas. */
  env?: string;
  /** The scheme the page opens in, when shared from a canvas; the reader can pick another. */
  scheme?: string;
  /** The stack as the page reads it: the flows' cards by name, kind and what each does, and the links between them. */
  facts: Record<string, unknown>;
  boards: PageBoard[];
}

/** A board as the stack or this Mac keeps it: only its name is sure. */
type Board = { name: string } & Record<string, unknown>;
const pick = <T>(from: Record<string, T> | undefined, keep: (id: string) => boolean): Record<string, T> =>
  Object.fromEntries(Object.entries(from ?? {}).filter(([id]) => keep(id)));
const map = <T, U>(from: Record<string, T>, to: (value: T, id: string) => U): Record<string, U> =>
  Object.fromEntries(Object.entries(from).map(([id, value]) => [id, to(value, id)]));
const some = <T extends object>(value: T) => (Object.keys(value).length ? value : undefined);

/** Each feature board, the team's unless others are given, and the stack as the page needs it for them. */
export function exportedOf(
  stack: Stack & { found?: Record<string, Record<string, string>> },
  given: readonly Board[] = stack.presets ?? [],
  talk = false,
): Pick<Exported, 'facts' | 'boards'> {
  const boards = given.flatMap((preset): PageBoard[] => {
    const feature = featureOf(preset['feature']);
    if (!feature) return [];
    const phases = feature.phases
      .map(phase => ({ ...phase, steps: phase.steps.filter(step => !step.proposed) }))
      .filter(phase => phase.steps.length);
    // Only the words of open threads leave: no times, and ids that say nothing.
    const comments = (talk ? (feature.comments ?? []) : [])
      .filter(one => !one.resolved)
      .map((one, at) => ({
        id: String(at + 1),
        on: one.on,
        thread: one.thread.map(({ by, text }) => ({ by, at: '', text })),
      }));
    const accepted: Feature = {
      request: feature.request,
      cards: feature.cards,
      phases,
      ...(comments.length && { comments }),
    };
    const kept = preset['discover'] as { at?: Record<Card, Partial<Point>>; layout?: unknown } | undefined;
    const saved = kept?.at ?? {};
    const layout = typeof kept?.layout === 'number' ? { layout: kept.layout } : {};
    const at = Object.fromEntries(
      featureCards(accepted).flatMap(card => {
        const point = saved[card];
        return typeof point?.x === 'number' && typeof point.y === 'number' ? [[card, { x: point.x, y: point.y }]] : [];
      }),
    );
    return [
      { name: preset.name, version: 1, nodes: {}, edges: [], feature: accepted, discover: { open: [], at, ...layout } },
    ];
  });
  const cards = new Set(boards.flatMap(one => featureCards(one.feature)));
  const has = (prefix: string) => (id: string) => cards.has(`${prefix}${id}`);
  const isApp = has('');
  const apps = map(pick(stack.apps, isApp), app => {
    const consumes = map(pick(app.consumes, isApp), call =>
      sourced(call) ? { how: call.how && call.how !== 'unknown' ? call.how : 'env' } : {},
    );
    const publishes = map(pick(app.publishes, has('queue:')), () => ({}));
    const reads = map(pick(app.reads, has('queue:')), () => ({}));
    const uses = map(pick(app.uses, has('database:')), () => ({}));
    const buckets = map(pick(app.buckets, has('resource:')), use => ({ access: use.access }));
    return {
      name: app.name,
      kind: app.kind,
      ...(app.description && { description: app.description }),
      ...(app.outside && { outside: app.outside }),
      ...(app.schedule && { schedule: app.schedule }),
      ...(some(consumes) && { consumes }),
      ...(some(publishes) && { publishes }),
      ...(some(reads) && { reads }),
      ...(some(uses) && { uses }),
      ...(some(buckets) && { buckets }),
    };
  });
  // Found in the code: that it was, not where.
  const found = map(pick(stack.found, isApp), calls => map(pick(calls, isApp), () => ''));
  const queues = map(pick(stack.queues, has('queue:')), queue => {
    const feeds = map(pick(queue.feeds, has('queue:')), () => ({}));
    return { name: queue.name, type: queue.type, ...(some(feeds) && { feeds }) };
  });
  const databases = map(pick(stack.databases, has('database:')), database => ({
    ...(database.name && { name: database.name }),
    ...(database.kind && { kind: database.kind }),
  }));
  const resources = map(pick(stack.resources, has('resource:')), resource => {
    // A route's own words are its path: each is only counted.
    const routes = Object.fromEntries(
      Object.values(resource.routes ?? {})
        .filter(to => cards.has(to))
        .map((to, at) => [String(at + 1), to]),
    );
    const startedBy = (resource.startedBy ?? []).filter(isApp);
    const steps = (resource.steps ?? []).map(step => ({
      name: step.name,
      ...(step.calls && isApp(step.calls) && { calls: step.calls }),
    }));
    return {
      name: resource.name,
      type: resource.type,
      ...(some(routes) && { routes }),
      ...(startedBy.length && { startedBy }),
      ...(steps.length && { steps }),
    };
  });
  return {
    boards,
    facts: {
      koppler: STACK_FORMAT.version,
      name: stack.name,
      envs: stack.envs,
      apps,
      ...(some(found) && { found }),
      ...(some(queues) && { queues }),
      ...(some(databases) && { databases }),
      ...(some(resources) && { resources }),
      presets: boards,
    },
  };
}

/** A board to export by name: its exact name first, then ignoring case; your own before the team's either way. */
export function boardNamed<B extends Board>(
  own: readonly B[],
  team: readonly B[],
  name: string,
): { board: B } | { error: string } {
  const all = [...own, ...team];
  const board = all.find(one => one.name === name) ?? all.find(one => one.name.toLowerCase() === name.toLowerCase());
  if (!board) {
    const features = all.filter(one => featureOf(one['feature'])).map(one => one.name);
    return { error: `No board called "${name}". Boards with a feature: ${features.join(', ') || 'none'}` };
  }
  if (!featureOf(board['feature']))
    return { error: `${board.name} is not a feature board: only a feature board has steps to put in the page` };
  return { board };
}

/** The page's file name, from the stack's name. */
export const fileNameOf = (stack: string): string =>
  `${
    stack
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, '-')
      .replace(/^-|-$/g, '') || 'stack'
  }-flows.html`;
