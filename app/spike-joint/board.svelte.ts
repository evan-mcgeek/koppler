// The same spike on JointJS: the library holds the cards and cables and draws them; the socket behaviour sits on its
// link tools. The geometry is core/cables and core/arrange, unchanged.
import { dia, linkTools, shapes, util } from '@joint/core';
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
const KEY = { from: 'source', to: 'target' } as const;
const PAD = 24;
const FAR_ZOOM = 0.6;
const XHTML = 'http://www.w3.org/1999/xhtml';

/** What the cards read. */
export const ui = $state({
  far: false,
  wiring: false,
  selected: null as string | null,
  drop: null as string | null,
  /** `<card>|<side>` of each port whose one cable sits right on it. */
  lit: [] as string[],
});

const Card = dia.Element.define(
  'Card',
  { size: { width: 380, height: 200 }, attrs: { fo: { width: 'calc(w)', height: 'calc(h)' } } },
  {
    markup: [
      {
        tagName: 'foreignObject',
        selector: 'fo',
        attributes: { overflow: 'visible' },
        children: [{ tagName: 'div', namespaceURI: XHTML, selector: 'host', style: { width: 'max-content' } }],
      },
    ],
  },
);
const namespace = { ...shapes, Card };
export const graph = new dia.Graph({}, { cellNamespace: namespace });
let paper: dia.Paper;

const sideOf = (link: dia.Link, end: End) => ((link.get(KEY[end]) as dia.Link.EndJSON).anchor?.name ?? 'top') as Side;
const anchor = (name: Side, by = 0) => ({
  name,
  args: { ...(SIDES[name][0] === 0 ? { dx: by } : { dy: by }), useModelGeometry: true },
});
const cables = () => graph.getLinks().filter(link => !link.get('draft'));
const toCable = (link: dia.Link): Cable => ({
  from: String(link.source().id),
  to: String(link.target().id),
  fromSide: sideOf(link, 'from'),
  toSide: sideOf(link, 'to'),
  ...(link.get('slots') as { fromSlot?: number; toSlot?: number } | undefined),
});
const boxOf = (id: string): Box | undefined => {
  const card = graph.getCell(id) as dia.Cell | undefined;
  if (!card?.isElement()) return undefined;
  const { x, y } = card.position();
  const { width, height } = card.size();
  return { x, y, w: width, h: height };
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
const local = (ev: { clientX: number; clientY: number }): Point =>
  paper.clientToLocalPoint(ev.clientX, ev.clientY).toJSON();

/** Each end's place among the others on its side of the card, as the anchor the library draws it at. */
function placeEnds(): void {
  const all = cables();
  const { offset, onPort } = endOffsets(all.map(toCable), { cardOf: boxOf });
  all.forEach((link, index) => {
    for (const end of ['from', 'to'] as const)
      link.prop([KEY[end], 'anchor'], anchor(sideOf(link, end), offset[`${String(index)}|${end}`] ?? 0), {
        rewrite: true,
      });
  });
  ui.lit = onPort.map(port => `${port.id}|${port.side}`);
}

/** Our curve, drawn through the link's own vertices. */
const connector = (a: Point, b: Point, route: Point[], _args: unknown, view?: dia.LinkView): string => {
  const link = view?.model;
  if (!link) return '';
  const toSide = link.target().id ? sideOf(link, 'to') : null;
  return route.length
    ? throughPath(a, sideOf(link, 'from'), b, toSide, route)
    : cablePath(a, sideOf(link, 'from'), b, toSide);
};

const line = { stroke: 'var(--cable)', strokeWidth: 2.5, strokeLinecap: 'round' };
const newCable = (from: string, fromSide: Side, target: dia.Link.EndJSON, more: object = {}) =>
  new shapes.standard.DoubleLink({
    // Cables run under the cards.
    z: -1,
    source: { id: from, anchor: anchor(fromSide) },
    target,
    attrs: {
      line: {
        ...line,
        targetMarker: { type: 'path', d: 'M 18 -5.5 L 10 0 L 18 5.5', fill: 'none', ...line, strokeLinejoin: 'round' },
      },
      outline: { stroke: 'var(--desk)', strokeWidth: 8, strokeLinecap: 'round', opacity: 0.75 },
    },
    ...more,
  });
export const cable = (from: string, to: string, fromSide: Side, toSide: Side, points: Point[] = []) =>
  newCable(from, fromSide, { id: to, anchor: anchor(toSide) }, { vertices: points });

// The library's types do not cover a tool's pointer handlers.
const anchorTool = linkTools.SourceAnchor.prototype as unknown as Record<
  'onPointerDown' | 'onPointerUp',
  (evt: dia.Event) => void
>;
const endId = (link: dia.Link, end: End) => String((end === 'from' ? link.source() : link.target()).id);
const viewOf = (link: dia.Link) => link.findView(paper) as dia.LinkView;

/**
 * A cable's end, pressed: sliding it along its side reorders the cables there, live; pulling it away from the side
 * starts a new cable from that port. The library's anchor tool gives the handle and the drag; the rule is ours.
 */
const slidingEnd = (base: typeof linkTools.SourceAnchor, end: End, radius: number) =>
  base.extend({
    children: [
      {
        tagName: 'g',
        selector: 'anchor',
        className: `end ${end}`,
        children: [
          { tagName: 'circle', attributes: { r: radius } },
          ...(end === 'to' ? [{ tagName: 'circle', className: 'light', attributes: { r: 3.4 } }] : []),
        ],
      },
      { tagName: 'rect', selector: 'area', attributes: { 'pointer-events': 'none', fill: 'none' } },
    ],
    onPointerDown(this: SlidingEnd, evt: dia.Event) {
      anchorTool.onPointerDown.call(this, evt);
      this.start = local(util.normalizeEvent(evt) as unknown as MouseEvent);
      this.mode = null;
    },
    onPointerMove(this: SlidingEnd, evt: dia.Event) {
      const link = this.relatedView.model;
      const side = sideOf(link, end);
      const along = SIDES[side][0] === 0 ? 'x' : 'y';
      const at = local(util.normalizeEvent(evt) as unknown as MouseEvent);
      const slid = at[along] - this.start[along];
      const pulled = along === 'x' ? at.y - this.start.y : at.x - this.start.x;
      if (!this.mode) {
        if (Math.hypot(slid, pulled) < 6 / paper.scale().sx) return;
        this.mode = Math.abs(pulled) > Math.abs(slid) ? 'wire' : 'order';
        if (this.mode === 'wire') {
          this.onPointerUp(evt);
          startWire(endId(link, end), side);
          return;
        }
        this.el.classList.add('grabbed');
      }
      reorder(link, end, at[along]);
    },
    onPointerUp(this: SlidingEnd, evt: dia.Event) {
      this.el.classList.remove('grabbed');
      anchorTool.onPointerUp.call(this, evt);
    },
  }) as typeof linkTools.SourceAnchor;
type SlidingEnd = InstanceType<typeof linkTools.SourceAnchor> & {
  relatedView: dia.LinkView;
  start: Point;
  mode: 'order' | 'wire' | null;
  onPointerUp: (evt: dia.Event) => void;
};
const Plug = slidingEnd(linkTools.SourceAnchor, 'from', 5);
const Socket = slidingEnd(linkTools.TargetAnchor, 'to', 8);

function reorder(moved: dia.Link, end: End, to: number): void {
  const card = endId(moved, end);
  const side = sideOf(moved, end);
  const along = SIDES[side][0] === 0 ? 'x' : 'y';
  const list = cables()
    .flatMap((link, index) =>
      (['from', 'to'] as const)
        .filter(which => endId(link, which) === card && sideOf(link, which) === side)
        .map(which => ({ link, index, end: which })),
    )
    .sort(
      (a, b) =>
        (toCable(a.link)[`${a.end}Slot`] ?? Infinity) - (toCable(b.link)[`${b.end}Slot`] ?? Infinity) ||
        a.index - b.index,
    );
  const me = list.find(one => one.link === moved && one.end === end);
  if (!me || list.length < 2) return;
  const others = list.filter(one => one !== me);
  const drawnAt = (one: (typeof list)[number]) => viewOf(one.link).getEndAnchor(KEY[one.end])[along];
  const before = others.filter(one => drawnAt(one) < to).length;
  const order = [...others.slice(0, before), me, ...others.slice(before)];
  if (order.every((one, place) => list[place] === one)) return;
  order.forEach((one, place) => one.link.prop(['slots', `${one.end}Slot`], place));
  placeEnds();
}

const giveEnds = (link: dia.Link) => {
  const view = viewOf(link);
  view.addTools(
    new dia.ToolsView({ tools: [new linkTools.Vertices({ redundancyRemoval: false }), new Plug(), new Socket()] }),
  );
  view.el.setAttribute('tabindex', '0');
  view.el.setAttribute('data-cable', `${String(link.source().id)}>${String(link.target().id)}`);
  view.el.addEventListener('keydown', ev => {
    if (ev.key === 'Backspace' || ev.key === 'Delete') link.remove();
  });
};

/**
 * Drawing a cable: drag from a port to a card. Letting go on the empty board drops a waypoint there and the cable
 * stays on the pointer: each click on the board adds another, a click on a card finishes it, Escape cancels. The
 * cable being drawn is a real link whose far end follows the pointer.
 */
export function startWire(from: string, fromSide: Side): void {
  const box = boxOf(from);
  if (!box) return;
  const a = sidePoint(box, fromSide);
  const points: Point[] = [];
  const draft = newCable(from, fromSide, a, { draft: true });
  draft.attr('line/strokeDasharray', '6 6');
  draft.addTo(graph);
  ui.wiring = true;
  const target = (ev: PointerEvent) => {
    const id = cardAt(ev.clientX, ev.clientY);
    const at = id && id !== from ? boxOf(id) : undefined;
    return id && at ? { id, anchor: anchor(nearestSide(at, points.at(-1) ?? local(ev))) } : undefined;
  };
  const move = (ev: PointerEvent) => {
    const onto = target(ev);
    draft.target(onto ?? local(ev));
    ui.drop = onto?.id ?? null;
  };
  const end = () => {
    removeEventListener('pointermove', move);
    removeEventListener('pointerdown', click, true);
    removeEventListener('keydown', esc, true);
    ui.wiring = false;
    ui.drop = null;
  };
  const cancel = () => {
    end();
    draft.remove();
  };
  const finish = (ev: PointerEvent) => {
    const onto = target(ev);
    end();
    if (!onto) {
      draft.remove();
      return;
    }
    for (const old of cables()) if (old.source().id === from && old.target().id === onto.id) old.remove();
    draft.target(onto);
    draft.attr('line/strokeDasharray', null);
    draft.unset('draft');
    giveEnds(draft);
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
      cancel();
      return;
    }
    points.push(local(ev));
    draft.vertices(points);
    move(ev);
  };
  const esc = (ev: KeyboardEvent) => {
    if (ev.key !== 'Escape') return;
    ev.preventDefault();
    cancel();
  };
  addEventListener('pointermove', move);
  addEventListener(
    'pointerup',
    ev => {
      const at = local(ev);
      const far = Math.hypot(at.x - a.x, at.y - a.y) > 24 / paper.scale().sx;
      if (cardAt(ev.clientX, ev.clientY) || !far) {
        finish(ev);
        return;
      }
      points.push(at);
      draft.vertices(points);
      move(ev);
      addEventListener('pointerdown', click, true);
      addEventListener('keydown', esc, true);
    },
    { once: true },
  );
}

/** Arrange: places the cards, picks each cable's sides and its order along them, and drops the waypoints. */
export function arrangeBoard(): void {
  const size = (id: string) => boxOf(id) ?? { w: 260, h: 160 };
  const all = cables();
  const links = all.map(link => ({ from: String(link.source().id), to: String(link.target().id) }));
  const placed = arrange(
    graph.getElements().map(card => String(card.id)),
    links,
    size,
    'down',
    false,
    { pad: PAD },
  );
  const sided: Cable[] = links.map(link => ({ ...link, ...sidesFor(placed, link, 'down', size) }));
  orderSlots(sided, id => ({ ...(placed[id] ?? { x: 0, y: 0 }), ...size(id) }));
  for (const card of graph.getElements()) {
    const at = placed[String(card.id)];
    if (at) card.position(at.x, at.y);
  }
  all.forEach((link, index) => {
    const one = sided[index];
    if (!one) return;
    link.prop('source/anchor', anchor(one.fromSide), { rewrite: true });
    link.prop('target/anchor', anchor(one.toSide), { rewrite: true });
    link.set('slots', { fromSlot: one.fromSlot, toSlot: one.toSlot });
    link.vertices([]);
  });
  placeEnds();
  fit();
}

export const fit = () => {
  paper.transformToFitContent({
    padding: 80,
    maxScale: 1,
    useModelGeometry: true,
    verticalAlign: 'middle',
    horizontalAlign: 'middle',
  });
};
export const zoomBy = (factor: number, at?: { clientX: number; clientY: number }) => {
  const { width, height, left, top } = paper.el.getBoundingClientRect();
  const next = Math.min(2, Math.max(0.2, paper.scale().sx * factor));
  paper.scaleUniformAtPoint(next, local(at ?? { clientX: left + width / 2, clientY: top + height / 2 }));
};
/** A card moved by the keyboard. */
export const nudge = (id: string, x: number, y: number) => {
  (graph.getCell(id) as dia.Element).translate(x, y);
};

/** The board on JointJS: the library has no pan, zoom, picking or keyboard of its own in its open part. */
export function setup(
  el: HTMLElement,
  cards: (CardData & { id: string; x: number; y: number })[],
  links: dia.Link[],
): void {
  paper = new dia.Paper({
    el,
    model: graph,
    cellViewNamespace: namespace,
    width: '100%',
    height: '100%',
    async: false,
    overflow: true,
    gridSize: 1,
    drawGridSize: 24,
    drawGrid: { name: 'dot', args: { color: getComputedStyle(el).getPropertyValue('--dot').trim(), thickness: 2.4 } },
    defaultConnector: connector as never,
    defaultConnectionPoint: { name: 'anchor' },
    interactive: { linkMove: false, labelMove: false },
  });
  for (const { id, x, y, ...data } of cards) {
    const card = new Card({ id, position: { x, y } });
    card.addTo(graph);
    const host = card.findView(paper).findNode('host') as HTMLElement;
    mount(AppCard, { target: host, props: { id, data } });
    // The card sizes itself; the library is told.
    new ResizeObserver(() => card.resize(host.offsetWidth, host.offsetHeight)).observe(host);
    card.resize(host.offsetWidth, host.offsetHeight);
  }
  graph.addCells(links);
  links.forEach(giveEnds);
  placeEnds();
  graph.on('change:position change:size remove', placeEnds);

  let pan: { x: number; y: number } | null = null;
  paper.on('blank:pointerdown', evt => {
    const { tx, ty } = paper.translate();
    pan = { x: (evt.clientX ?? 0) - tx, y: (evt.clientY ?? 0) - ty };
    ui.selected = null;
  });
  paper.on('blank:pointermove', evt => {
    if (pan) paper.translate((evt.clientX ?? 0) - pan.x, (evt.clientY ?? 0) - pan.y);
  });
  paper.on('blank:pointerup', () => (pan = null));
  const wheel = (evt: dia.Event, delta: number) => {
    evt.preventDefault();
    zoomBy(delta > 0 ? 1.1 : 1 / 1.1, evt.originalEvent as WheelEvent);
  };
  paper.on('blank:mousewheel', (evt, _x, _y, delta) => wheel(evt, delta));
  paper.on('cell:mousewheel', (_view, evt, _x, _y, delta) => wheel(evt, delta));
  paper.on('scale', (scale: number) => (ui.far = scale < FAR_ZOOM));
  paper.on('element:pointerdown', view => (ui.selected = String(view.model.id)));
  fit();

  // For the check script.
  Object.assign(window, {
    board: {
      get edges() {
        return cables().map(link => ({
          id: `${String(link.source().id)}>${String(link.target().id)}`,
          ...toCable(link),
          ...(link.vertices().length && { points: link.vertices() }),
        }));
      },
      get nodes() {
        return graph
          .getElements()
          .map(card => ({ id: card.id, position: card.position(), selected: ui.selected === card.id }));
      },
      get draft() {
        return graph.getLinks().find(link => link.get('draft')) ?? null;
      },
      endScreen: (id: string, end: End) => {
        const link = cables().find(one => `${String(one.source().id)}>${String(one.target().id)}` === id);
        const at = link && viewOf(link).getEndAnchor(KEY[end]);
        return at && { flow: at.toJSON(), ...paper.localToClientPoint(at).toJSON() };
      },
    },
  });
}
