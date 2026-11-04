// Areas: parts of a big stack a person can choose to see. A view only: runs, environments and secrets stay the same.

type Areas = Record<string, unknown>;
type HasAreas = { areas?: readonly string[] | undefined };

/** Whether an app shows for the chosen areas: it is in one of them, or in none. No choice shows every app. */
export const inAreas = (app: HasAreas, chosen: readonly string[] | undefined): boolean =>
  !chosen?.length || !app.areas?.length || app.areas.some(area => chosen.includes(area));

/**
 * A board's area: the one set by hand, else the one most of its apps are in, counting only apps that have one. A tie
 * goes to the area with fewer apps in the stack, then to the first in the stack.
 */
export function boardArea(
  stack: { areas?: Areas | undefined; apps: Record<string, HasAreas | undefined> },
  board: { nodes: Record<string, unknown>; area?: string },
): { id?: string; by: 'hand' | 'apps' } {
  const order = Object.keys(stack.areas ?? {});
  if (board.area && order.includes(board.area)) return { id: board.area, by: 'hand' };
  const count = (ids: string[]) => {
    const counts = new Map<string, number>();
    for (const id of ids)
      for (const area of (Object.hasOwn(stack.apps, id) ? stack.apps[id]?.areas : undefined) ?? [])
        if (order.includes(area)) counts.set(area, (counts.get(area) ?? 0) + 1);
    return counts;
  };
  const onBoard = count(Object.keys(board.nodes));
  const size = count(Object.keys(stack.apps));
  const [id] = [...onBoard.keys()].sort(
    (a, b) =>
      (onBoard.get(b) ?? 0) - (onBoard.get(a) ?? 0) ||
      (size.get(a) ?? 0) - (size.get(b) ?? 0) ||
      order.indexOf(a) - order.indexOf(b),
  );
  return id ? { id, by: 'apps' } : { by: 'apps' };
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
 * Team boards under their area, in the stack's order, then those in no area; with a choice, only the chosen areas'
 * groups and the no-area one, and what the others hold.
 */
export function boardGroups<B extends { name: string; nodes: Record<string, unknown>; area?: unknown }>(
  stack: Stack,
  boards: readonly B[],
  chosen: readonly string[] | undefined,
): { groups: { title: string; area?: string; boards: B[] }[]; hidden: { count: number; areas: string[] } } {
  const of = (board: B) =>
    boardArea(stack, { nodes: board.nodes, ...(typeof board.area === 'string' && { area: board.area }) }).id;
  const all: { title: string; area?: string; boards: B[] }[] = [
    ...Object.keys(stack.areas ?? {}).map(area => ({
      title: nameOf(stack, area),
      area,
      boards: boards.filter(board => of(board) === area),
    })),
    { title: 'No area', boards: boards.filter(board => !of(board)) },
  ].filter(group => group.boards.length);
  const shown = (group: { area?: string }) => !narrows(stack, chosen) || !group.area || chosen.includes(group.area);
  const hid = all.filter(group => !shown(group));
  return {
    groups: all.filter(shown),
    hidden: { count: hid.reduce((n, group) => n + group.boards.length, 0), areas: hid.map(group => group.title) },
  };
}
