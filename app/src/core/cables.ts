// Cables: the curve one is drawn as, and how several cables on one side of a card share that side. Pure geometry: the
// page measures cards and tunnels and draws what comes out.
import type { Point, Side, Size } from './arrange.ts';

export type Box = Point & Size;
/** A cable between two cards, with the side it leaves and enters on and its place among the others there. */
export interface Cable {
  from: string;
  to: string;
  fromSide: Side;
  toSide: Side;
  fromSlot?: number;
  toSlot?: number;
  /** How far from the middle of its side Arrange centred the cables this end sits among. */
  fromShift?: number;
  toShift?: number;
}
type End = 'from' | 'to';

/** The direction each side faces, as a step along x and y. */
export const SIDES: Record<Side, readonly [number, number]> = {
  top: [0, -1],
  right: [1, 0],
  bottom: [0, 1],
  left: [-1, 0],
};
export const OPPOSITE: Record<Side, Side> = { top: 'bottom', bottom: 'top', left: 'right', right: 'left' };
const clamp = (value: number, low: number, high: number) => Math.min(Math.max(value, low), Math.max(low, high));
const lead = (from: Point, side: Side | null, by: number): Point =>
  side ? { x: from.x + SIDES[side][0] * by, y: from.y + SIDES[side][1] * by } : from;
const at = ({ x, y }: Point) => `${String(x)},${String(y)}`;

/** The middle of a card's side, where a single cable meets it. */
export const sidePoint = ({ x, y, w, h }: Box, side: Side): Point =>
  ({
    top: { x: x + w / 2, y },
    right: { x: x + w, y: y + h / 2 },
    bottom: { x: x + w / 2, y: y + h },
    left: { x, y: y + h / 2 },
  })[side];

/** A cable leaves and enters along each socket's side; a null side means a free end. The curve's four points. */
export function cableCurve(a: Point, aSide: Side, b: Point, bSide: Side | null): [Point, Point, Point, Point] {
  const by = clamp(Math.hypot(b.x - a.x, b.y - a.y) * 0.4, 30, 140);
  return [a, lead(a, aSide, by), lead(b, bSide, by), b];
}
/** A cable as one curve, as an SVG path. */
export function cablePath(a: Point, aSide: Side, b: Point, bSide: Side | null): string {
  const [, first, second] = cableCurve(a, aSide, b, bSide);
  return `M${at(a)} C${at(first)} ${at(second)} ${at(b)}`;
}
/**
 * A cable through the waypoints the user placed: it leaves and enters along the sockets' sides and bends smoothly at
 * each point (Catmull-Rom, as Béziers).
 */
export function throughPath(a: Point, aSide: Side, b: Point, bSide: Side | null, points: Point[]): string {
  const out = lead(a, aSide, 40);
  const through = [out, ...points, lead(b, bSide, 40)];
  let path = `M${at(a)} L${at(out)}`;
  for (let step = 0; step < through.length - 1; step++) {
    const before = through[step - 1] ?? a;
    const here = through[step] ?? a;
    const next = through[step + 1] ?? b;
    const after = through[step + 2] ?? b;
    const first = { x: here.x + (next.x - before.x) / 6, y: here.y + (next.y - before.y) / 6 };
    const second = { x: next.x - (after.x - here.x) / 6, y: next.y - (after.y - here.y) / 6 };
    path += ` C${at(first)} ${at(second)} ${at(next)}`;
  }
  return `${path} L${at(b)}`;
}

const across = (side: Side) => side === 'left' || side === 'right';
const endsOf = (cable: Cable): [End, string, Side, string][] => [
  ['from', cable.from, cable.fromSide, cable.to],
  ['to', cable.to, cable.toSide, cable.from],
];
/** The ends that share each side of each card. */
function bySide<T extends Cable>(cables: T[]) {
  const sides = new Map<string, { cable: T; index: number; end: End; side: Side; id: string; other: string }[]>();
  cables.forEach((cable, index) => {
    for (const [end, id, side, other] of endsOf(cable)) {
      const key = `${id}|${side}`;
      const list = sides.get(key) ?? [];
      list.push({ cable, index, end, side, id, other });
      sides.set(key, list);
    }
  });
  return sides;
}

const spread = (length: number, count: number) => (count > 1 ? Math.min(26, (length - 48) / (count - 1)) : 0);
type Ends = { cable: Cable; end: End; side: Side; other: string }[];
/** The one card every cable on this side goes to, when they all meet it on the side facing this one. */
const facingCard = (list: Ends): string | undefined =>
  list.every(one => one.other === list[0]?.other) &&
  list.every(({ cable, end, side }) => (end === 'from' ? cable.toSide : cable.fromSide) === OPPOSITE[side])
    ? list[0]?.other
    : undefined;

/**
 * Arrange's order of the cables along each side of a card, by where their other end sits, and where it centres them.
 * Cables that all go to one card, onto the side facing this one, are centred on the stretch both cards share, so they
 * run straight across. Sets each cable's slots and shifts: they stay as set, whatever moves, until the next Arrange.
 */
export function orderSlots(cables: Cable[], boxOf: (id: string) => Box): void {
  for (const list of bySide(cables).values()) {
    const [{ id, side } = { id: '', side: 'top' as Side }] = list;
    const along = across(side) ? 'y' : 'x';
    const lengthOf = (box: Box) => (along === 'x' ? box.w : box.h);
    const middle = (box: Box) => box[along] + lengthOf(box) / 2;
    const card = boxOf(id);
    const other = facingCard(list);
    let shift: number | undefined;
    if (other) {
      const low = Math.max(card[along], boxOf(other)[along]);
      const high = Math.min(card[along] + lengthOf(card), boxOf(other)[along] + lengthOf(boxOf(other)));
      const step = Math.min(spread(lengthOf(card), list.length), spread(lengthOf(boxOf(other)), list.length));
      if (high - low >= step * (list.length - 1) + 32) shift = Math.round((low + high) / 2 - middle(card));
    }
    list
      .sort((a, b) => middle(boxOf(a.other)) - middle(boxOf(b.other)))
      .forEach(({ cable, end }, slot) => {
        cable[`${end}Slot`] = slot;
        if (shift) cable[`${end}Shift`] = shift;
        else if (end === 'from') delete cable.fromShift;
        else delete cable.toShift;
      });
  }
}

/** What the page knows that the geometry needs. */
export interface Sides {
  /** A card's box; undefined for anything that is not a card. */
  cardOf: (id: string) => Box | undefined;
  /** How much of a card's bottom edge its tunnels cover from the left, and whether they sit at its right end instead. */
  coveredBelow?: (id: string) => { covered: number; atRight: boolean };
}
/**
 * Several cables on one side of a card spread along it, in the order Arrange gave them (cables drawn since go after,
 * in the order they were drawn), so they fan out instead of leaving from one point. Nothing here follows the cards as
 * they move: where a fan is centred is Arrange's to set. Gives each end's distance from the
 * middle of its side, keyed `<cable index>|<from or to>`, and the sides whose one cable sits right on the port.
 */
export function endOffsets(cables: Cable[], { cardOf, coveredBelow }: Sides) {
  const offset: Record<string, number> = {};
  const onPort: { id: string; side: Side }[] = [];
  for (const list of bySide(cables).values()) {
    const [{ id, side } = { id: '', side: 'top' as Side }] = list;
    const card = cardOf(id);
    if (!card) continue;
    const along = across(side) ? 'y' : 'x';
    const lengthOf = (box: Box) => (along === 'x' ? box.w : box.h);
    const room = lengthOf(card);
    const count = list.length;
    list.sort(
      (a, b) => (a.cable[`${a.end}Slot`] ?? Infinity) - (b.cable[`${b.end}Slot`] ?? Infinity) || a.index - b.index,
    );
    // Tunnels stacked under a card cover part of its bottom edge: cables leave from what is still free.
    const { covered, atRight } = (side === 'bottom' && coveredBelow?.(id)) || { covered: 0, atRight: false };
    const free = covered && room - covered >= 56 ? room - covered : 0;
    const shift = !free ? 0 : atRight ? free / 2 - room / 2 : covered + free / 2 - room / 2;
    let step = count > 1 ? Math.min(26, ((free || room) - (free ? 20 : 48)) / (count - 1)) : 0;
    let centre = shift;
    if (!shift) {
      // Cables that all go to one card, onto the side facing this one, keep the same spacing on both cards.
      const other = cardOf(facingCard(list) ?? '');
      if (other) step = Math.min(step, spread(lengthOf(other), count));
      // Where Arrange centred them, as far as the side still has room for it.
      const placed = list.map(({ cable, end }) => cable[`${end}Shift`]).find(at => at !== undefined) ?? 0;
      const reach = Math.max(0, room / 2 - 16 - ((count - 1) / 2) * step);
      centre = clamp(placed, -reach, reach);
    }
    list.forEach(({ index, end }, place) => {
      offset[`${String(index)}|${end}`] = centre + (place - (count - 1) / 2) * step;
    });
    if (count === 1 && !centre) onPort.push({ id, side });
  }
  return { offset, onPort };
}
