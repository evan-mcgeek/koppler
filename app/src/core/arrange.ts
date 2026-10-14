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
  /** Where along its layer a card's cables meet it, when its room is more than the card (its own queues under it). */
  anchor?: (id: string) => number | undefined;
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
 * Each card's layer, top down. The walk starts at the ways in (cards nothing leads to, the one reaching the most first);
 * a link that closes a loop runs back up and does not decide the layers, so a loop reads in its own order. A card sits
 * one layer under the furthest card leading to it, then moves down to just above the nearest card it leads to: a card
 * that only feeds a queue sits right over it, not up with the way in.
 */
export function layerDepths(ids: string[], edges: Edge[]): Record<string, number> {
  const out: Record<string, string[]> = Object.fromEntries(ids.map(id => [id, []]));
  for (const { from, to } of edges) if (from in out && to in out && from !== to) out[from]?.push(to);
  const reach = (start: string) => {
    const seen = [start];
    for (let at = 0; at < seen.length; at++)
      for (const next of out[seen[at] ?? ''] ?? []) if (!seen.includes(next)) seen.push(next);
    return seen.length;
  };
  const led = new Set(Object.values(out).flat());
  const starts = [
    ...ids.filter(id => !led.has(id)).sort((a, b) => reach(b) - reach(a)),
    ...[...ids].sort((a, b) => reach(b) - reach(a)),
  ];
  // Depth first from the ways in: a link to a card still on the path closes a loop and is left out.
  const forward: Record<string, string[]> = Object.fromEntries(ids.map(id => [id, []]));
  const done: string[] = [];
  const state: Record<string, 'open' | 'done'> = {};
  const visit = (id: string) => {
    state[id] = 'open';
    for (const next of out[id] ?? []) {
      if (state[next] === 'open') continue;
      forward[id]?.push(next);
      if (!state[next]) visit(next);
    }
    state[id] = 'done';
    done.push(id);
  };
  for (const id of starts) if (!state[id]) visit(id);
  // `done` ends with the ways in: read backwards, every card comes after all that lead to it.
  const order = [...done].reverse();
  const depth: Record<string, number> = Object.fromEntries(ids.map(id => [id, 0]));
  for (const id of order)
    for (const next of forward[id] ?? []) depth[next] = Math.max(get(depth, next), get(depth, id) + 1);
  for (const id of done) {
    const below = (forward[id] ?? []).map(next => get(depth, next));
    if (below.length) depth[id] = Math.max(get(depth, id), Math.min(...below) - 1);
  }
  return depth;
}

/**
 * Moves each card along its layer towards the cards it is cabled to, so cables run as straight as they can: a chain
 * lines up, a card called by two sits between them. Each layer in turn takes the places that make its cables shortest
 * while its cards keep their order and gaps (pooled adjacent averages, each card weighed by its cables), until nothing
 * moves.
 */
function straighten(
  layers: string[][],
  edges: Edge[],
  at: Record<string, number>,
  size: (id: string) => number,
  gap: number,
  anchor: (id: string) => number,
): void {
  const layerOf: Record<string, number> = {};
  layers.forEach((layer, n) => {
    for (const id of layer) layerOf[id] = n;
  });
  const near: Record<string, string[]> = {};
  for (const { from, to } of edges) {
    if (!(from in layerOf) || !(to in layerOf) || layerOf[from] === layerOf[to]) continue;
    (near[from] ??= []).push(to);
    (near[to] ??= []).push(from);
  }
  // Worked out on where cables meet each card, its anchor, rather than on its corner.
  const mid: Record<string, number> = Object.fromEntries(
    Object.keys(layerOf).map(id => [id, get(at, id) + anchor(id)]),
  );
  for (let sweep = 0, moved = Infinity; sweep < 500 && moved > 0.01; sweep++) {
    moved = 0;
    for (const layer of sweep % 2 ? [...layers].reverse() : layers) {
      // How far each card's anchor must at least be from the first one's, for the cards before it to fit.
      const offsets: number[] = [];
      layer.forEach((id, n) => {
        const before = layer[n - 1];
        offsets.push(
          before === undefined ? 0 : (offsets[n - 1] ?? 0) + size(before) - anchor(before) + gap + anchor(id),
        );
      });
      const blocks: { sum: number; weight: number; count: number }[] = [];
      layer.forEach((id, n) => {
        const others = near[id] ?? [];
        // A card with no cables stays where it is, unless others need its room.
        const weight = others.length || 1e-3;
        const want = others.length
          ? others.reduce((sum, other) => sum + get(mid, other), 0) / others.length
          : get(mid, id);
        blocks.push({ sum: (want - (offsets[n] ?? 0)) * weight, weight, count: 1 });
        for (;;) {
          const last = blocks.at(-1);
          const before = blocks.at(-2);
          if (!last || !before || before.sum / before.weight <= last.sum / last.weight) break;
          blocks.pop();
          before.sum += last.sum;
          before.weight += last.weight;
          before.count += last.count;
        }
      });
      let n = 0;
      for (const block of blocks)
        for (let k = 0; k < block.count; k++, n++) {
          const id = layer[n] ?? '';
          const next = block.sum / block.weight + (offsets[n] ?? 0);
          moved = Math.max(moved, Math.abs(next - get(mid, id)));
          mid[id] = next;
        }
    }
  }
  for (const id of Object.keys(mid)) at[id] = get(mid, id) - anchor(id);
}

/** Where each card's top left corner goes. `mirror` gives the same layout read the other way round. */
export function arrange(
  ids: string[],
  edges: Edge[],
  sizeOf: (id: string) => Size,
  dir: Direction = 'down',
  mirror = false,
  { pad, tight = false, anchor }: Spacing = { pad: 0 },
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
  const alongAt: Record<string, number> = {};
  const acrossOf: Record<string, number> = {};
  let acrossAt = pad + 40;
  for (const layer of filled) {
    let at = pad + 40 + (longest - length(layer)) / 2;
    for (const id of layer) {
      alongAt[id] = at;
      acrossOf[id] = acrossAt;
      at += get(sizes, id)[along] + gapAlong;
    }
    acrossAt += Math.max(...layer.map(id => get(sizes, id)[across])) + gapAcross;
  }
  straighten(
    filled,
    edges,
    alongAt,
    id => get(sizes, id)[along],
    gapAlong,
    id => anchor?.(id) ?? get(sizes, id)[along] / 2,
  );
  // The board starts where it did: the card furthest up (or left) at the margin.
  const first = Math.min(...Object.values(alongAt));
  const pos: Record<string, Point> = {};
  for (const id of ids) {
    const at = Math.round(get(alongAt, id) - first + pad + 40);
    pos[id] = down ? { x: at, y: get(acrossOf, id) } : { x: get(acrossOf, id), y: at };
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
