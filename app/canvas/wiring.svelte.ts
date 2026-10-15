// Drawing cables by hand: from a port through waypoints to a card, and sliding a cable's end along its side to reorder
// the cables there. The geometry is core/cables.
import type { Point, Side } from '../src/core/arrange.ts';
import { sidePoint, SIDES, type Box } from '../src/core/cables.ts';
import { board, cable, type End } from './board.svelte.ts';
import { toasts } from './toast.svelte.ts';

interface Draft {
  a: Point;
  side: Side;
  b: Point;
  bSide: Side | null;
  points: Point[];
}

const cardAt = (x: number, y: number) =>
  document
    .elementsFromPoint(x, y)
    .find((el): el is HTMLElement => el.classList.contains('svelte-flow__node'))
    ?.getAttribute('data-id') ?? undefined;

class Wiring {
  /** The cable being drawn. */
  draft = $state.raw<Draft | null>(null);
  /** The end being slid along its side. */
  grabbed = $state.raw<{ id: string; end: End } | null>(null);
  /** The card a drawn cable would land on. */
  drop = $state.raw<{ id: string; ok: boolean } | null>(null);

  /** Where a cable's end is drawn: its place among the others on that side of the card. */
  endPoint(index: number, end: End): Point | undefined {
    const one = board.cables[index];
    const box = one && board.boxes.get(one[end]);
    if (!box) return undefined;
    const side = one[`${end}Side`];
    const middle = sidePoint(box, side);
    const by = board.ends.offset[`${String(index)}|${end}`] ?? 0;
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
  start(from: string, fromSide: Side): void {
    const box = board.boxes.get(from);
    if (!box) return;
    const a = sidePoint(box, fromSide);
    const points: Point[] = [];
    const flow = (ev: PointerEvent) => board.toFlow({ x: ev.clientX, y: ev.clientY });
    // Let go on a port, the cable goes into that port; anywhere else on the card, into the side facing where it comes from.
    const target = (ev: PointerEvent) => {
      const id = cardAt(ev.clientX, ev.clientY);
      const at = id && id !== from ? board.boxes.get(id) : undefined;
      if (!id || !at) return undefined;
      const pointer = flow(ev);
      const onPort = (Object.keys(SIDES) as Side[]).find(
        side => Math.hypot(sidePoint(at, side).x - pointer.x, sidePoint(at, side).y - pointer.y) <= 16 / board.zoom(),
      );
      return { id, side: onPort ?? this.nearestSide(at, points.at(-1) ?? a), at };
    };
    const app = (id: string) => board.app(id);
    const calls = (caller: string, callee: string) => !!app(caller)?.calls.includes(callee);
    // A cable can land where the caller may call the app, and not against the only direction the code shows.
    const canCall = (to: string) => !app(from)?.outside && !!app(to) && !app(to)?.outside && !!app(to)?.answers;
    const wrongWay = (to: string) => !calls(from, to) && calls(to, from);
    const move = (ev: PointerEvent) => {
      const onto = target(ev);
      const lands = !!onto && canCall(onto.id) && !wrongWay(onto.id);
      this.draft = {
        a,
        side: fromSide,
        b: onto && lands ? sidePoint(onto.at, onto.side) : flow(ev),
        bSide: onto && lands ? onto.side : null,
        points: [...points],
      };
      this.drop = onto ? { id: onto.id, ok: lands } : null;
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
      const [caller, callee] = [app(from)?.name ?? from, app(onto.id)?.name ?? onto.id];
      if (!canCall(onto.id)) {
        const said = app(onto.id)?.answers
          ? `${caller} doesn't call ${callee}`
          : `${callee} is a ${app(onto.id)?.kindLabel ?? ''} app: it calls others, nothing calls it.`;
        toasts.show(said, 'warning');
        return;
      }
      // Drawn against the only call the repos show between these two: no cable is added; the real one is offered.
      if (wrongWay(onto.id)) {
        const wired = board.edges.some(edge => edge.id === `${onto.id}>${from}`);
        toasts.show(
          `In the code ${callee} calls ${caller}, not the other way round.${wired ? ' That cable is already on the board.' : ''}`,
          'warning',
          wired
            ? undefined
            : {
                label: 'Connect that way',
                run: () => {
                  board.connect(onto.id, from);
                },
              },
        );
        return;
      }
      const drawn = cable(from, onto.id, { fromSide, toSide: onto.side, ...(points.length && { points }) });
      board.edges = [...board.edges.filter(edge => edge.id !== drawn.id), drawn];
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
        const far = Math.hypot(at.x - a.x, at.y - a.y) > 24 / board.zoom();
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
    const pressed = board.edges.find(edge => edge.id === id);
    if (ev.button !== 0 || !pressed || board.live) return;
    ev.preventDefault();
    ev.stopPropagation();
    const card = end === 'from' ? pressed.source : pressed.target;
    const side = pressed.data[`${end}Side`];
    const along = SIDES[side][0] === 0 ? 'x' : 'y';
    const start = board.toFlow({ x: ev.clientX, y: ev.clientY });
    const members = () =>
      board.edges
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
      const at = board.toFlow({ x: moved.clientX, y: moved.clientY });
      const slid = at[along] - start[along];
      const pulled = along === 'x' ? at.y - start.y : at.x - start.x;
      if (!mode) {
        if (Math.hypot(slid, pulled) < 6 / board.zoom()) return;
        mode = Math.abs(pulled) > Math.abs(slid) ? 'wire' : 'order';
        if (mode === 'wire') {
          stop();
          this.start(card, side);
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
      board.edges = board.edges.map(edge => {
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
}
export const wiring = new Wiring();
