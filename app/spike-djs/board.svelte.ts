// The same spike on diagram-js: the library holds the cards and cables, moves and picks them, pans, zooms, edits
// waypoints and keeps an undo history. The geometry is core/cables and core/arrange, unchanged.
import Diagram from 'diagram-js';
import BaseRenderer from 'diagram-js/lib/draw/BaseRenderer.js';
import BendpointsModule from 'diagram-js/lib/features/bendpoints/index.js';
import KeyboardMoveSelectionModule from 'diagram-js/lib/features/keyboard-move-selection/index.js';
import ModelingModule from 'diagram-js/lib/features/modeling/index.js';
import MoveModule from 'diagram-js/lib/features/move/index.js';
import SelectionModule from 'diagram-js/lib/features/selection/index.js';
import MoveCanvasModule from 'diagram-js/lib/navigation/movecanvas/index.js';
import ZoomScrollModule from 'diagram-js/lib/navigation/zoomscroll/index.js';
import type Canvas from 'diagram-js/lib/core/Canvas.js';
import type ElementFactory from 'diagram-js/lib/core/ElementFactory.js';
import type EventBus from 'diagram-js/lib/core/EventBus.js';
import type Modeling from 'diagram-js/lib/features/modeling/Modeling.js';
import type Selection from 'diagram-js/lib/features/selection/Selection.js';
import type { Connection, Shape } from 'diagram-js/lib/model/Types.js';
import { mount } from 'svelte';
import { arrange, sidesFor, type Point, type Side } from '../src/core/arrange.ts';
import {
  cablePath,
  endOffsets,
  orderSlots,
  sidePoint,
  SIDES,
  throughPath,
  type Box,
  type Cable,
} from '../src/core/cables.ts';
import AppCard from './AppCard.svelte';

export type End = 'from' | 'to';
export interface CardData {
  name: string;
  kind: string;
  branch: string;
  port: number;
}
/** A cable as the library holds it: its waypoints run from end to end, and the sides and slots ride along. */
type CableLine = Connection & { fromSide: Side; toSide?: Side; fromSlot?: number; toSlot?: number; draft?: boolean };
const SVG = 'http://www.w3.org/2000/svg';
const PAD = 24;
const FAR_ZOOM = 0.6;

/** What the cards read. */
export const ui = $state({
  far: false,
  wiring: false,
  selected: null as string | null,
  drop: null as string | null,
  /** `<card>|<side>` of each port whose one cable sits right on it. */
  lit: [] as string[],
});

let canvas: Canvas;
let bus: EventBus;
let factory: ElementFactory;
let modeling: Modeling;
let selection: Selection;
let endsLayer: SVGElement;
const cards = new Map<string, Shape>();
/** Cables in the order they were drawn. */
let lines: CableLine[] = [];
const hosts = new Map<string, SVGForeignObjectElement>();

const svg = <K extends keyof SVGElementTagNameMap>(tag: K, attrs: Record<string, string | number>) => {
  const el = document.createElementNS(SVG, tag);
  for (const [name, value] of Object.entries(attrs)) el.setAttribute(name, String(value));
  return el;
};
const changed = (element: Shape | Connection) => {
  bus.fire('element.changed', { element });
};
const idOf = (line: CableLine) => `${String(line.source?.id)}>${String(line.target?.id)}`;
const toCable = (line: CableLine): Cable => ({
  from: String(line.source?.id),
  to: String(line.target?.id),
  fromSide: line.fromSide,
  toSide: line.toSide ?? 'top',
  ...(line.fromSlot !== undefined && { fromSlot: line.fromSlot }),
  ...(line.toSlot !== undefined && { toSlot: line.toSlot }),
});
const boxOf = (id: string): Box | undefined => {
  const card = cards.get(id);
  return card && { x: card.x, y: card.y, w: card.width, h: card.height };
};
const nearestSide = (box: Box, to: Point): Side => {
  const far = (side: Side) => Math.hypot(sidePoint(box, side).x - to.x, sidePoint(box, side).y - to.y);
  return (Object.keys(SIDES) as Side[]).reduce((best, side) => (far(side) < far(best) ? side : best));
};
const cardAt = (x: number, y: number) =>
  document
    .elementsFromPoint(x, y)
    .find(el => el.hasAttribute('data-card'))
    ?.getAttribute('data-card') ?? undefined;
const local = (ev: { clientX: number; clientY: number }): Point => {
  const view = canvas.viewbox();
  const { left, top } = canvas.getContainer().getBoundingClientRect();
  return { x: view.x + (ev.clientX - left) / view.scale, y: view.y + (ev.clientY - top) / view.scale };
};
const endOf = (line: CableLine, end: End): Point =>
  (end === 'from' ? line.waypoints[0] : line.waypoints.at(-1)) ?? { x: 0, y: 0 };
const bends = (line: CableLine) => line.waypoints.slice(1, -1).map(({ x, y }) => ({ x, y }));

/** Each end's place among the others on its side of the card, written into the cable's first and last waypoint. */
function placeEnds(): void {
  const { offset, onPort } = endOffsets(lines.map(toCable), { cardOf: boxOf });
  lines.forEach((line, index) => {
    const at = (end: End, side: Side) => {
      const box = boxOf(String((end === 'from' ? line.source : line.target)?.id));
      if (!box) return endOf(line, end);
      const middle = sidePoint(box, side);
      const by = offset[`${String(index)}|${end}`] ?? 0;
      return SIDES[side][0] === 0 ? { ...middle, x: middle.x + by } : { ...middle, y: middle.y + by };
    };
    line.waypoints = [at('from', line.fromSide), ...bends(line), at('to', line.toSide ?? 'top')];
    changed(line);
  });
  ui.lit = onPort.map(port => `${port.id}|${port.side}`);
  drawEnds();
}

/** Above the cards: each cable's two ends, which the pointer can grab. The library has no such handle of its own. */
function drawEnds(): void {
  endsLayer.replaceChildren(
    ...lines.flatMap(line =>
      (['from', 'to'] as const).map(end => {
        const { x, y } = endOf(line, end);
        const group = svg('g', { class: `end ${end}`, transform: `translate(${String(x)} ${String(y)})` });
        group.append(svg('circle', { r: end === 'from' ? 5 : 8 }));
        if (end === 'to') group.append(svg('circle', { class: 'light', r: 3.4 }));
        group.addEventListener('pointerdown', ev => {
          grabEnd(ev, line, end);
        });
        group.addEventListener('mousedown', ev => {
          ev.stopPropagation();
        });
        return group;
      }),
    ),
  );
}

/** Draws a card as our Svelte component and a cable as our curve through the library's waypoints. */
class Renderer extends BaseRenderer {
  static $inject = ['eventBus'];
  constructor(eventBus: EventBus) {
    super(eventBus, 2000);
  }
  override canRender() {
    return true;
  }
  override drawShape(visuals: SVGElement, shape: Shape) {
    // The library clears and redraws a card whenever it changes: the mounted component is kept and put back.
    const host = hosts.get(shape.id);
    if (host) visuals.append(host);
    return host ?? visuals;
  }
  override drawConnection(visuals: SVGElement, line: CableLine) {
    const a = endOf(line, 'from');
    const b = endOf(line, 'to');
    const toSide = line.target ? (line.toSide ?? null) : null;
    const d = bends(line).length
      ? throughPath(a, line.fromSide, b, toSide, bends(line))
      : cablePath(a, line.fromSide, b, toSide);
    const wire = svg('path', { d, class: line.draft ? 'wire draft' : 'wire' });
    visuals.append(svg('path', { d, class: 'under' }), wire);
    if (toSide) {
      const [x, y] = SIDES[toSide];
      const turn = (Math.atan2(-y, -x) * 180) / Math.PI;
      visuals.append(
        svg('path', {
          d: 'M-8,-5.5 L0,0 L-8,5.5',
          class: 'head',
          transform: `translate(${String(b.x + x * 10)} ${String(b.y + y * 10)}) rotate(${String(turn)})`,
        }),
      );
    }
    return wire;
  }
}

const addCable = (
  from: string,
  to: string,
  more: Partial<CableLine> & { fromSide: Side; toSide: Side },
  points: Point[] = [],
) => {
  const source = cards.get(from);
  const target = cards.get(to);
  if (!source || !target) return;
  // Through the library's own command, so it lands in its undo history.
  const line = modeling.createConnection(
    source,
    target,
    // Under the cards.
    0,
    { id: `${from}>${to}`, waypoints: [{ x: 0, y: 0 }, ...points, { x: 0, y: 0 }], ...more } as Partial<Connection>,
    canvas.getRootElement() as Shape,
  ) as CableLine;
  lines.push(line);
};

/**
 * A cable's end, pressed: sliding it along its side reorders the cables there, live; pulling it away from the side
 * starts a new cable from that port, as from a free one.
 */
function grabEnd(ev: PointerEvent, pressed: CableLine, end: End): void {
  if (ev.button !== 0) return;
  ev.preventDefault();
  ev.stopPropagation();
  const card = String((end === 'from' ? pressed.source : pressed.target)?.id);
  const side = (end === 'from' ? pressed.fromSide : pressed.toSide) ?? 'top';
  const along = SIDES[side][0] === 0 ? 'x' : 'y';
  const start = local(ev);
  let mode: 'order' | 'wire' | null = null;
  const stop = () => {
    removeEventListener('pointermove', move);
    removeEventListener('pointerup', stop);
    endsLayer.classList.remove('reordering');
  };
  const move = (moved: PointerEvent) => {
    const at = local(moved);
    const slid = at[along] - start[along];
    const pulled = along === 'x' ? at.y - start.y : at.x - start.x;
    if (!mode) {
      if (Math.hypot(slid, pulled) < 6 / canvas.viewbox().scale) return;
      mode = Math.abs(pulled) > Math.abs(slid) ? 'wire' : 'order';
      if (mode === 'wire') {
        stop();
        startWire(card, side);
        return;
      }
      endsLayer.classList.add('reordering');
    }
    const list = lines
      .flatMap((line, index) =>
        (['from', 'to'] as const)
          .filter(which => toCable(line)[which] === card && toCable(line)[`${which}Side`] === side)
          .map(which => ({ line, index, end: which })),
      )
      .sort((a, b) => (a.line[`${a.end}Slot`] ?? Infinity) - (b.line[`${b.end}Slot`] ?? Infinity) || a.index - b.index);
    const me = list.find(one => one.line === pressed && one.end === end);
    if (!me || list.length < 2) return;
    const others = list.filter(one => one !== me);
    const before = others.filter(one => endOf(one.line, one.end)[along] < at[along]).length;
    const order = [...others.slice(0, before), me, ...others.slice(before)];
    if (order.every((one, place) => list[place] === one)) return;
    order.forEach((one, place) => (one.line[`${one.end}Slot`] = place));
    placeEnds();
  };
  addEventListener('pointermove', move);
  addEventListener('pointerup', stop);
}

/**
 * Drawing a cable: drag from a port to a card. Letting go on the empty board drops a waypoint there and the cable
 * stays on the pointer: each click on the board adds another, a click on a card finishes it, Escape cancels. The
 * library's own connect tool ends where the button is let go, so this is ours; the cable being drawn is a real one.
 */
export function startWire(from: string, fromSide: Side): void {
  const box = boxOf(from);
  const source = cards.get(from);
  if (!box || !source) return;
  const a = sidePoint(box, fromSide);
  const points: Point[] = [];
  const draft = factory.createConnection({
    id: 'draft',
    source,
    waypoints: [a, a],
    fromSide,
    draft: true,
  }) as CableLine;
  canvas.addConnection(draft, canvas.getRootElement(), 0);
  ui.wiring = true;
  const target = (ev: PointerEvent) => {
    const id = cardAt(ev.clientX, ev.clientY);
    const at = id && id !== from ? boxOf(id) : undefined;
    return id && at ? { id, at, side: nearestSide(at, points.at(-1) ?? local(ev)) } : undefined;
  };
  const move = (ev: PointerEvent) => {
    const onto = target(ev);
    // The library's types have no cable with a loose end.
    Object.assign(draft, { target: onto && cards.get(onto.id) });
    if (onto) draft.toSide = onto.side;
    draft.waypoints = [a, ...points, onto ? sidePoint(onto.at, onto.side) : local(ev)];
    changed(draft);
    ui.drop = onto?.id ?? null;
  };
  const end = () => {
    removeEventListener('pointermove', move);
    removeEventListener('pointerdown', click, true);
    removeEventListener('keydown', esc, true);
    canvas.removeConnection(draft);
    ui.wiring = false;
    ui.drop = null;
  };
  const finish = (ev: PointerEvent) => {
    const onto = target(ev);
    end();
    if (!onto) return;
    const old = lines.find(line => idOf(line) === `${from}>${onto.id}`);
    if (old) removeCable(old);
    addCable(from, onto.id, { fromSide, toSide: onto.side }, points);
    placeEnds();
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
    if ((ev.target as Element).closest('button')) {
      end();
      return;
    }
    points.push(local(ev));
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
      const at = local(ev);
      const far = Math.hypot(at.x - a.x, at.y - a.y) > 24 / canvas.viewbox().scale;
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

const removeCable = (line: CableLine) => {
  lines = lines.filter(one => one !== line);
  modeling.removeConnection(line);
  placeEnds();
};

/** Arrange: places the cards, picks each cable's sides and its order along them, and drops the waypoints. */
export function arrangeBoard(): void {
  const size = (id: string) => boxOf(id) ?? { w: 260, h: 160 };
  const links = lines.map(line => ({ from: String(line.source?.id), to: String(line.target?.id) }));
  const placed = arrange([...cards.keys()], links, size, 'down', false, { pad: PAD });
  const sided: Cable[] = links.map(link => ({ ...link, ...sidesFor(placed, link, 'down', size) }));
  orderSlots(sided, id => ({ ...(placed[id] ?? { x: 0, y: 0 }), ...size(id) }));
  for (const [id, card] of cards) {
    const at = placed[id];
    if (at) modeling.moveShape(card, { x: at.x - card.x, y: at.y - card.y });
  }
  lines.forEach((line, index) => {
    const one = sided[index];
    if (!one) return;
    Object.assign(line, { fromSide: one.fromSide, toSide: one.toSide, fromSlot: one.fromSlot, toSlot: one.toSlot });
    line.waypoints = [endOf(line, 'from'), endOf(line, 'to')];
  });
  placeEnds();
  fit();
}

export const fit = () => {
  // The library takes 'auto' for the middle of the view; its types do not say so.
  canvas.zoom('fit-viewport', 'auto' as never);
};
export const zoomBy = (factor: number) => {
  canvas.zoom(Math.min(2, Math.max(0.2, canvas.zoom() * factor)), 'auto' as never);
};
export const pick = (id: string) => {
  selection.select(cards.get(id) ?? null);
};

export function setup(
  container: HTMLElement,
  given: (CardData & { id: string; x: number; y: number })[],
  links: { from: string; to: string; fromSide: Side; toSide: Side; points?: Point[] }[],
): void {
  const diagram = new Diagram({
    canvas: { container },
    keyboardMoveSelection: { moveSpeed: 5 },
    modules: [
      ModelingModule,
      MoveCanvasModule,
      ZoomScrollModule,
      SelectionModule,
      MoveModule,
      BendpointsModule,
      KeyboardMoveSelectionModule,
      // Our drawing, and waypoints the library leaves alone when a card moves.
      {
        __init__: ['renderer'],
        renderer: ['type', Renderer],
        layouter: ['value', { layoutConnection: (line: Connection) => line.waypoints }],
      },
    ],
  });
  canvas = diagram.get('canvas');
  bus = diagram.get('eventBus');
  factory = diagram.get('elementFactory');
  modeling = diagram.get('modeling');
  selection = diagram.get('selection');
  const root = factory.createRoot();
  canvas.setRootElement(root);
  endsLayer = canvas.getLayer('ends', 10);
  endsLayer.classList.add('ends');

  for (const { id, x, y, ...data } of given) {
    const host = svg('foreignObject', { width: 400, height: 300, overflow: 'visible' });
    const inner = document.createElement('div');
    inner.style.width = 'max-content';
    host.append(inner);
    hosts.set(id, host);
    const card = factory.createShape({ id, x, y, width: 260, height: 120 });
    cards.set(id, card);
    canvas.addShape(card, root);
    mount(AppCard, { target: inner, props: { id, data } });
    // The card sizes itself; the library is told.
    const sized = () => {
      if (!inner.offsetWidth || (card.width === inner.offsetWidth && card.height === inner.offsetHeight)) return;
      Object.assign(card, { width: inner.offsetWidth, height: inner.offsetHeight });
      host.setAttribute('width', String(card.width));
      host.setAttribute('height', String(card.height));
      changed(card);
      placeEnds();
    };
    new ResizeObserver(sized).observe(inner);
    sized();
  }
  bus.on('connection.added', ({ element, gfx }: { element: CableLine; gfx: SVGElement }) => {
    if (element.draft) return;
    gfx.setAttribute('tabindex', '0');
    gfx.setAttribute('data-cable', idOf(element));
    gfx.addEventListener('keydown', ev => {
      if (ev.key === 'Backspace' || ev.key === 'Delete') removeCable(element);
    });
  });
  for (const { from, to, points, ...sides } of links) addCable(from, to, sides, points);
  placeEnds();
  // After a move, a waypoint edit, an undo: the ends go back to their places.
  bus.on('commandStack.changed', placeEnds);
  bus.on('selection.changed', ({ newSelection }: { newSelection: (Shape | Connection)[] }) => {
    ui.selected = newSelection[0]?.id ?? null;
  });
  bus.on('canvas.viewbox.changed', ({ viewbox }: { viewbox: { x: number; y: number; scale: number } }) => {
    ui.far = viewbox.scale < FAR_ZOOM;
    container.style.backgroundSize = `${String(24 * viewbox.scale)}px ${String(24 * viewbox.scale)}px`;
    container.style.backgroundPosition = `${String(-viewbox.x * viewbox.scale)}px ${String(-viewbox.y * viewbox.scale)}px`;
  });
  fit();

  // For the check script.
  Object.assign(window, {
    board: {
      get edges() {
        return lines.map(line => ({
          id: idOf(line),
          ...toCable(line),
          ...(bends(line).length && { points: bends(line) }),
        }));
      },
      get nodes() {
        return [...cards.values()].map(card => ({
          id: card.id,
          position: { x: card.x, y: card.y },
          selected: ui.selected === card.id,
        }));
      },
      get draft() {
        return ui.wiring ? 'draft' : null;
      },
      endScreen: (id: string, end: End) => {
        const line = lines.find(one => idOf(one) === id);
        if (!line) return undefined;
        const at = endOf(line, end);
        const view = canvas.viewbox();
        const { left, top } = container.getBoundingClientRect();
        return {
          flow: { x: at.x, y: at.y },
          x: left + (at.x - view.x) * view.scale,
          y: top + (at.y - view.y) * view.scale,
        };
      },
      undo: () => {
        diagram.get<{ undo: () => void }>('commandStack').undo();
      },
    },
  });
}
