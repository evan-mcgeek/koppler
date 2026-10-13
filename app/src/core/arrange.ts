// Arrange: where the cards of a board go. Layers by call depth, each layer ordered so cables cross as little as
// possible, laid out down the board (rows) or across it (columns). Pure geometry: the page measures the cards and
// places them.
import type { Edge } from './plan.ts';

export interface Size {
  w: number;
  h: number;
}
export interface Point {
  x: number;
  y: number;
}
export type Direction = 'down' | 'right';
export type Side = 'top' | 'right' | 'bottom' | 'left';
/** How tight a layout is and where it starts. */
export interface Spacing {
  /** The board's own margin. */
  pad: number;
  /** Packs tighter: cards for reading, not for wiring. */
  tight?: boolean;
}

const GAP_X = 80;
const GAP_Y = 90;
const get = <T>(from: Record<string, T>, key: string): T => from[key] as T;

/**
 * Cables crossing each other are counted between neighbouring layers. A cable that skips layers passes a waypoint in
 * each one it crosses, so it is counted where it really runs (the usual layered-graph method).
 */
function withWaypoints(layers: string[][], edges: Edge[]) {
  // Rows are the layers as laid out (empty depths already dropped), so a card's row is its index here.
  const rows = layers.map(layer => [...layer]);
  const links: [string, string][] = [];
  const row: Record<string, number> = {};
  rows.forEach((layer, at) => {
    for (const id of layer) row[id] = at;
  });
  for (const edge of edges) {
    const forwards = get(row, edge.from) <= get(row, edge.to);
    const to = forwards ? edge.to : edge.from;
    let from = forwards ? edge.from : edge.to;
    if (row[from] === row[to]) continue;
    for (let at = get(row, from) + 1; at < get(row, to); at++) {
      const waypoint = `~${edge.from}>${edge.to}:${String(at)}`;
      row[waypoint] = at;
      rows[at]?.push(waypoint);
      links.push([from, waypoint]);
      from = waypoint;
    }
    links.push([from, to]);
  }
  return { rows, links, row };
}
const placesIn = (rows: string[][]) => {
  const place: Record<string, number> = {};
  for (const layer of rows) layer.forEach((id, at) => (place[id] = at));
  return place;
};
function crossingsOf(rows: string[][], links: [string, string][], row: Record<string, number>): number {
  const place = placesIn(rows);
  let crossings = 0;
  links.forEach(([a1, a2], first) => {
    for (const [b1, b2] of links.slice(first + 1)) {
      if (row[a1] !== row[b1]) continue;
      if ((get(place, a1) - get(place, b1)) * (get(place, a2) - get(place, b2)) < 0) crossings++;
    }
  });
  return crossings;
}
/**
 * Orders each layer so cables cross as little as possible: each card (and waypoint) moves to the average place of its
 * neighbours in the layer before it, sweeping down then up; the order with the fewest crossings wins. Returns that
 * number, with `layers` reordered in place.
 */
function orderLayers(layers: string[][], edges: Edge[]): number {
  const { rows, links, row } = withWaypoints(layers, edges);
  const near: Record<string, string[]> = {};
  for (const [a, b] of links) {
    (near[a] ??= []).push(b);
    (near[b] ??= []).push(a);
  }
  let best = rows.map(layer => [...layer]);
  let fewest = crossingsOf(rows, links, row);
  for (let sweep = 0; sweep < 12 && fewest; sweep++) {
    const down = sweep % 2 === 0;
    const order = down
      ? rows.map((_, at) => at).slice(1)
      : rows.map((_, at) => rows.length - 2 - at).filter(at => at >= 0);
    for (const at of order) {
      const place = placesIn(rows);
      const mean = (id: string) => {
        const before = (near[id] ?? []).filter(other => row[other] === at + (down ? -1 : 1));
        return before.length
          ? before.reduce((sum, other) => sum + get(place, other), 0) / before.length
          : get(place, id);
      };
      rows[at]?.sort((a, b) => mean(a) - mean(b));
    }
    const crossings = crossingsOf(rows, links, row);
    if (crossings < fewest) {
      fewest = crossings;
      best = rows.map(layer => [...layer]);
    }
  }
  layers.forEach((layer, at) => {
    layer.splice(0, layer.length, ...(best[at] ?? []).filter(id => !id.startsWith('~')));
  });
  return fewest;
}

/**
 * Which layer each card sits in: callers above callees. Apps that call each other in a loop (directly or through
 * others) share a layer, so a loop cannot push everything after it into one long line.
 */
export function layerDepths(ids: string[], edges: Edge[]): Record<string, number> {
  const out: Record<string, string[]> = Object.fromEntries(ids.map(id => [id, []]));
  for (const { from, to } of edges) if (from in out && to in out && from !== to) out[from]?.push(to);
  // Tarjan: groups of cards that can all reach each other.
  const index: Record<string, number> = {};
  const low: Record<string, number> = {};
  const group: Record<string, number> = {};
  const stack: string[] = [];
  const on = new Set<string>();
  let next = 0;
  let groups = 0;
  const visit = (id: string) => {
    index[id] = low[id] = next++;
    stack.push(id);
    on.add(id);
    for (const callee of out[id] ?? []) {
      if (!(callee in index)) {
        visit(callee);
        low[id] = Math.min(get(low, id), get(low, callee));
      } else if (on.has(callee)) low[id] = Math.min(get(low, id), get(index, callee));
    }
    if (low[id] !== index[id]) return;
    let member: string | undefined;
    do {
      member = stack.pop();
      if (member === undefined) break;
      on.delete(member);
      group[member] = groups;
    } while (member !== id);
    groups++;
  };
  for (const id of ids) if (!(id in index)) visit(id);
  // Longest path between groups; the groups form no loops, so this settles.
  const depthOf = Array<number>(groups).fill(0);
  const depth = (id: string) => depthOf[get(group, id)] ?? 0;
  for (let pass = 0; pass < groups; pass++)
    for (const id of ids)
      for (const callee of out[id] ?? [])
        if (group[id] !== group[callee] && depth(callee) < depth(id) + 1) depthOf[get(group, callee)] = depth(id) + 1;
  return Object.fromEntries(ids.map(id => [id, depth(id)]));
}

/** Where each card's top left corner goes. `mirror` gives the same layout read the other way round. */
export function arrange(
  ids: string[],
  edges: Edge[],
  sizeOf: (id: string) => Size,
  dir: Direction = 'down',
  mirror = false,
  { pad, tight = false }: Spacing = { pad: 0 },
): Record<string, Point> {
  const depth = layerDepths(ids, edges);
  const layers: string[][] = [];
  for (const id of ids) (layers[get(depth, id)] ??= []).push(id);
  // A depth no card has leaves a hole in the list.
  const filled = layers.filter(Boolean);
  orderLayers(
    filled,
    edges.filter(({ from, to }) => from in depth && to in depth && from !== to),
  );
  // The mirrored version keeps the same crossings, read the other way round.
  if (mirror) for (const layer of filled) layer.reverse();
  const sizes = Object.fromEntries(ids.map(id => [id, sizeOf(id)]));
  // Along a layer cards sit side by side (rows) or stacked (columns); across layers the gap leaves room for cables.
  const scale = tight ? 0.6 : 1;
  const down = dir === 'down';
  const along = down ? 'w' : 'h';
  const across = down ? 'h' : 'w';
  const gapAlong = down ? GAP_X * scale : GAP_Y * 0.6 * scale;
  const gapAcross = down ? GAP_Y * scale : GAP_X * 1.6 * scale;
  const length = (layer: string[]) =>
    layer.reduce((sum, id) => sum + get(sizes, id)[along], 0) + gapAlong * (layer.length - 1);
  const longest = Math.max(...filled.map(length));
  const pos: Record<string, Point> = {};
  let acrossAt = pad + 40;
  for (const layer of filled) {
    let alongAt = pad + 40 + (longest - length(layer)) / 2;
    for (const id of layer) {
      pos[id] = down ? { x: alongAt, y: acrossAt } : { x: acrossAt, y: alongAt };
      alongAt += get(sizes, id)[along] + gapAlong;
    }
    acrossAt += Math.max(...layer.map(id => get(sizes, id)[across])) + gapAcross;
  }
  return pos;
}

/** The room a layout takes. */
export function layoutBox(pos: Record<string, Point>, sizeOf: (id: string) => Size): Size {
  const cards = Object.entries(pos).map(([id, at]) => ({ ...at, ...sizeOf(id) }));
  return {
    w: Math.max(...cards.map(card => card.x + card.w)) - Math.min(...cards.map(card => card.x)),
    h: Math.max(...cards.map(card => card.y + card.h)) - Math.min(...cards.map(card => card.y)),
  };
}

/**
 * The sides of two cards that face each other, from their boxes (not their corners): a card clearly above or below
 * the other, with more room between them that way, gets a vertical cable; otherwise it runs sideways, towards the
 * other card. A side kept for a card's tunnels and queues (`keep`) is used only when no other side faces.
 */
export function sidesFor(
  pos: Record<string, Point>,
  edge: Edge,
  dir: Direction,
  sizeOf: (id: string) => Size,
  keep: Record<string, Side | undefined> = {},
): { fromSide: Side; toSide: Side } {
  const box = (id: string) => {
    const at = get(pos, id);
    const { w, h } = sizeOf(id);
    return { ...at, w, h, cx: at.x + w / 2, cy: at.y + h / 2 };
  };
  const a = box(edge.from);
  const b = box(edge.to);
  const gapX = Math.max(b.x - (a.x + a.w), a.x - (b.x + b.w));
  const gapY = Math.max(b.y - (a.y + a.h), a.y - (b.y + b.h));
  const vertical =
    b.cy > a.cy ? ({ fromSide: 'bottom', toSide: 'top' } as const) : ({ fromSide: 'top', toSide: 'bottom' } as const);
  const sideways =
    b.cx >= a.cx ? ({ fromSide: 'right', toSide: 'left' } as const) : ({ fromSide: 'left', toSide: 'right' } as const);
  const [first, second] =
    gapY > gapX || (gapY === gapX && dir === 'down') ? [vertical, sideways] : [sideways, vertical];
  const free = (sides: typeof first) => keep[edge.from] !== sides.fromSide && keep[edge.to] !== sides.toSide;
  return free(first) || !free(second) ? first : second;
}

/**
 * Closes up the room the cards take only in full: each band in `needed` that nothing in `taken` covers is cut out.
 * `show` gives where a place is drawn, `back` where a drawn place is kept.
 */
export function squeeze(
  taken: [number, number][],
  needed: [number, number][],
): { show: (y: number) => number; back: (y: number) => number } {
  const merged = (spans: [number, number][]) =>
    [...spans]
      .sort((a, b) => a[0] - b[0])
      .reduce<[number, number][]>((all, [top, end]) => {
        const last = all.at(-1);
        if (last && top <= last[1]) last[1] = Math.max(last[1], end);
        else all.push([top, end]);
        return all;
      }, []);
  const busy = merged(taken);
  const bands = merged(needed).flatMap(([top, end]) => {
    const free: [number, number][] = [];
    let at = top;
    for (const [s, e] of busy) {
      if (e <= at || s >= end) continue;
      if (s > at) free.push([at, s]);
      at = Math.max(at, e);
    }
    if (at < end) free.push([at, end]);
    return free;
  });
  return {
    show: y => y - bands.reduce((cut, [s, e]) => cut + Math.max(0, Math.min(y, e) - s), 0),
    back: d => {
      let cut = 0;
      for (const [s, e] of bands) {
        if (d < s - cut) break;
        cut += e - s;
      }
      return d + cut;
    },
  };
}
