// Areas: parts of a big stack a person can choose to see. A view only: runs, environments and secrets stay the same.

type Areas = Record<string, unknown>;
type HasAreas = { areas?: readonly string[] | undefined };

/** Whether an app shows for the chosen areas: it is in one of them, or in none. No choice shows every app. */
export const inAreas = (app: HasAreas, chosen: readonly string[] | undefined): boolean =>
  !chosen?.length || !app.areas?.length || app.areas.some(area => chosen.includes(area));

/** The areas a board's apps are in, most apps first; a tie goes to the area with fewer apps in the stack, then to the first in the stack. */
function ranked(stack: { areas?: Areas | undefined; apps: Record<string, HasAreas | undefined> }, ids: string[]) {
  const order = Object.keys(stack.areas ?? {});
  const count = (of: string[]) => {
    const counts = new Map<string, number>();
    for (const id of of)
      for (const area of (Object.hasOwn(stack.apps, id) ? stack.apps[id]?.areas : undefined) ?? [])
        if (order.includes(area)) counts.set(area, (counts.get(area) ?? 0) + 1);
    return counts;
  };
  const onBoard = count(ids);
  const size = count(Object.keys(stack.apps));
  const areas = [...onBoard.keys()].sort(
    (a, b) =>
      (onBoard.get(b) ?? 0) - (onBoard.get(a) ?? 0) ||
      (size.get(a) ?? 0) - (size.get(b) ?? 0) ||
      order.indexOf(a) - order.indexOf(b),
  );
  const top = onBoard.get(areas[0] ?? '') ?? 0;
  return { areas, onBoard, size, tied: areas.filter(area => onBoard.get(area) === top) };
}

/**
 * A board's area: the one set by hand, else the one most of its apps are in, counting only apps that have one. A tie
 * goes to the area with fewer apps in the stack, then to the first in the stack.
 */
export function boardArea(
  stack: { areas?: Areas | undefined; apps: Record<string, HasAreas | undefined> },
  board: { nodes: Record<string, unknown>; area?: string },
): { id?: string; by: 'hand' | 'apps'; tie?: true } {
  if (board.area && Object.hasOwn(stack.areas ?? {}, board.area)) return { id: board.area, by: 'hand' };
  const { areas, tied } = ranked(stack, Object.keys(board.nodes));
  const [id] = areas;
  return id ? { id, by: 'apps', ...(tied.length > 1 && { tie: true as const }) } : { by: 'apps' };
}

/** Why its apps put a board in an area, in a few words: "Payments: 2 of its 3 apps", or how a tie was settled. */
export function areaWhy(
  stack: { areas?: Record<string, { name: string }> | undefined; apps: Record<string, HasAreas | undefined> },
  board: { nodes: Record<string, unknown> },
): string {
  const ids = Object.keys(board.nodes);
  const { onBoard, size, tied } = ranked(stack, ids);
  const name = (id: string) => stack.areas?.[id]?.name ?? id;
  const [first] = tied;
  if (!first) return 'None of its apps is in an area';
  const n = onBoard.get(first) ?? 0;
  if (tied.length === 1)
    return `${name(first)}: ${String(n)} of its ${String(ids.length)} ${ids.length === 1 ? 'app' : 'apps'}`;
  const order = Object.keys(stack.areas ?? {});
  const listed = [...tied].sort((a, b) => order.indexOf(a) - order.indexOf(b));
  const counts = listed
    .map((id, at) => `${String(n)}${at ? '' : n === 1 ? ' app' : ' apps'} in ${name(id)}`)
    .join(', ');
  const smaller = tied.some(id => size.get(id) !== size.get(first));
  return `${counts}. ${name(first)} ${smaller ? 'is smaller' : 'comes first'}`;
}

/** An id for a new area, from its name: lowercase letters, digits and dashes, not one taken. */
export function areaId(name: string, taken: readonly string[]): string {
  const base =
    name
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, '-')
      .replace(/^-|-$/g, '') || 'area';
  const keyed = /^\d+$/.test(base) ? `area-${base}` : base;
  let id = keyed;
  for (let n = 2; taken.includes(id); n++) id = `${keyed}-${String(n)}`;
  return id;
}

type Json = Record<string, unknown>;
const json = (value: unknown): Json =>
  typeof value === 'object' && value !== null && !Array.isArray(value) ? (value as Json) : {};
const presetsOf = (stack: unknown) => {
  const presets = json(stack)['presets'];
  return Array.isArray(presets) ? (presets as unknown[]).map(json) : [];
};

/** What an area holds: its apps by name, and the team boards in it, worked out or set by hand. */
export function areaUse(stack: unknown, id: string): { apps: string[]; boards: string[]; byHand: string[] } {
  const facts = json(stack) as { areas?: Areas; apps: Record<string, HasAreas & { name?: string }> };
  const apps = Object.entries(json(facts.apps) as Record<string, HasAreas & { name?: string }>)
    .filter(([, app]) => app.areas?.includes(id))
    .map(([key, app]) => app.name ?? key);
  const named = (preset: Json) => (typeof preset['name'] === 'string' ? preset['name'] : '');
  const inIt = presetsOf(stack).filter(
    preset =>
      boardArea(facts, {
        nodes: json(preset['nodes']),
        ...(typeof preset['area'] === 'string' && { area: preset['area'] }),
      }).id === id,
  );
  return {
    apps,
    boards: inIt.map(named),
    byHand: inIt.filter(preset => preset['area'] === id).map(named),
  };
}

/** The stack without an area: out of its areas, out of every app's list, and off every team board set to it; every key stays where it was. */
export function withoutArea<S>(stack: S, id: string): S {
  // A key mapped to undefined is dropped where it stands.
  const each = (value: Json, change: (key: string, one: unknown) => unknown): Json =>
    Object.fromEntries(
      Object.entries(value).flatMap(([key, one]) => {
        const next = change(key, one);
        return next === undefined ? [] : [[key, next]];
      }),
    );
  return each(json(stack), (key, value) => {
    if (key === 'areas') {
      const left = each(json(value), area => (area === id ? undefined : json(value)[area]));
      return Object.keys(left).length ? left : undefined;
    }
    if (key === 'apps')
      return each(json(value), (_, one) => {
        const app = json(one);
        if (!Array.isArray(app['areas'])) return one;
        const kept = (app['areas'] as unknown[]).filter(area => area !== id);
        return each(app, (field, held) => (field !== 'areas' ? held : kept.length ? kept : undefined));
      });
    if (key === 'presets' && Array.isArray(value))
      return value.map((one: unknown) =>
        json(one)['area'] === id ? each(json(one), (field, held) => (field === 'area' ? undefined : held)) : one,
      );
    return value;
  }) as S;
}

type Stack = { areas?: Record<string, { name: string }> | undefined; apps: Record<string, HasAreas | undefined> };
const nameOf = (stack: Stack, id: string) => stack.areas?.[id]?.name ?? id;
const appAreas = (stack: Stack, id: string) =>
  ((Object.hasOwn(stack.apps, id) ? stack.apps[id]?.areas : undefined) ?? []).filter(area =>
    Object.hasOwn(stack.areas ?? {}, area),
  );

/** Whether a choice narrows anything: none, or every area, shows all. */
export const narrows = (stack: Stack, chosen: readonly string[] | undefined): chosen is readonly string[] =>
  !!chosen?.length && Object.keys(stack.areas ?? {}).some(area => !chosen.includes(area));

export interface AppGroup {
  title: string;
  area?: string;
  apps: { id: string; also: string[]; outside?: true }[];
}

/**
 * The Apps list under a choice of areas, from the apps it would show in order: the board's own outside the areas
 * first, then each chosen area in the stack's order, then apps in no area. An app in several areas lists once, under
 * the first chosen, with its other areas. Null when the choice narrows nothing.
 */
export function appGroups(
  stack: Stack,
  ids: readonly string[],
  onBoard: readonly string[],
  chosen: readonly string[] | undefined,
): { groups: AppGroup[]; hidden: number } | null {
  if (!narrows(stack, chosen)) return null;
  const order = Object.keys(stack.areas ?? {}).filter(area => chosen.includes(area));
  const home = (id: string) => order.find(area => appAreas(stack, id).includes(area));
  const groups: AppGroup[] = [
    {
      title: 'On this board',
      apps: ids
        .filter(id => onBoard.includes(id) && appAreas(stack, id).length && !home(id))
        .map(id => ({ id, also: [], outside: true as const })),
    },
    ...order.map(area => ({
      title: nameOf(stack, area),
      area,
      apps: ids
        .filter(id => home(id) === area)
        .map(id => ({
          id,
          also: appAreas(stack, id)
            .filter(other => other !== area)
            .map(other => nameOf(stack, other)),
        })),
    })),
    { title: 'No area', apps: ids.filter(id => !appAreas(stack, id).length).map(id => ({ id, also: [] })) },
  ];
  return { groups: groups.filter(group => group.apps.length), hidden: hiddenBy(stack, chosen, onBoard).apps.length };
}

/** The apps a choice of areas hides, but those in `keep`, and the names of the areas they are in, in the stack's order. */
export function hiddenBy(
  stack: Stack,
  chosen: readonly string[] | undefined,
  keep: readonly string[],
): { apps: string[]; areas: string[] } {
  if (!narrows(stack, chosen)) return { apps: [], areas: [] };
  const apps = Object.keys(stack.apps).filter(
    id => !keep.includes(id) && !inAreas({ areas: appAreas(stack, id) }, chosen),
  );
  const areas = Object.keys(stack.areas ?? {}).filter(area => apps.some(id => appAreas(stack, id).includes(area)));
  return { apps, areas: areas.map(area => nameOf(stack, area)) };
}

/**
 * Boards under their area, in the stack's order, then those in no area; inside each, by name ignoring case. With a choice, only the chosen areas' groups and the no-area one, and what the others hold.
 */
export function boardGroups<B extends { name: string; nodes: Record<string, unknown>; area?: unknown; mine?: boolean }>(
  stack: Stack,
  boards: readonly B[],
  chosen: readonly string[] | undefined,
): {
  groups: { title: string; area?: string; boards: B[] }[];
  hidden: { count: number; team: number; yours: number; areas: string[] };
} {
  const of = (board: B) =>
    boardArea(stack, { nodes: board.nodes, ...(typeof board.area === 'string' && { area: board.area }) }).id;
  const sorted = [...boards].sort(
    (a, b) =>
      a.name.toLowerCase().localeCompare(b.name.toLowerCase()) ||
      Number(!!a.mine) - Number(!!b.mine) ||
      a.name.localeCompare(b.name),
  );
  const all: { title: string; area?: string; boards: B[] }[] = [
    ...Object.keys(stack.areas ?? {}).map(area => ({
      title: nameOf(stack, area),
      area,
      boards: sorted.filter(board => of(board) === area),
    })),
    { title: 'No area', boards: sorted.filter(board => !of(board)) },
  ].filter(group => group.boards.length);
  const shown = (group: { area?: string }) => !narrows(stack, chosen) || !group.area || chosen.includes(group.area);
  const hid = all.filter(group => !shown(group)).flatMap(group => group.boards);
  return {
    groups: all.filter(shown),
    hidden: {
      count: hid.length,
      team: hid.filter(board => !board.mine).length,
      yours: hid.filter(board => board.mine).length,
      areas: all.filter(group => !shown(group)).map(group => group.title),
    },
  };
}
