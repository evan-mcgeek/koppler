// The spike's board: cards and cables as Svelte Flow holds them, and the socket behaviour on top (drawing a cable
// through waypoints, sliding an end along its side). The geometry is core/cables and core/arrange, unchanged.
import type { Edge, Node } from '@xyflow/svelte';
import { arrange, sidesFor, type Point, type Side } from '../src/core/arrange.ts';
import { endOffsets, orderSlots, sidePoint, SIDES, type Box, type Cable } from '../src/core/cables.ts';

export interface CableData extends Record<string, unknown> {
  fromSide: Side;
  toSide: Side;
  fromSlot?: number;
  toSlot?: number;
  points?: Point[];
}
export type CableEdge = Edge<CableData, 'cable'> & { data: CableData };
export type CardNode = Node<{ name: string; kind: string; branch: string; port: number }, 'app'>;
export type End = 'from' | 'to';
interface Draft {
  a: Point;
  side: Side;
  b: Point;
  bSide: Side | null;
  points: Point[];
}

const PAD = 24;
const cardAt = (x: number, y: number) =>
  document
    .elementsFromPoint(x, y)
    .find((el): el is HTMLElement => el.classList.contains('svelte-flow__node'))
    ?.getAttribute('data-id') ?? undefined;
export const cable = (from: string, to: string, data: CableData): CableEdge => ({
  id: `${from}>${to}`,
  source: from,
  target: to,
  type: 'cable',
  data,
});

class Board {
  nodes = $state.raw<CardNode[]>([]);
  edges = $state.raw<CableEdge[]>([]);
  /** The cable being drawn. */
  draft = $state.raw<Draft | null>(null);
  /** The end being slid along its side. */
  grabbed = $state.raw<{ id: string; end: End } | null>(null);
  /** The card a drawn cable would land on. */
  drop = $state.raw<string | null>(null);
  /** Set by the flow once it is up. */
  toFlow: (at: Point) => Point = at => at;
  zoom: () => number = () => 1;

  cables = $derived<Cable[]>(this.edges.map(edge => ({ from: edge.source, to: edge.target, ...edge.data })));
  boxes = $derived(
    new Map<string, Box>(
      this.nodes.flatMap(({ id, position, measured }) =>
        measured?.width && measured.height ? [[id, { ...position, w: measured.width, h: measured.height }]] : [],
      ),
    ),
  );
  ends = $derived(endOffsets(this.cables, { cardOf: id => this.boxes.get(id) }));

  /** Where a cable's end is drawn: its place among the others on that side of the card. */
  endPoint(index: number, end: End): Point | undefined {
    const one = this.cables[index];
    const box = one && this.boxes.get(one[end]);
    if (!box) return undefined;
    const side = one[`${end}Side`];
    const middle = sidePoint(box, side);
    const by = this.ends.offset[`${String(index)}|${end}`] ?? 0;
    return SIDES[side][0] === 0 ? { ...middle, x: middle.x + by } : { ...middle, y: middle.y + by };
  }

  nearestSide(box: Box, to: Point): Side {
    const far = (side: Side) => Math.hypot(sidePoint(box, side).x - to.x, sidePoint(box, side).y - to.y);
    return (Object.keys(SIDES) as Side[]).reduce((best, side) => (far(side) < far(best) ? side : best));
  }

  /**
   * Drawing a cable: drag from a port to a card. Letting go on the empty board drops a waypoint there and the cable
   * stays on the pointer: each click on the board adds another, a click on a card finishes it, Escape cancels.
   */
  startWire(from: string, fromSide: Side): void {
    const box = this.boxes.get(from);
    if (!box) return;
    const a = sidePoint(box, fromSide);
    const points: Point[] = [];
    const flow = (ev: PointerEvent) => this.toFlow({ x: ev.clientX, y: ev.clientY });
    const target = (ev: PointerEvent) => {
      const id = cardAt(ev.clientX, ev.clientY);
      const at = id && id !== from ? this.boxes.get(id) : undefined;
      return id && at ? { id, side: this.nearestSide(at, points.at(-1) ?? flow(ev)), at } : undefined;
    };
    const move = (ev: PointerEvent) => {
      const onto = target(ev);
      this.draft = {
        a,
        side: fromSide,
        b: onto ? sidePoint(onto.at, onto.side) : flow(ev),
        bSide: onto?.side ?? null,
        points: [...points],
      };
      this.drop = onto?.id ?? null;
    };
    const end = () => {
      removeEventListener('pointermove', move);
      removeEventListener('pointerdown', click, true);
      removeEventListener('keydown', esc, true);
      this.draft = this.drop = null;
    };
    const finish = (ev: PointerEvent) => {
      const onto = target(ev);
      end();
      if (!onto) return;
      const drawn = cable(from, onto.id, { fromSide, toSide: onto.side, ...(points.length && { points }) });
      this.edges = [...this.edges.filter(edge => edge.id !== drawn.id), drawn];
    };
    const click = (ev: PointerEvent) => {
      if (ev.button !== 0) return;
      ev.preventDefault();
      ev.stopPropagation();
      // The click that places a point or ends the cable is not also a press on the card or the board under it.
      for (const type of ['mousedown', 'click'])
        addEventListener(type, after => after.stopPropagation(), { capture: true, once: true });
      if (cardAt(ev.clientX, ev.clientY)) {
        finish(ev);
        return;
      }
      if ((ev.target as Element).closest('.svelte-flow__panel, button')) {
        end();
        return;
      }
      points.push(flow(ev));
      move(ev);
    };
    const esc = (ev: KeyboardEvent) => {
      if (ev.key !== 'Escape') return;
      ev.preventDefault();
      end();
    };
    addEventListener('pointermove', move);
    addEventListener(
      'pointerup',
      ev => {
        const at = flow(ev);
        const far = Math.hypot(at.x - a.x, at.y - a.y) > 24 / this.zoom();
        if (cardAt(ev.clientX, ev.clientY) || !far) {
          finish(ev);
          return;
        }
        points.push(at);
        move(ev);
        addEventListener('pointerdown', click, true);
        addEventListener('keydown', esc, true);
      },
      { once: true },
    );
  }

  /**
   * A cable's end, pressed: sliding it along its side reorders the cables there, live; pulling it away from the side
   * starts a new cable from that port, as from a free one.
   */
  grabEnd(ev: PointerEvent, id: string, end: End): void {
    const pressed = this.edges.find(edge => edge.id === id);
    if (ev.button !== 0 || !pressed) return;
    ev.preventDefault();
    ev.stopPropagation();
    const card = end === 'from' ? pressed.source : pressed.target;
    const side = pressed.data[`${end}Side`];
    const along = SIDES[side][0] === 0 ? 'x' : 'y';
    const start = this.toFlow({ x: ev.clientX, y: ev.clientY });
    const members = () =>
      this.edges
        .flatMap((edge, index) => {
          const which: End | null =
            edge.source === card && edge.data.fromSide === side
              ? 'from'
              : edge.target === card && edge.data.toSide === side
                ? 'to'
                : null;
          return which ? [{ edge, index, end: which }] : [];
        })
        .sort(
          (a, b) =>
            (a.edge.data[`${a.end}Slot`] ?? Infinity) - (b.edge.data[`${b.end}Slot`] ?? Infinity) || a.index - b.index,
        );
    let mode: 'order' | 'wire' | null = null;
    const stop = () => {
      removeEventListener('pointermove', move);
      removeEventListener('pointerup', stop);
      this.grabbed = null;
    };
    const move = (moved: PointerEvent) => {
      const at = this.toFlow({ x: moved.clientX, y: moved.clientY });
      const slid = at[along] - start[along];
      const pulled = along === 'x' ? at.y - start.y : at.x - start.x;
      if (!mode) {
        if (Math.hypot(slid, pulled) < 6 / this.zoom()) return;
        mode = Math.abs(pulled) > Math.abs(slid) ? 'wire' : 'order';
        if (mode === 'wire') {
          stop();
          this.startWire(card, side);
          return;
        }
        this.grabbed = { id, end };
      }
      const list = members();
      const me = list.find(one => one.edge.id === id && one.end === end);
      if (!me || list.length < 2) return;
      const others = list.filter(one => one !== me);
      const before = others.filter(one => (this.endPoint(one.index, one.end)?.[along] ?? 0) < at[along]).length;
      const order = [...others.slice(0, before), me, ...others.slice(before)];
      if (order.every((one, place) => list[place] === one)) return;
      const slot = new Map(order.map((one, place) => [`${one.edge.id}|${one.end}`, place]));
      this.edges = this.edges.map(edge => {
        const fromSlot = slot.get(`${edge.id}|from`);
        const toSlot = slot.get(`${edge.id}|to`);
        return fromSlot === undefined && toSlot === undefined
          ? edge
          : {
              ...edge,
              data: {
                ...edge.data,
                ...(fromSlot !== undefined && { fromSlot }),
                ...(toSlot !== undefined && { toSlot }),
              },
            };
      });
    };
    addEventListener('pointermove', move);
    addEventListener('pointerup', stop);
  }

  /** Arrange: places the cards, picks each cable's sides and its order along them, and drops the waypoints. */
  arrange(): void {
    const size = (id: string) => this.boxes.get(id) ?? { w: 260, h: 160 };
    const links = this.cables.map(({ from, to }) => ({ from, to }));
    const placed = arrange(
      this.nodes.map(node => node.id),
      links,
      size,
      'down',
      false,
      { pad: PAD },
    );
    const cables: Cable[] = links.map(link => ({ ...link, ...sidesFor(placed, link, 'down', size) }));
    orderSlots(cables, id => ({ ...(placed[id] ?? { x: 0, y: 0 }), ...size(id) }));
    this.nodes = this.nodes.map(node => ({ ...node, position: placed[node.id] ?? node.position }));
    this.edges = cables.map(({ from, to, ...data }) => cable(from, to, data));
  }
}

export const board = new Board();
