// The board: cards and cables as Svelte Flow holds them, and the socket behaviour on top (drawing a cable through
// waypoints, sliding an end along its side). The geometry is core/cables and core/arrange, unchanged.
import type { Edge, Node } from '@xyflow/svelte';
import { arrange, sidesFor, type Point, type Side } from '../src/core/arrange.ts';
import { endOffsets, orderSlots, sidePoint, SIDES, type Box, type Cable } from '../src/core/cables.ts';
import { of as kindOf } from '../src/core/kinds.ts';
import type { Loaded } from './data.ts';

export interface CableData extends Record<string, unknown> {
  fromSide: Side;
  toSide: Side;
  fromSlot?: number;
  toSlot?: number;
  points?: Point[];
}
export type CableEdge = Edge<CableData, 'cable'> & { data: CableData };
/** What a card holds: what the app is, and what the user chose for it. */
export interface CardData extends Record<string, unknown> {
  name: string;
  kind: string;
  kindLabel: string;
  /** The branch to run; empty for the one the clone is on. */
  branch: string;
  /** Who starts it: Koppler, or the user (an IDE, a terminal). */
  run: string;
  /** The device a mobile app runs on. */
  platform?: string;
  /** The user's own instruction for the agent. */
  note: string;
}
export type CardNode = Node<CardData, 'app'>;
export type End = 'from' | 'to';
export interface StackApp {
  id: string;
  name: string;
  kind: string;
  kindLabel: string;
  /** Its repository, as owner/name. */
  slug: string;
  cloned: boolean;
  /** Why it does not run on this machine. */
  outside?: string;
  /** The apps the stack says it calls, and the calls found in its code. */
  calls: string[];
  /** Whether anything can call it: it serves, or some app is known to call it. */
  answers: boolean;
  /** Who may start it and, for a mobile app, on what. */
  runIn: readonly (readonly [string, string])[];
  platforms: readonly (readonly [string, string])[];
  /** The clone's branch, its other branches, and how many files it has changed. */
  current: string;
  branches: string[];
  dirty: number;
}
interface Draft {
  a: Point;
  side: Side;
  b: Point;
  bSide: Side | null;
  points: Point[];
}

const PAD = 24;
/** The room a new card is given before it has been measured. */
const PLACE = { w: 300, h: 240, gap: 32 };
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
  /** The stack's name and the environment the board runs against; empty until the board is opened. */
  stack = $state('');
  env = $state('');
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
        addEventListener(
          type,
          after => {
            after.stopPropagation();
          },
          { capture: true, once: true },
        );
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

  /** Every app of the stack, as the side panel lists it. */
  apps = $state.raw<StackApp[]>([]);
  envs = $state.raw<string[]>([]);
  /** The folders clones are looked for in, for the "not cloned" hint. */
  roots = $state.raw<string[]>([]);
  /** Set by the flow once it is up: the board's place on the page, and a way to bring a card to its middle. */
  area: () => DOMRect = () => new DOMRect();
  show: (id: string) => void = () => undefined;
  #card(app: StackApp, at: Point, chosen: Partial<CardData> = {}): CardNode {
    const { id, name, kind, kindLabel, runIn, platforms } = app;
    const run = runIn.some(([value]) => value === chosen.run) ? chosen.run : runIn[0]?.[0];
    const platform = platforms.some(([value]) => value === chosen.platform) ? chosen.platform : platforms[0]?.[0];
    return {
      id,
      type: 'app',
      position: at,
      data: {
        name,
        kind,
        kindLabel,
        branch: chosen.branch ?? '',
        run: run ?? 'cli',
        ...(platform && { platform }),
        note: chosen.note ?? '',
      },
    };
  }

  /** Puts the board the server kept on screen: the stack's apps where they were left, and their cables. */
  open({ stack, clones, roots, saved }: Loaded): void {
    this.stack = stack.name ?? '';
    this.envs = stack.envs;
    this.env = saved?.env ?? stack.envs[0] ?? '';
    this.roots = roots;
    this.apps = Object.entries(stack.apps).map(([id, app]) => ({
      id,
      name: app.name,
      kind: app.kind,
      kindLabel: kindOf(app).label,
      slug: app.slug ?? '',
      cloned: !!clones[id],
      calls: [...new Set([...Object.keys(app.consumes ?? {}), ...Object.keys(stack.found?.[id] ?? {})])],
      answers:
        kindOf(app).serves ||
        Object.entries(stack.apps).some(
          ([from, other]) => from !== id && (other.consumes?.[id] ?? stack.found?.[from]?.[id]),
        ),
      runIn: kindOf(app).runIn,
      platforms: kindOf(app).platforms ?? [],
      current: clones[id]?.branch ?? '',
      branches: clones[id]?.branches ?? [],
      dirty: clones[id]?.dirty ?? 0,
      ...(app.outside && { outside: typeof app.outside === 'string' ? app.outside : 'an outside system' }),
    }));
    this.nodes = this.apps.flatMap(app => {
      const at = saved?.nodes?.[app.id];
      return at ? [this.#card(app, { x: at.x, y: at.y }, at)] : [];
    });
    const onBoard = new Set(this.nodes.map(({ id }) => id));
    this.edges = (saved?.edges ?? [])
      .filter(({ from, to }) => onBoard.has(from) && onBoard.has(to))
      .map(({ from, to, fromSide, toSide }) =>
        cable(from, to, { fromSide: fromSide ?? 'right', toSide: toSide ?? 'left' }),
      );
  }

  /** Puts an app on the board, in the first empty spot of what is on screen, scanning rows from the top left. */
  add(id: string): void {
    const app = this.apps.find(one => one.id === id);
    if (!app || app.outside || !app.cloned || this.nodes.some(node => node.id === id)) return;
    const view = this.area();
    const from = this.toFlow({ x: view.left, y: view.top });
    const to = this.toFlow({ x: view.right, y: view.bottom });
    const taken = [...this.boxes.values()];
    const free = (x: number, y: number) =>
      taken.every(
        box =>
          x + PLACE.w + PLACE.gap <= box.x ||
          box.x + box.w + PLACE.gap <= x ||
          y + PLACE.h + PLACE.gap <= box.y ||
          box.y + box.h + PLACE.gap <= y,
      );
    let spot: Point | undefined;
    for (let y = from.y + 40; !spot && y + PLACE.h <= to.y; y += 40)
      for (let x = from.x + 40; !spot && x + PLACE.w <= to.x; x += 40) if (free(x, y)) spot = { x, y };
    const step = this.nodes.length * 32;
    this.nodes = [...this.nodes, this.#card(app, spot ?? { x: from.x + 48 + step, y: from.y + 48 + step })];
  }

  /** Changes what the user chose on a card. */
  set(id: string, chosen: Partial<CardData>): void {
    this.nodes = this.nodes.map(node => (node.id === id ? { ...node, data: { ...node.data, ...chosen } } : node));
  }

  /**
   * The cables a card can gain and lose: the apps on the board it calls, or, when the stack knows of none, the ones
   * it may call that do not call it; and the apps it is cabled to.
   */
  cablesOf(id: string): { can: StackApp[]; wired: StackApp[] } {
    const app = (which: string) => this.apps.find(one => one.id === which);
    const others = this.nodes.flatMap(node => (node.id === id ? [] : (app(node.id) ?? [])));
    const wired = others.filter(other => this.edges.some(edge => edge.id === `${id}>${other.id}`));
    const free = others.filter(other => !wired.includes(other));
    const known = free.filter(other => app(id)?.calls.includes(other.id));
    const may = free.filter(other => !other.outside && other.answers && !other.calls.includes(id));
    return { can: known.length ? known : may, wired };
  }

  /** A cable between two cards, on the sides that face each other. */
  connect(from: string, to: string): void {
    const size = (id: string) => this.boxes.get(id) ?? { w: 260, h: 160 };
    const at = Object.fromEntries([...this.boxes].map(([id, { x, y }]) => [id, { x, y }]));
    const drawn = cable(from, to, sidesFor(at, { from, to }, 'down', size));
    this.edges = [...this.edges.filter(edge => edge.id !== drawn.id), drawn];
  }

  cut(from: string, to: string): void {
    this.edges = this.edges.filter(edge => edge.id !== `${from}>${to}`);
  }

  /** Takes an app off the board, with its cables. */
  remove(id: string): void {
    this.nodes = this.nodes.filter(node => node.id !== id);
    this.edges = this.edges.filter(edge => edge.source !== id && edge.target !== id);
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
