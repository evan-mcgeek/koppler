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
