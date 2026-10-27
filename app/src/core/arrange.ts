// The shapes a board's layout is made of, and the sides a cable between two placed cards leaves and reaches.
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
const get = <T>(from: Record<string, T>, key: string): T => from[key] as T;

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
