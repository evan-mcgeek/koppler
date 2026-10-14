// The board: cards and cables as Svelte Flow holds them, and the socket behaviour on top (drawing a cable through
// waypoints, sliding an end along its side). The geometry is core/cables and core/arrange, unchanged.
import type { Edge, Node } from '@xyflow/svelte';
import { arrange, sidesFor, squeeze, type Point, type Side } from '../src/core/arrange.ts';
import { endOffsets, orderSlots, SIDES, type Box, type Cable } from '../src/core/cables.ts';
import { of as kindOf } from '../src/core/kinds.ts';
import { isProtected, LOCAL_QUEUE_TYPES, queuesOf } from '../src/core/plan.ts';
import { planTunnels, tunnelKind, type Tunnel } from '../src/core/ports.ts';
import {
  check,
  editPreset,
  migrate,
  VERSION as PRESET_VERSION,
  type BoardEdit,
  type StackFacts,
  type StoredPreset,
} from '../src/core/presets.ts';
import type { Registry } from '../src/data.ts';
import { load, save, type Loaded, type SavedBoard } from './data.ts';

export interface CableData extends Record<string, unknown> {
  fromSide: Side;
  toSide: Side;
  fromSlot?: number;
  toSlot?: number;
  /** How far from the middle of its side Arrange centred the cables this end sits among. */
  fromShift?: number;
  toShift?: number;
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
  /** Runs without its tunnels, when only its API is needed. */
  hideTunnels?: boolean;
  /** It is on its queues: linked to their cards, each of which can run locally. Off by default: it keeps the deployed ones. */
  showQueues?: boolean;
  /** What happens to the clone's uncommitted changes when another branch runs; set aside unless chosen. */
  changes?: Changes;
  /** The libraries it runs with the local copy of, by name. */
  libraries?: string[];
}
export type Changes = 'set-aside' | 'take-along';
/** Below this zoom a card is drawn in its short form. */
export const FAR_ZOOM = 0.6;
type Size = { w: number; h: number };
/** Arrange's layouts, in the order it steps through them: callers on top or on the left, and each read the other way round. */
const LAYOUTS = [
  ['down', false],
  ['right', false],
  ['down', true],
  ['right', true],
] as const;
/** A stack on this machine. */
export interface KnownStack {
  dir: string;
  path: string;
  name: string;
  apps: number;
  envs: string[];
  shared: boolean;
  linked?: string;
}
/** A board in the recently deleted, with when it went there. */
export type Deleted = StoredPreset & { deleted: string };
interface Opened {
  name: string;
  at: string;
}
export type CardNode = Node<CardData, 'app'>;
/** A tunnel to a database or cache: a read-only card beside the first app on the board that uses it. */
export interface TunnelData extends Record<string, unknown> {
  what: string;
  /** The local address and port it listens on, and whether the plan moved it off the port the stack asked for. */
  local: string;
  moved: boolean;
  host: string;
  /** What is worth knowing about it, one line each. */
  about: string[];
  apps: string[];
}
export type TunnelNode = Node<TunnelData, 'tunnel'>;
/** A queue between apps: a card with a switch between the deployed queue and a local copy. */
export interface QueueData extends Record<string, unknown> {
  queue: string;
  name: string;
  /** Its type, as the card shows it: SQS, KAFKA. */
  kind: string;
  /** Whether Koppler can run this type locally, and whether the board asks for that. */
  can: boolean;
  local: boolean;
  /** Set when a local app reads the deployed queue: it takes messages the deployed reader would get. */
  shares: string;
  about: string[];
}
export type QueueNode = Node<QueueData, 'queue'>;
/** An outside system, such as a payment provider: it never runs here. */
export interface OutsideData extends Record<string, unknown> {
  name: string;
  /** Which one the board's environment uses, or that it never runs. */
  where: string;
  about: string[];
}
export type OutsideNode = Node<OutsideData, 'outside'>;
/** Every card that is not an app. */
export type InfraNode = TunnelNode | QueueNode | OutsideNode;
/** A line between cards that is not a cable: a message to or from a queue, or a call to an outside system. */
export interface Flow {
  from: string;
  to: string;
  /** The queue a message link belongs to. */
  queue?: string;
}
const tunnelKey = (tunnel: Tunnel) => `tunnel:${tunnel.host}:${String(tunnel.original)}`;
/** The room a tunnel card is given before it has been measured, and the gap that keeps it beside its app. */
const TUNNEL = { w: 230, h: 58, gap: 40 };
const TUNNEL_SIDES: Side[] = ['bottom', 'right', 'left', 'top'];
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
  /** Only the calls the stack itself records. */
  known: string[];
  /** Whether anything can call it: it serves, or some app is known to call it. */
  answers: boolean;
  /** Whether it has a local address of its own to ask for an answer. */
  serves: boolean;
  /** Who may start it and, for a mobile app, on what. */
  runIn: readonly (readonly [string, string])[];
  platforms: readonly (readonly [string, string])[];
  /** The clone's branch, its other branches, and how many files it has changed. */
  current: string;
  branches: string[];
  dirty: number;
  /** The libraries it depends on that are cloned here, and where. */
  libraries: { name: string; path: string }[];
}
const PAD = 24;
/** The room a new card is given before it has been measured. */
const PLACE = { w: 300, h: 240, gap: 32 };
export const cable = (from: string, to: string, data: CableData): CableEdge => ({
  id: `${from}>${to}`,
  source: from,
  target: to,
  type: 'cable',
  data,
});

const unselected = <T extends { selected?: boolean }>(one: T): T => (one.selected ? { ...one, selected: false } : one);

class Board {
  /** The stack's name and the environment the board runs against; empty until the board is opened. */
  stack = $state('');
  /** The folder of the stack in use. */
  dir = $state('');
  /** No stack yet: the page asks for one. */
  setup = $state(false);
  /** The stacks found on this machine, for choosing one when there is none. */
  known = $state.raw<KnownStack[]>([]);
  env = $state('');
  nodes = $state.raw<CardNode[]>([]);
  #cards: CardNode[] = [];
  /**
   * The cards as far as anything but their places goes: the same list while cards only move, so a drag recomputes what
   * depends on where cards are (boxes, cable ends) and nothing else. Never read a position from it.
   */
  cards = $derived.by(() => {
    const now = this.nodes;
    const same =
      now.length === this.#cards.length &&
      now.every((node, at) => node.id === this.#cards[at]?.id && node.data === this.#cards[at].data);
    if (!same) this.#cards = now;
    return this.#cards;
  });
  edges = $state.raw<CableEdge[]>([]);
  /** The cable under the pointer: a click unplugs it. */
  hovered = $state.raw<string | null>(null);
  /** A protected environment (production, usually): local code runs against its real data. */
  #guarded = $state.raw<string[]>([]);
  protected = $derived(this.#guarded.includes(this.env));
  /** Set by the flow once it is up. */
  toFlow: (at: Point) => Point = at => at;
  zoom: () => number = () => 1;

  cables = $derived<Cable[]>(this.edges.map(edge => ({ from: edge.source, to: edge.target, ...edge.data })));
  /** Tunnel cards, kept apart from the app cards: the flow shows both. */
  infra = $state.raw<InfraNode[]>([]);
  /** The queues run locally instead of the deployed ones, and the queues taken off the board. */
  queues = $state.raw<Record<string, 'local'>>({});
  hiddenQueues = $state.raw<Record<string, true>>({});
  /** The outside systems put on the board by hand: shown even when none of their apps is. */
  pinned = $state.raw<string[]>([]);
  pin(id: string): void {
    if (!this.pinned.includes(id)) this.pinned = [...this.pinned, id];
  }
  unpin(id: string): void {
    this.pinned = this.pinned.filter(one => one !== id);
  }
  infraBoxes = $derived(
    new Map<string, Box>(
      this.infra.map(({ id, position, measured }) => [
        id,
        { ...this.shown(position), w: measured?.width ?? TUNNEL.w, h: measured?.height ?? TUNNEL.h },
      ]),
    ),
  );
  /** Presenting: the board alone, full screen. */
  present = $state(false);
  /** Full screen is being changed from here: the browser's word about it is not the user leaving.  */
  entering = false;
  /** Zoomed out or in Live the cards are short: the empty bands their full form needs are squeezed, on screen only. */
  brief = $state(false);
  /** Each card's height in full, as last drawn so: short, the room it needs only then is closed up. */
  fullHeights = $state.raw<Record<string, number>>({});
  #squeeze(top: (id: string, at: Point) => number = (_, at) => at.y) {
    const taken: [number, number][] = [];
    const needed: [number, number][] = [];
    for (const { id, position, measured } of [...this.nodes, ...this.infra]) {
      const height = measured?.height;
      if (!height) continue;
      const y = top(id, position);
      taken.push([y, y + height]);
      const full = this.fullHeights[id] ?? 0;
      if (full > height) needed.push([y + height, y + full]);
    }
    return squeeze(this.brief ? taken : [], this.brief ? needed : []);
  }
  #squeezed = squeeze([], []);
  /** While a card is dragged the board holds still around it, so it stays under the pointer. */
  squeezed = $derived.by(() => {
    if ([...this.nodes, ...this.infra].some(card => card.dragging)) return this.#squeezed;
    this.#squeezed = this.#squeeze();
    return this.#squeezed;
  });
  /** Where a card kept at this place is drawn, and back. */
  shown = (at: Point): Point => ({ x: at.x, y: this.squeezed.show(at.y) });
  stored = (at: Point): Point => ({ x: at.x, y: this.squeezed.back(at.y) });
  /** Where a card let go at this place is kept: counting the room it now takes there, it stays drawn where it was let go. */
  dropped(id: string, at: Point): Point {
    let y = this.squeezed.back(at.y);
    for (let tries = 0; tries < 4; tries++) y = this.#squeeze((one, kept) => (one === id ? y : kept.y)).back(at.y);
    return { x: at.x, y };
  }

  /** The cards as drawn. */
  boxes = $derived(
    new Map<string, Box>(
      this.nodes.flatMap(({ id, position, measured }) =>
        measured?.width && measured.height
          ? [[id, { ...this.shown(position), w: measured.width, h: measured.height }]]
          : [],
      ),
    ),
  );
  #registry = $state.raw<Registry | undefined>();
  /** The apps whose new tunnel cards still wait for their real place. */
  unplaced = $state.raw<string[]>([]);

  /** The databases and caches an app reaches through tunnels in the board's environment. */
  tunnelsOf(id: string) {
    const app = this.#registry?.apps[id];
    const own = this.env !== this.envs[0] ? app?.envs?.[this.env]?.prereqs : undefined;
    // A port that is not a number (a broken or hostile stack file) never reaches the page.
    return (own ?? app?.prereqs ?? []).flatMap(need => {
      const { tunnel, port } = need;
      return tunnel && port && Number.isInteger(port) && port < 65536 ? [{ ...need, tunnel, port }] : [];
    });
  }
  /** The tunnels for everything on the board, planned together so none clash: shared, moved, or on an address of its own. */
  plan = $derived.by(() => {
    const shown = this.cards.filter(node => !node.data.hideTunnels);
    const needs = shown.flatMap(({ id }) =>
      this.tunnelsOf(id).map(need => ({
        app: id,
        tunnel: need.tunnel,
        port: need.port,
        env: need.env,
        what: tunnelKind(need),
        connectsAs: need.connectsAs,
      })),
    );
    const taken = this.cards.flatMap(({ id }) => {
      const port = Number(new URL(this.#registry?.apps[id]?.url ?? 'http://none').port);
      return port ? [port] : [];
    });
    return planTunnels(needs, taken);
  });
  /** The tunnel cards an app leads: those it is the first app on the board to use. They stay beside it. */
  ledBy(id: string): string[] {
    return [
      ...this.plan.filter(tunnel => tunnel.apps[0] === id).map(tunnelKey),
      ...this.boardQueues.filter(queue => this.#leadOf(queue) === id).map(queue => `queue:${queue.id}`),
    ];
  }
  #onBoard = $derived(new Set(this.cards.map(node => node.id)));
  /** The apps on the board that are still on their queues. */
  #onQueues = $derived(new Set(this.cards.filter(node => node.data.showQueues).map(node => node.id)));
  #outside(id: string): boolean {
    return !!this.#registry?.apps[id]?.outside;
  }
  /** The queues of the stack that an app on the board publishes to or reads, with who uses each. */
  boardQueues = $derived.by(() => {
    const apps = this.#registry?.apps ?? {};
    return Object.entries(this.#registry?.queues ?? {}).flatMap(([id, queue]) => {
      const users = (how: 'publishes' | 'reads') =>
        Object.keys(apps).filter(
          app => Object.hasOwn(apps[app]?.[how] ?? {}, id) && (this.#onQueues.has(app) || this.#outside(app)),
        );
      const [pubs, reads] = [users('publishes'), users('reads')];
      // A queue between two apps stays for the one that is still on it.
      const shown = !this.hiddenQueues[id] && [...pubs, ...reads].some(app => this.#onQueues.has(app));
      return shown ? [{ id, queue, pubs, reads }] : [];
    });
  });
  /**
   * The cards that are an app's own and go where it goes: its tunnels, and the queues no other app on the board uses.
   * A queue shared by several apps is a card of the flow between them.
   */
  ownedBy(id: string): string[] {
    const alone = (queue: { pubs: string[]; reads: string[] }) =>
      [...queue.pubs, ...queue.reads].filter(app => this.#onBoard.has(app)).every(app => app === id);
    return this.ledBy(id).filter(
      key => key.startsWith('tunnel:') || this.boardQueues.some(one => `queue:${one.id}` === key && alone(one)),
    );
  }
  #leadOf(queue: { pubs: string[]; reads: string[] }): string | undefined {
    return [...queue.pubs, ...queue.reads].find(app => this.#onBoard.has(app));
  }
  queueName(id: string): string {
    return this.#registry?.queues?.[id]?.name ?? id;
  }
  /** A branch other than the clone's is asked for while the clone has uncommitted changes. */
  switchesOver(id: string): boolean {
    const branch = this.cards.find(node => node.id === id)?.data.branch;
    const app = this.app(id);
    return !!(branch && app?.current && branch !== app.current && app.dirty);
  }

  /** The libraries a card runs with the local copy of, among the ones cloned here. */
  localLibraries(id: string): string[] {
    const chosen = this.cards.find(node => node.id === id)?.data.libraries ?? [];
    const here = this.app(id)?.libraries ?? [];
    return chosen.filter(name => here.some(library => library.name === name));
  }

  /**
   * An app whose stack entry has no sign-in, tunnel or hosts entry of its own for this environment while the first
   * environment has one: it would run on another environment's.
   */
  borrowsTunnels(id: string): boolean {
    if (this.env === this.envs[0]) return false;
    const app = this.#registry?.apps[id];
    const own = app?.envs?.[this.env]?.prereqs ?? [];
    const hidden = this.cards.find(node => node.id === id)?.data.hideTunnels;
    return (['sso', 'signIn', 'tunnel', 'hosts'] as const).some(
      kind =>
        (app?.prereqs ?? []).some(need => need[kind]) &&
        !own.some(need => need[kind]) &&
        // A sign-in is needed with or without its tunnels.
        !(kind !== 'sso' && kind !== 'signIn' && hidden),
    );
  }
  /** An app's queues that the stack describes. */
  queuesOf(id: string): string[] {
    return queuesOf(this.#registry, id).filter(queue => this.#registry?.queues?.[queue]);
  }
  /** The message links and the calls to outside systems, between the cards they join. */
  flows = $derived.by((): Flow[] => {
    const card = (app: string) => (this.#outside(app) ? `outside:${app}` : app);
    return [
      ...this.boardQueues.flatMap(({ id, pubs, reads }) => [
        ...pubs.map(app => ({ from: card(app), to: `queue:${id}`, queue: id })),
        ...reads.map(app => ({ from: `queue:${id}`, to: card(app), queue: id })),
      ]),
      ...this.cards.flatMap(({ id }) =>
        Object.keys(this.#registry?.apps[id]?.consumes ?? {})
          .filter(app => this.#outside(app))
          .map(app => ({ from: id, to: `outside:${app}` })),
      ),
      // An outside system that calls the apps on the board: a webhook, say.
      ...Object.entries(this.#registry?.apps ?? {}).flatMap(([id, app]) =>
        this.#outside(id)
          ? Object.keys(app.consumes ?? {})
              .filter(to => this.cards.some(node => node.id === to))
              .map(to => ({ from: `outside:${id}`, to }))
          : [],
      ),
    ];
  });
  /** The side of an app its tunnel and queue cards stack on: the first one its cables do not use. */
  infraSide(id: string): Side {
    const used = new Set(this.cables.flatMap(one => [one.from === id && one.fromSide, one.to === id && one.toSide]));
    return TUNNEL_SIDES.find(one => !used.has(one)) ?? 'bottom';
  }
  /** The apps this one still calls in the deployed environment: the calls the stack knows that have no cable. */
  deployedCalls(id: string): StackApp[] {
    const called = this.app(id)?.calls ?? [];
    return called.flatMap(to => {
      const app = this.app(to);
      return app && !app.outside && !this.edges.some(edge => edge.id === `${id}>${to}`) ? [app] : [];
    });
  }
  /** Runs an app this one calls locally too: on the board if it is not, and cabled. */
  callLocally(from: string, to: string): void {
    this.add(to);
    if (this.nodes.some(node => node.id === to)) this.connect(from, to);
  }
  setQueue(id: string, local: boolean): void {
    const { [id]: _was, ...others } = this.queues;
    this.queues = local ? { ...others, [id]: 'local' } : others;
    this.syncInfra();
  }
  /** Takes queues off the board, or brings them back: their apps then use the deployed ones. */
  showQueues(ids: string[], show: boolean): void {
    const kept = Object.entries(this.hiddenQueues).filter(([id]) => !ids.includes(id));
    this.hiddenQueues = Object.fromEntries(show ? kept : [...kept, ...ids.map(id => [id, true] as const)]);
  }
  /** Which apps each tunnel card is linked to. */
  links = $derived(this.plan.flatMap(tunnel => tunnel.apps.map(app => ({ from: app, to: tunnelKey(tunnel), tunnel }))));
  /**
   * One app card picked: it, the cards its cables and links join, and its own tunnel, queue and outside cards stay
   * bright; the rest of the board is dimmed. Null with nothing or several picked.
   */
  /**
   * One card picked (an app, a tunnel, a queue or an outside system), or one cable: it and what it joins stay bright,
   * the rest of the board is dimmed. `id` is the picked card; a picked cable has `cable` and its two ends instead.
   */
  focus = $derived.by((): { id: string | null; cable?: [string, string]; near: string[] } | null => {
    const cards = [...this.nodes, ...this.infra].filter(node => node.selected);
    const cables = this.edges.filter(edge => edge.selected);
    const [one] = cards;
    const [wire] = cables;
    if (cards.length === 1 && !cables.length && one) {
      const near = [one.id];
      for (const { from, to } of [...this.cables, ...this.links, ...this.flows])
        if (from === one.id || to === one.id) near.push(from, to);
      return { id: one.id, near };
    }
    if (!cards.length && cables.length === 1 && wire)
      return { id: null, cable: [wire.source, wire.target], near: [wire.source, wire.target] };
    return null;
  });
  /** Whether a card is dimmed while another is picked. */
  dimmed = (id: string): boolean => !!this.focus && !this.focus.near.includes(id);
  /** Whether a cable or link is the picked card's own, or the picked cable itself. */
  lit = (from: string, to: string): boolean => {
    const focus = this.focus;
    if (!focus) return false;
    if (focus.cable) return focus.cable[0] === from && focus.cable[1] === to;
    return from === focus.id || to === focus.id;
  };
  /** Whether a cable or link is dimmed while something else is picked. */
  dimmedLink = (from: string, to: string): boolean => !!this.focus && !this.lit(from, to);

  /** How much of a card's bottom edge the tunnel cards under it cover, and whether they sit at its right end. */
  #coveredBelow(id: string) {
    const card = this.boxes.get(id);
    const under = this.ledBy(id)
      .flatMap(key => this.infraBoxes.get(key) ?? [])
      .filter(box => card && box.y > card.y && box.x < card.x + card.w && box.x + box.w > card.x);
    return {
      covered: under.length ? Math.max(...under.map(box => box.w + 12)) : 0,
      atRight: !!card && !!under.length && under.every(box => Math.abs(box.x + box.w - card.x - card.w) < 2),
    };
  }
  ends = $derived(
    endOffsets(this.cables, { cardOf: id => this.boxes.get(id), coveredBelow: id => this.#coveredBelow(id) }),
  );

  /**
   * Tunnel cards go on the first side of their app its cables do not use (below, else right, left, above), so they
   * are never in front of cables, stacked there as one block with the app.
   */
  #beside(
    id: string,
    cards: InfraNode[],
    size: Size = this.boxes.get(id) ?? { w: 260, h: 200 },
    ownOnly = false,
  ): InfraNode[] {
    const app = this.nodes.find(node => node.id === id);
    const led = new Set(ownOnly ? this.ownedBy(id) : this.ledBy(id));
    if (!app || !led.size) return cards;
    const box = { ...app.position, ...size };
    const side = this.infraSide(id);
    let y = side === 'bottom' ? box.y + box.h + TUNNEL.gap / 2 : side === 'top' ? box.y - TUNNEL.gap / 2 : box.y;
    return cards.map(card => {
      if (!led.has(card.id)) return card;
      const size = this.infraBoxes.get(card.id) ?? TUNNEL;
      if (side === 'top') y -= size.h;
      const x = side === 'right' ? box.x + box.w + TUNNEL.gap : side === 'left' ? box.x - TUNNEL.gap - size.w : box.x;
      const placed = { ...card, position: { x, y } };
      y += side === 'top' ? -TUNNEL.gap / 2 : size.h + TUNNEL.gap / 2;
      return placed;
    });
  }

  /** Brings the tunnel cards in line with the plan: a card for each tunnel, new ones beside the app that leads them. */
  syncInfra(at: Record<string, Point | undefined> = {}): void {
    const before = new Map(this.infra.map(card => [card.id, card]));
    const fresh: string[] = [];
    const tunnels = this.plan.map((tunnel): TunnelNode => {
      const id = tunnelKey(tunnel);
      const kept = before.get(id);
      if (!kept && !at[id]) fresh.push(tunnel.apps[0] ?? '');
      const need = tunnel.apps.flatMap(app => this.tunnelsOf(app)).find(one => one.tunnel === tunnel.host);
      const note = (need as { note?: unknown } | undefined)?.note;
      return {
        ...kept,
        id,
        type: 'tunnel',
        deletable: false,
        position: kept?.position ?? at[id] ?? { x: 0, y: 0 },
        data: {
          what: tunnel.what,
          local: `${tunnel.bind}:${String(tunnel.port)}`,
          moved: !!tunnel.settings || !!tunnel.needsAlias,
          host: tunnel.host,
          about: [
            tunnel.settings
              ? `Moved from port ${String(tunnel.original)} so it does not clash with another tunnel on the board.`
              : '',
            tunnel.needsAlias
              ? `Keeps port ${String(tunnel.port)} on its own loopback address, ${tunnel.bind}, so it does not clash (needs sudo once).`
              : '',
            typeof note === 'string' ? note : '',
          ].filter(Boolean),
          apps: tunnel.apps,
        },
      };
    });
    const env = this.env.toUpperCase();
    const name = (app: string) => this.#registry?.apps[app]?.name ?? app;
    const queues = this.boardQueues.map((one): QueueNode => {
      const id = `queue:${one.id}`;
      const kept = before.get(id);
      const lead = this.#leadOf(one);
      if (!kept && !at[id] && lead) fresh.push(lead);
      const can = (LOCAL_QUEUE_TYPES as readonly string[]).includes(one.queue.type);
      const local = can && this.queues[one.id] === 'local';
      const readers = one.reads.filter(app => this.#onBoard.has(app)).map(name);
      const shares = !local && readers.length ? readers.join(' and ') : '';
      return {
        ...(kept as QueueNode | undefined),
        id,
        type: 'queue',
        deletable: false,
        position: kept?.position ?? at[id] ?? { x: 0, y: 0 },
        data: {
          queue: one.id,
          name: one.queue.name,
          kind: one.queue.type.toUpperCase(),
          can,
          local,
          shares: shares ? `Your local ${shares} reads the ${env} queue` : '',
          about: [
            one.queue.envs?.[this.env]?.queue ?? one.queue.queue ?? one.id,
            shares
              ? `It takes messages the deployed ${env} reader would get. Switch to Local to give your run its own copy.`
              : '',
          ].filter(Boolean),
        },
      };
    });
    const linked = [
      ...new Set([
        ...this.flows.flatMap(flow => [flow.from, flow.to]),
        ...this.pinned.filter(id => this.#outside(id)).map(id => `outside:${id}`),
      ]),
    ].filter(key => key.startsWith('outside:'));
    const outside = linked.map((id): OutsideNode => {
      const app = this.#registry?.apps[id.slice(8)];
      const kept = before.get(id);
      const own = this.env === this.envs[0] ? undefined : app?.envs?.[this.env]?.deployedUrl;
      const address = typeof own === 'string' ? own : (app?.deployedUrl ?? '');
      const host = URL.canParse(address) ? new URL(address).hostname : '';
      const why = typeof app?.outside === 'string' ? `: ${app.outside.replace(/\.+$/, '')}` : '';
      return {
        ...(kept as OutsideNode | undefined),
        id,
        type: 'outside',
        deletable: false,
        position: kept?.position ?? at[id] ?? { x: 0, y: 0 },
        data: {
          name: app?.name ?? id.slice(8),
          where: host ? `${env}: ${host}` : 'Outside, never runs',
          about: [
            `${app?.name ?? id.slice(8)} does not run on this Mac${why}. Koppler cannot check calls to it.`,
            host ? `The ${env} board uses ${address}.` : '',
            ...this.flows
              .filter(flow => flow.from === id)
              .map(flow => `It sends to the deployed ${name(flow.to)}, not to your local one.`),
          ].filter(Boolean),
        },
      };
    });
    let cards: InfraNode[] = [...tunnels, ...queues, ...outside];
    for (const lead of fresh) cards = this.#beside(lead, cards);
    // An outside system goes beside the card it is linked to, on the first spot that is free.
    for (const card of outside.filter(one => !before.has(one.id) && !at[one.id])) {
      const spot = this.#nextTo(card.id, cards);
      cards = cards.map(one => (one.id === card.id ? { ...one, position: spot } : one));
    }
    this.infra = cards;
    this.unplaced = [...new Set([...this.unplaced, ...fresh])];
  }

  /** A free spot for a new card beside what it is linked to: right of what calls it, left of what it feeds. */
  #nextTo(
    id: string,
    cards: InfraNode[],
    sizeOf = (key: string): Size => this.boxes.get(key) ?? { w: 260, h: 200 },
  ): Point {
    const size = TUNNEL;
    const box = (key: string): Box | undefined => {
      const card = cards.find(one => one.id === key && (one.id === id || one.position.x || one.position.y));
      const app = this.nodes.find(node => node.id === key);
      return card
        ? { ...card.position, ...(this.infraBoxes.get(key) ?? size) }
        : app && { ...app.position, ...sizeOf(key) };
    };
    const near = this.flows.flatMap(flow => {
      const other = flow.from === id ? flow.to : flow.to === id ? flow.from : undefined;
      const at = other === undefined ? undefined : box(other);
      return at ? [{ at, before: flow.to === id }] : [];
    });
    const taken = [
      ...this.nodes.map(node => box(node.id)),
      ...cards.filter(one => one.id !== id).map(one => box(one.id)),
    ];
    const free = (spot: Point) =>
      taken.every(
        one =>
          !one ||
          spot.x + size.w + 16 <= one.x ||
          one.x + one.w + 16 <= spot.x ||
          spot.y + size.h + 16 <= one.y ||
          one.y + one.h + 16 <= spot.y,
      );
    const [first] = near;
    if (!first) return { x: 40, y: 40 };
    const { at, before } = first;
    const sides = before ? [at.x + at.w + 80, at.x - size.w - 80] : [at.x - size.w - 80, at.x + at.w + 80];
    const spots = [
      { x: sides[0] ?? 0, y: at.y },
      { x: sides[1] ?? 0, y: at.y },
      { x: at.x, y: at.y + at.h + 40 },
      { x: at.x, y: at.y - size.h - 40 },
      // Still nothing free: down the first choice.
      ...Array.from({ length: 9 }, (_, step) => ({ x: sides[0] ?? 0, y: at.y + (step + 1) * (size.h + 24) })),
    ];
    return spots.find(free) ?? spots[0] ?? { x: 40, y: 40 };
  }

  /** New tunnel cards were placed by guess: put right once their app and they have their real sizes. */
  settle(): void {
    const sized = (cards: { measured?: { width?: number } }[]) => cards.every(card => card.measured?.width);
    if (!this.unplaced.length || !sized(this.nodes) || !sized(this.infra)) return;
    let cards = this.infra;
    for (const lead of this.unplaced) cards = this.#beside(lead, cards);
    this.unplaced = [];
    this.infra = cards;
  }

  /** An app that moves takes the tunnel cards it leads along. */
  /** The cards an app leads that sit under what was its bottom edge, moved down or up as it grows or shrinks. */
  pushed(id: string, bottom: number, by: number, cards: InfraNode[]): InfraNode[] {
    const led = new Set(this.ledBy(id));
    return cards.map(card =>
      led.has(card.id) && card.position.y >= bottom
        ? { ...card, position: { x: card.position.x, y: card.position.y + by } }
        : card,
    );
  }
  /** Moved with its app: its own cards (tunnels, queues only it uses). A shared queue stays where it is put. */
  followed(id: string, by: Point, cards: InfraNode[]): InfraNode[] {
    const led = new Set(this.ownedBy(id));
    return cards.map(card =>
      led.has(card.id) && !card.selected && !card.dragging
        ? { ...card, position: { x: card.position.x + by.x, y: card.position.y + by.y } }
        : card,
    );
  }

  /** Turns off the tunnels of every app that uses this one. ponytail: per tunnel, once apps have several. */
  hideTunnel(key: string): void {
    const card = this.infra.find(one => one.id === key);
    const apps = new Set(card?.type === 'tunnel' ? card.data.apps : []);
    this.nodes = this.nodes.map(node =>
      apps.has(node.id) ? { ...node, data: { ...node.data, hideTunnels: true } } : node,
    );
  }

  /** The cards as the flow draws them: squeezed into view when far away. */
  flowNodes(): (CardNode | InfraNode)[] {
    return [...this.nodes, ...this.infra].map(node => ({ ...node, position: this.shown(node.position) }));
  }
  /** Each card's height when last drawn, and in which form (far away, Live): growing in the same form pushes others. */
  #heights: Record<string, { brief: string; height: number } | undefined> = {};
  /**
   * Takes the cards as the flow drew them, after a drag, the arrow keys or a change of size. `brief` names the form
   * cards are drawn in; until `settled` (the first status shown) cards are still filling in, and their growth pushes
   * nothing. True when a card's change of size moved others.
   */
  fromFlow(drawn: (CardNode | InfraNode)[], brief: string, settled: boolean): boolean {
    // The flow has the cards where they are drawn: one it moved is kept where that is on the full board.
    const kept = new Map([...this.nodes, ...this.infra].map(node => [node.id, node]));
    const all = drawn.map(node => {
      const at = kept.get(node.id);
      if (at?.dragging && !node.dragging) return { ...node, position: this.dropped(node.id, node.position) };
      const was = at && this.shown(at.position);
      return at && was?.x === node.position.x && was.y === node.position.y
        ? { ...node, position: at.position }
        : { ...node, position: this.stored(node.position) };
    }) as (CardNode | InfraNode)[];
    // An app the library moved (a drag, the arrow keys) takes its tunnel cards along, in the same step.
    const was = new Map(this.nodes.map(node => [node.id, node.position]));
    const grew: Record<string, { bottom: number; by: number }> = {};
    let infra = all.filter(node => node.type !== 'app');
    let apps = all.filter(node => node.type === 'app');
    for (const { id, measured } of apps) {
      // Grown or shrunk in the same form, it moves the app cards under it too, each with its own tunnel cards.
      // ponytail: only the cards straight under it; a card under one of those, off to the side, stays.
      const last = this.#heights[id];
      const height = measured?.height;
      if (height) this.#heights[id] = { brief, height };
      // Only growing in the same form moves what is under it: a change of form is squeezed on screen instead.
      const by = settled && last?.brief === brief && height ? height - last.height : 0;
      if (by) grew[id] = { bottom: last?.height ?? 0, by };
      const box = this.boxes.get(id);
      if (by && box) {
        const under = (other: Box | undefined) =>
          !!other && other.y >= box.y + (last?.height ?? 0) && other.x < box.x + box.w && box.x < other.x + other.w;
        for (const below of apps.filter(node => node.id !== id && under(this.boxes.get(node.id))))
          infra = this.followed(below.id, { x: 0, y: by }, infra);
        apps = apps.map(node =>
          node.id !== id && under(this.boxes.get(node.id))
            ? { ...node, position: { x: node.position.x, y: node.position.y + by } }
            : node,
        );
      }
    }
    for (const { id, position } of apps) {
      // A card that grows or shrinks (its steps open, a note) moves the cards stacked under it by as much.
      const grown = grew[id];
      if (grown) infra = this.pushed(id, position.y + grown.bottom, grown.by, infra);
      const from = was.get(id);
      if (from && (from.x !== position.x || from.y !== position.y))
        infra = this.followed(id, { x: position.x - from.x, y: position.y - from.y }, infra);
    }
    this.nodes = apps;
    this.infra = infra;
    return Object.keys(grew).length > 0;
  }

  /** Where the board was left: its zoom and position. Unset until one is known. */
  view = $state.raw<{ x: number; y: number; zoom: number } | undefined>();
  /** Whether the last change reached the server. */
  unsaved = $state(false);
  #kept: SavedBoard = {};

  /** The Live view: the same board, in the same places, as read-only cards with their state. */
  live = $state(false);
  #edit = '';
  #keptEdit: SavedBoard = {};

  /** Shows the board as it runs. What Edit holds (the cards beside a card that changes size, the undo history) is put aside untouched. */
  goLive(): void {
    if (this.live) return;
    this.commit();
    this.#keptEdit = this.saved();
    this.#edit = this.content();
    this.live = true;
  }
  /** Back to the board as it was left in Edit. */
  goEdit(): void {
    if (!this.live) return;
    this.setContent(this.#edit);
    this.live = false;
  }

  /** The cards and cables as one text: a step of the undo history. */
  content(): string {
    return JSON.stringify({
      name: this.name,
      nodes: this.nodes.map(({ id, type, position, data }) => ({ id, type, position, data })),
      infra: this.infra.map(({ id, position }) => ({ id, position })),
      queues: this.queues,
      hiddenQueues: this.hiddenQueues,
      pinned: this.pinned,
      edges: this.edges.map(({ id, source, target, type, data }) => ({ id, source, target, type, data })),
    });
  }

  /** Puts back a board held as text: its cards, cables and the cards beside them. */
  setContent(back: string): void {
    const { name, nodes, edges, infra, queues, hiddenQueues, pinned } = JSON.parse(back) as {
      name: string | null;
      nodes: CardNode[];
      edges: CableEdge[];
      infra: { id: string; position: Point }[];
      queues: Record<string, 'local'>;
      hiddenQueues: Record<string, true>;
      pinned: string[];
    };
    this.name = name;
    this.pinned = pinned;
    this.nodes = nodes;
    this.edges = edges;
    this.queues = queues;
    this.hiddenQueues = hiddenQueues;
    this.syncInfra(Object.fromEntries(infra.map(({ id, position }) => [id, position])));
    this.infra = this.infra.map(card => ({
      ...card,
      position: infra.find(one => one.id === card.id)?.position ?? card.position,
    }));
  }
  /** The name of the board on screen, one of the user's or the team's; null for one that is not kept yet. */
  name = $state<string | null>(null);
  /** The user's own boards, as they are stored. */
  own = $state.raw<StoredPreset[]>([]);
  /** The boards the stack carries for the team. */
  get team(): StoredPreset[] {
    return (this.#registry?.presets ?? []) as StoredPreset[];
  }
  /** Set when a board was just opened: once its cards have their sizes it is arranged, or only brought into view. */
  opened = $state<'arrange' | 'fit' | null>(null);
  #facts(): StackFacts {
    const app = (id: string) => this.app(id);
    return {
      known: id => !!app(id),
      cloned: id => !!app(id)?.cloned,
      name: id => app(id)?.name ?? id,
      canCall: (from, to) => !app(from)?.outside && !!app(to) && !app(to)?.outside && !!app(to)?.answers,
      runIn: id => (app(id)?.runIn ?? []).map(([value]) => value),
      platforms: id => (app(id)?.platforms ?? []).map(([value]) => value),
      // A list cut at its limit cannot say a branch is missing.
      branches: id => {
        const all = app(id)?.branches ?? [];
        return all.length && all.length < 300 ? all : null;
      },
    };
  }
  /** The board on screen as a board to keep: what runs and how, and the cables. */
  #asPreset(name: string): StoredPreset {
    return {
      name,
      version: PRESET_VERSION,
      nodes: Object.fromEntries(
        this.nodes.map(({ id, data }) => [
          id,
          {
            run: data.run,
            ...(data.platform && { platform: data.platform }),
            ...(data.branch && { branch: data.branch }),
            ...(data.note && { note: data.note }),
            ...(data.hideTunnels && { tunnels: false }),
            ...(data.showQueues && this.queuesOf(id).length > 0 && { queues: true }),
          },
        ]),
      ),
      edges: this.edges.map(({ source, target }) => ({ from: source, to: target })),
      ...(this.pinned.length && { outside: this.pinned }),
    };
  }
  /** Where the cards sit and which sides the cables use, kept with a board so it opens as it was left. */
  #layout() {
    const at = (cards: { id: string; position: Point }[]) =>
      Object.fromEntries(
        cards.map(({ id, position }): [string, Point] => [
          id,
          { x: Math.round(position.x), y: Math.round(position.y) },
        ]),
      );
    return {
      nodes: at(this.nodes),
      infra: at(this.infra),
      sides: Object.fromEntries(
        this.edges.map(({ id, data }) => [
          id,
          [
            data.fromSide,
            data.toSide,
            null,
            null,
            data.fromSlot ?? null,
            data.toSlot ?? null,
            data.points ?? null,
            data.fromShift ?? null,
            data.toShift ?? null,
          ],
        ]),
      ),
    };
  }
  /** Keeps the board on screen among the user's boards; a team board that is changed becomes their own copy. */
  #keep(): void {
    const put = (name: string) => {
      const now = { ...this.own.find(one => one.name === name), ...this.#asPreset(name), layout: this.#layout() };
      const next = this.own.some(one => one.name === name)
        ? this.own.map(one => (one.name === name ? now : one))
        : [...this.own, now];
      if (JSON.stringify(next) !== JSON.stringify(this.own)) this.own = next;
      if (this.name !== name) this.name = name;
    };
    if (this.own.some(one => one.name === this.name)) {
      put(this.name ?? '');
      return;
    }
    if (!this.nodes.length) return;
    // A board for one app alone is not kept; a second app makes it a board of the user's.
    if (this.scratch && this.nodes.length < 2) return;
    this.scratch = false;
    const team = this.team.find(one => one.name === this.name);
    // A team board stays the team's until it is changed; branches, notes and how apps run count as changes too.
    const told = (preset: { nodes: unknown; edges: { from: string; to: string }[] }) =>
      JSON.stringify([preset.nodes, preset.edges.map(edge => `${edge.from}>${edge.to}`).sort()]);
    const asOpened = team && check(team, this.#facts()).preset;
    if (team && asOpened && told(this.#asPreset(team.name) as never) === told(asOpened)) return;
    // One copy per team board: changing it again updates that copy.
    const copy =
      team && this.own.find(one => one.name === `${team.name} (local)` || one.name === `${team.name} (mine)`);
    const first = this.nodes[0]?.data.name ?? 'Untitled';
    const apps = this.nodes.length > 1 ? `${first} + ${String(this.nodes.length - 1)}` : first;
    put(copy?.name ?? this.uniqueName(team ? `${team.name} (local)` : this.name || apps));
  }
  /** A board name no board has yet. */
  uniqueName(base: string): string {
    const taken = new Set([...this.team, ...this.own].map(one => one.name));
    let name = base;
    for (let count = 2; taken.has(name); count++) name = `${base} (${String(count)})`;
    return name;
  }
  /** Boards deleted lately, newest first: they wait here to be restored. */
  trash = $state.raw<Deleted[]>([]);
  /** The boards opened lately, newest first. */
  recent = $state.raw<Opened[]>([]);
  /** Names the user's board on screen. Gives why it cannot be called that, when it cannot. */
  rename(to: string): string | null {
    const name = to.trim().slice(0, 80);
    const from = this.name;
    if (!this.own.some(one => one.name === from)) return 'Only a board of your own can be renamed.';
    if (!name) return 'Give the board a name first.';
    if (name === from) return null;
    if ([...this.team, ...this.own].some(one => one.name === name))
      return `A board is already called ${name}. Pick another name.`;
    this.own = this.own.map(one => (one.name === from ? { ...one, name } : one));
    this.name = name;
    return null;
  }
  /** Keeps the board on screen a second time, as a copy that is now the one on screen. */
  duplicate(): void {
    if (!this.nodes.length) return;
    this.#keep();
    const first = this.nodes[0]?.data.name ?? 'Untitled';
    const name = this.uniqueName(`${this.name ?? first} copy`);
    this.own = [...this.own, { ...this.#asPreset(name), layout: this.#layout() }];
    this.name = name;
  }
  /** Moves one of the user's boards to the recently deleted; the board on screen empties when it is that one. */
  deleteBoard(name: string): void {
    const gone = this.own.find(one => one.name === name);
    if (!gone) return;
    this.own = this.own.filter(one => one !== gone);
    this.trash = [{ ...gone, deleted: new Date().toISOString() }, ...this.trash].slice(0, 20);
    if (this.name === name) this.newBoard();
  }
  /** Brings a deleted board back among the user's, and onto an empty screen. */
  restore(gone: Deleted): void {
    const { deleted: _when, ...kept } = gone;
    const back = { ...kept, name: this.uniqueName(gone.name) } as StoredPreset;
    this.trash = this.trash.filter(one => one !== gone);
    this.own = [...this.own, back];
    if (!this.nodes.length) this.openBoard(back);
  }
  /**
   * Boards read from a file or a link: kept among the user's (in place of ones of the same name) and the first one
   * opened. One that cannot open is not kept either.
   */
  importBoards(
    data: unknown,
    source: string,
  ): { notes: string[]; name: string; error?: undefined } | { error: string } {
    const held = (data as { presets?: unknown } | null)?.presets;
    const all = Array.isArray(data) ? (data as unknown[]) : Array.isArray(held) ? (held as unknown[]) : [data];
    const read = all.map(one => migrate(one));
    const list = read.flatMap(one =>
      one.preset ? [{ ...one.preset, name: one.preset.name.trim().slice(0, 80), source }] : [],
    );
    const [first] = list;
    if (!first) return { error: read[0]?.error ?? 'No board found in it.' };
    const checked = check(first, this.#facts());
    if (checked.error !== undefined) return { error: checked.error };
    // One board per name: of two in the file, the later one.
    const named = [...new Map(list.map(one => [one.name, one])).values()];
    this.own = [...this.own.filter(one => !named.some(other => other.name === one.name)), ...named];
    const out = this.openBoard(first);
    return out.error === undefined ? { notes: out.notes, name: first.name } : out;
  }
  /** One of the user's boards as text for the stack's presets: what runs and the cables, without its places. */
  /** The board as a team board of the stack, placed as it is: the name, the apps and cables, and where they sit. */
  forTeam(preset: StoredPreset): StoredPreset {
    const { layout, outside } = preset;
    return {
      ...(JSON.parse(this.asShared(preset)) as StoredPreset),
      ...(layout ? { layout } : {}),
      ...(outside ? { outside } : {}),
    };
  }
  /** A board just kept among the stack's team boards, shown as one without loading the stack again. */
  keptForTeam(at: number, preset: StoredPreset): void {
    const presets = [...((this.#registry?.presets ?? []) as StoredPreset[])];
    presets[at] = preset;
    if (this.#registry) this.#registry = { ...this.#registry, presets: presets as Registry['presets'] };
  }
  asShared(preset: StoredPreset): string {
    const { name, nodes, edges } = preset;
    return JSON.stringify({ name, version: migrate(preset).preset?.version ?? PRESET_VERSION, nodes, edges }, null, 2);
  }

  /** The notes about this board the user dismissed. */
  dismissed = $state.raw<string[]>([]);
  /** A board for one app run alone: not kept while it holds only that app. */
  scratch = $state(false);
  /** One app on a board of its own. Gives the board that was on screen, to go back to. */
  alone(id: string): StoredPreset | undefined {
    const back = [...this.own, ...this.team].find(one => one.name === this.name);
    this.newBoard();
    this.scratch = true;
    this.add(id);
    this.opened = 'fit';
    return back;
  }
  /** A board to start from: empty, and named once it holds an app. */
  newBoard(): void {
    this.scratch = false;
    this.dismissed = [];
    this.name = null;
    this.nodes = [];
    this.edges = [];
    this.queues = {};
    this.hiddenQueues = {};
    this.pinned = [];
  }
  /**
   * Opens one of the boards, as this stack can run it now. Gives what had to change to fit, or why it cannot open;
   * then the board on screen is left as it is.
   */
  openBoard(given: StoredPreset): { notes: string[]; error?: undefined } | { error: string } {
    if (!Object.keys(given.nodes).length) {
      this.newBoard();
      this.name = given.name;
      return { notes: [] };
    }
    const checked = check(given, this.#facts());
    if (checked.error !== undefined) return { error: checked.error };
    const { preset, notes } = checked;
    const layout = (given['layout'] ?? {}) as {
      nodes?: Record<string, Partial<Point> | undefined>;
      infra?: Record<string, Point | undefined>;
      sides?: Record<string, unknown[] | undefined>;
    };
    const place = (id: string) => {
      const { x, y } = layout.nodes?.[id] ?? {};
      return typeof x === 'number' && typeof y === 'number' && Number.isFinite(x) && Number.isFinite(y)
        ? { x, y }
        : null;
    };
    const ids = Object.keys(preset.nodes);
    const placed = ids.every(place);
    this.scratch = false;
    this.dismissed = [];
    this.recent = [
      { name: preset.name, at: new Date().toISOString() },
      ...this.recent.filter(one => one.name !== preset.name),
    ].slice(0, 20);
    this.name = preset.name;
    this.queues = {};
    this.hiddenQueues = {};
    this.pinned = Array.isArray(given['outside'])
      ? (given['outside'] as unknown[]).filter((id): id is string => typeof id === 'string')
      : [];
    this.infra = this.infra.map(unselected);
    this.nodes = ids.flatMap(id => {
      const app = this.app(id);
      const node = preset.nodes[id];
      if (!app || !node) return [];
      const chosen = { ...node, hideTunnels: node.tunnels === false, showQueues: node.queues === true };
      return [this.#card(app, (placed && place(id)) || { x: 0, y: 0 }, chosen)];
    });
    const at = Object.fromEntries(this.nodes.map(({ id, position }) => [id, position]));
    const isSide = (side: unknown): side is Side => typeof side === 'string' && side in SIDES;
    const whole = (key: string, value: unknown) => (Number.isInteger(value) ? { [key]: value as number } : {});
    const finite = (key: string, value: unknown) =>
      typeof value === 'number' && Number.isFinite(value) ? { [key]: value } : {};
    this.edges = preset.edges.map(({ from, to }) => {
      const [fromSide, toSide, , , fromSlot, toSlot, points, fromShift, toShift] =
        layout.sides?.[`${from}>${to}`] ?? [];
      if (!placed || !isSide(fromSide) || !isSide(toSide))
        return cable(
          from,
          to,
          sidesFor(at, { from, to }, 'down', () => ({ w: 260, h: 160 })),
        );
      return cable(from, to, {
        fromSide,
        toSide,
        ...whole('fromSlot', fromSlot),
        ...whole('toSlot', toSlot),
        ...finite('fromShift', fromShift),
        ...finite('toShift', toShift),
        ...(Array.isArray(points) && { points: points as Point[] }),
      });
    });
    // The board before's tunnel and queue cards are not this one's: each goes where this board kept it, or beside its app.
    this.infra = [];
    this.syncInfra(placed ? (layout.infra ?? {}) : {});
    this.opened = placed ? 'fit' : 'arrange';
    return { notes };
  }

  /** Takes every card off the board. Undo brings them back. */
  clear(): void {
    this.nodes = [];
    this.edges = [];
  }

  /** Every app of the stack, as the side panel lists it. */
  apps = $state.raw<StackApp[]>([]);
  /** The stack's apps by id. */
  readonly #byId = $derived(new Map(this.apps.map(app => [app.id, app])));
  app = (id: string): StackApp | undefined => this.#byId.get(id);
  /** An app's name, or the id when the stack has no such app. */
  nameOf = (id: string): string => this.#byId.get(id)?.name ?? id;
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
        ...(chosen.hideTunnels === true && { hideTunnels: true }),
        ...(chosen.showQueues === true && { showQueues: true }),
        ...((chosen.changes === 'take-along' || chosen.changes === 'set-aside') && { changes: chosen.changes }),
        ...(Array.isArray(chosen.libraries) && {
          libraries: chosen.libraries.filter(name => typeof name === 'string'),
        }),
        branch: chosen.branch ?? '',
        run: run ?? 'cli',
        ...(platform && { platform }),
        note: chosen.note ?? '',
      },
    };
  }

  /** Puts the board the server kept on screen: the stack's apps where they were left, and their cables. */
  /** The stack read again after it changed (Settings saved), in place: the page, and full screen, stay. */
  async reload(): Promise<void> {
    this.commit();
    await save(this.saved());
    const loaded = await load();
    if (loaded) this.open(loaded);
  }
  open({ stack, clones, roots, saved }: Loaded): void {
    this.#registry = stack;
    this.#guarded = stack.envs.filter(env => isProtected(stack, env));
    this.stack = stack.name ?? '';
    this.dir = (stack.source ?? '').replace(/\/stack\.json$/, '');
    this.setup = !!stack.setup;
    this.known = (stack as { stacks?: KnownStack[] }).stacks ?? [];
    this.envs = stack.envs;
    this.env = saved?.env ?? stack.envs[0] ?? '';
    this.roots = roots;
    this.apps = Object.entries(stack.apps).map(([id, app]) => ({
      id,
      name: app.name,
      kind: app.kind,
      kindLabel: kindOf(app, stack).label,
      slug: app.slug ?? '',
      cloned: !!clones[id],
      calls: [...new Set([...Object.keys(app.consumes ?? {}), ...Object.keys(stack.found?.[id] ?? {})])],
      known: Object.keys(app.consumes ?? {}),
      answers:
        kindOf(app, stack).serves ||
        Object.entries(stack.apps).some(
          ([from, other]) => from !== id && (other.consumes?.[id] ?? stack.found?.[from]?.[id]),
        ),
      serves: !!app.url,
      runIn: kindOf(app, stack).runIn,
      platforms: kindOf(app, stack).platforms ?? [],
      current: clones[id]?.branch ?? '',
      branches: clones[id]?.branches ?? [],
      dirty: clones[id]?.dirty ?? 0,
      libraries: (clones[id]?.libraries ?? []).map(({ name, path }) => ({ name, path })),
      ...(app.outside && { outside: typeof app.outside === 'string' ? app.outside : 'an outside system' }),
    }));
    this.nodes = this.apps.flatMap(app => {
      const at = saved?.nodes?.[app.id];
      return at ? [this.#card(app, { x: at.x, y: at.y }, at)] : [];
    });
    this.fullHeights = Object.fromEntries(
      Object.entries(saved?.nodes ?? {}).flatMap(([id, at]) =>
        typeof at?.['full'] === 'number' && at['full'] > 0 ? [[id, at['full']]] : [],
      ),
    );
    const onBoard = new Set(this.nodes.map(({ id }) => id));
    this.edges = (saved?.edges ?? [])
      .filter(({ from, to }) => onBoard.has(from) && onBoard.has(to))
      .map(({ from, to, fromSide, toSide, ...kept }) =>
        cable(from, to, { fromSide: fromSide ?? 'right', toSide: toSide ?? 'left', ...kept }),
      );
    this.#kept = saved ?? {};
    this.name = typeof saved?.['preset'] === 'string' ? saved['preset'] : null;
    this.own = (Array.isArray(saved?.['presets']) ? saved['presets'] : []) as StoredPreset[];
    this.scratch = saved?.['scratch'] === true;
    this.dismissed = (Array.isArray(saved?.['dismissed']) ? saved['dismissed'] : []) as string[];
    this.trash = (Array.isArray(saved?.['trash']) ? saved['trash'] : []) as Deleted[];
    this.recent = (Array.isArray(saved?.['recent']) ? saved['recent'] : []) as Opened[];
    this.infra = [];
    this.queues = (saved?.['queues'] ?? {}) as Record<string, 'local'>;
    this.hiddenQueues = (saved?.['hiddenQueues'] ?? {}) as Record<string, true>;
    this.pinned = (Array.isArray(saved?.['outside']) ? saved['outside'] : []) as string[];
    this.syncInfra((saved?.infra ?? {}) as Record<string, Point | undefined>);
    const { zoom, pan } = saved ?? {};
    this.view = zoom && pan ? { x: pan.x, y: pan.y, zoom } : undefined;
  }

  /** Keeps the board on screen among the user's boards (a changed team board becomes their copy), before it is saved. */
  commit(): void {
    // Mid-drag the board is not kept yet: letting go is the change.
    if (!this.live && !this.nodes.some(node => node.dragging)) this.#keep();
  }
  /** Everything the saved board is made of, read to hear of a change without putting the board together. */
  get changes(): readonly unknown[] {
    return [
      this.#registry,
      this.live,
      this.env,
      this.name,
      this.scratch,
      this.view,
      this.nodes,
      this.edges,
      this.infra,
      this.own,
      this.trash,
      this.recent,
      this.dismissed,
      this.fullHeights,
      this.queues,
      this.hiddenQueues,
      this.pinned,
    ];
  }
  /** The board as the server keeps it: what is on screen, over everything it kept that the canvas does not show yet. */
  saved(): SavedBoard {
    // Cards change size in Live, which nudges the cards stacked under them: what is kept is the board as Edit left it.
    if (this.live) return { ...this.#keptEdit, env: this.env };
    const before = this.#kept.nodes ?? {};
    return {
      mode: 'auto',
      ...this.#kept,
      preset: this.name,
      presets: this.own,
      trash: this.trash,
      recent: this.recent,
      scratch: this.scratch || undefined,
      dismissed: this.dismissed.length ? this.dismissed : undefined,
      env: this.env,
      ...(this.view && { zoom: this.view.zoom, pan: { x: this.view.x, y: this.view.y } }),
      nodes: Object.fromEntries(
        this.nodes.map(
          ({ id, position, data: { branch, run, platform, note, hideTunnels, showQueues, changes, libraries } }) => [
            id,
            {
              ...before[id],
              x: Math.round(position.x),
              y: Math.round(position.y),
              branch,
              run,
              ...(platform && { platform }),
              note,
              hideTunnels: hideTunnels ? true : undefined,
              showQueues: showQueues ? true : undefined,
              changes,
              libraries: libraries?.length ? libraries : undefined,
              full: this.fullHeights[id],
            },
          ],
        ),
      ),
      edges: this.edges.map(({ source, target, data }) => ({ from: source, to: target, ...data })),
      queues: this.queues,
      hiddenQueues: this.hiddenQueues,
      outside: this.pinned.length ? this.pinned : undefined,
      infra: Object.fromEntries(
        this.infra.map(({ id, position }) => [id, { x: Math.round(position.x), y: Math.round(position.y) }]),
      ),
    };
  }

  /** Puts an app on the board: where it is dropped, its header under the pointer, or else in the first empty spot of what is on screen, scanning rows from the top left. */
  add(id: string, dropped?: Point): void {
    const app = this.app(id);
    if (!app || app.outside || !app.cloned || this.nodes.some(node => node.id === id)) return;
    if (dropped) {
      const at = this.toFlow(dropped);
      this.#addOnly(this.#card(app, this.stored({ x: at.x - PLACE.w / 2, y: at.y - 22 })));
      return;
    }
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
    // In line with the cards already there and a gap after one, before the rest of the screen.
    const grid = (start: number, end: number, size: number) =>
      Array.from(
        { length: Math.max(0, Math.floor((end - size - start - 40) / 40) + 1) },
        (_, at) => start + 40 + at * 40,
      );
    const rows = [...new Set([...taken.map(box => box.y), ...grid(from.y, to.y, PLACE.h)])].filter(
      y => y >= from.y && y + PLACE.h <= to.y,
    );
    const columns = [...new Set([...taken.map(box => box.x + box.w + PLACE.gap), ...grid(from.x, to.x, PLACE.w)])]
      .filter(x => x >= from.x && x + PLACE.w <= to.x)
      .sort((a, b) => a - b);
    let spot: Point | undefined;
    for (const y of rows) {
      spot = columns.filter(x => free(x, y)).map(x => ({ x, y }))[0];
      if (spot) break;
    }
    const step = this.nodes.length * 32;
    this.#addOnly(this.#card(app, this.stored(spot ?? { x: from.x + 48 + step, y: from.y + 48 + step })));
  }
  /** Selects this card alone, app or tunnel, so a drag moves only it. */
  pick(id: string): void {
    const only = <T extends { id: string; selected?: boolean }>(one: T): T =>
      !!one.selected === (one.id === id) ? one : { ...one, selected: one.id === id };
    this.infra = this.infra.map(only);
    this.edges = this.edges.map(unselected);
    this.nodes = this.nodes.map(only);
  }
  /** A card joins the board as the only one selected, so what was selected before is not dragged along with it. */
  #addOnly(card: CardNode): void {
    this.infra = this.infra.map(unselected);
    this.edges = this.edges.map(unselected);
    this.nodes = [...this.nodes.map(unselected), { ...card, selected: true }];
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
    const app = (which: string) => this.app(which);
    const others = this.cards.flatMap(node => (node.id === id ? [] : (app(node.id) ?? [])));
    const wired = others.filter(other => this.edges.some(edge => edge.id === `${id}>${other.id}`));
    const free = others.filter(other => !wired.includes(other));
    const known = free.filter(other => app(id)?.calls.includes(other.id));
    const may = free.filter(other => !other.outside && other.answers && !other.calls.includes(id));
    return { can: known.length ? known : may, wired };
  }

  /** On a board with other apps, but cabled to none of them. */
  uncabled(id: string): boolean {
    return this.cards.length > 1 && !this.edges.some(edge => edge.source === id || edge.target === id);
  }

  /** A cable between two cards, on the sides that face each other. */
  connect(from: string, to: string): void {
    const size = (id: string) => this.boxes.get(id) ?? { w: 260, h: 160 };
    // From the cards themselves: one added a moment ago has a place before it has a size.
    const at = Object.fromEntries(this.nodes.map(({ id, position }) => [id, position]));
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

  /** A change made from the terminal: on the board on screen as if made here, on another board where it is kept. Gives whether anything changed. */
  edit(name: string, change: BoardEdit, create = false): boolean {
    if (this.name !== name) {
      const stored =
        this.own.find(one => one.name === name) ??
        this.team.find(one => one.name === name) ??
        (create ? { name, version: PRESET_VERSION, nodes: {}, edges: [] } : undefined);
      if (!stored) return false;
      const changed = { ...editPreset(stored, change), name };
      if (JSON.stringify(changed) === JSON.stringify(stored)) return false;
      const mine = this.own.some(one => one.name === name);
      this.own = mine ? this.own.map(one => (one.name === name ? changed : one)) : [...this.own, changed];
      return true;
    }
    const before = this.content();
    const on = (id: string) => this.cards.some(node => node.id === id);
    for (const id of change.remove ?? []) this.remove(id);
    for (const id of change.add ?? []) this.add(id);
    for (const [id, branch] of Object.entries(change.branch ?? {})) this.set(id, { branch });
    for (const [id, note] of Object.entries(change.note ?? {})) this.set(id, { note });
    for (const { from, to } of change.uncable ?? []) this.cut(from, to);
    for (const { from, to } of change.cable ?? [])
      if (on(from) && on(to) && !this.edges.some(edge => edge.id === `${from}>${to}`)) this.connect(from, to);
    // Laid out once the cards have their sizes, as a board opened with no places is.
    if (change.arrange) this.opened = 'arrange';
    return this.content() !== before || !!change.arrange;
  }

  #arranged = { key: '', version: 0 };
  /**
   * Arrange: places the cards, picks each cable's sides and its order along them, and drops the waypoints.
   * Pressed again on the board as it left it, it gives the next of its layouts.
   */
  arrange(card = (id: string): Size => this.boxes.get(id) ?? { w: 260, h: 160 }): void {
    const key = () => JSON.stringify(this.nodes.map(({ id, position }) => [id, position.x, position.y]));
    const was = key();
    let version = was === this.#arranged.key ? this.#arranged.version + 1 : 0;
    // A layout that leaves every card where it is goes on to the next one.
    for (let tries = 0; tries < LAYOUTS.length; tries++, version++) {
      const [dir, mirror] = LAYOUTS[version % LAYOUTS.length] ?? LAYOUTS[0];
      this.#place(card, dir, mirror);
      if (key() !== was) break;
    }
    this.#arranged = { key: key(), version };
  }

  #place(card: (id: string) => Size, dir: 'down' | 'right', mirror: boolean): void {
    const links = this.cables.map(({ from, to }) => ({ from, to }));
    // An app is given the room of its tunnel cards too: top-down beside it when it calls others, else under it.
    const size = (id: string) => {
      const led = this.ledBy(id)
        .filter(key => this.ownedBy(id).includes(key))
        .map(key => this.infraBoxes.get(key) ?? TUNNEL);
      const { w, h } = card(id);
      if (!led.length) return { w, h };
      const tall = led.reduce((sum, box) => sum + box.h + TUNNEL.gap / 2, 0);
      const wide = Math.max(...led.map(box => box.w));
      return dir === 'down' && links.some(link => link.from === id)
        ? { w: w + TUNNEL.gap + wide, h: Math.max(h, tall) }
        : { w: Math.max(w, wide), h: h + tall };
    };
    // Queues and outside systems take their place in the flow: who sends, the queue, who reads; who calls out.
    // An app's own queues stay in its stack, as its tunnels do.
    const owned = new Set(this.nodes.flatMap(node => this.ownedBy(node.id)));
    const joined = this.infra.filter(one => one.type !== 'tunnel' && !owned.has(one.id)).map(one => one.id);
    const onBoard = (id: string) => joined.includes(id) || this.cards.some(node => node.id === id);
    const flows = this.flows.filter(({ from, to }) => onBoard(from) && onBoard(to));
    const placed = arrange(
      [...this.nodes.map(node => node.id), ...joined],
      [...links, ...flows],
      id => (joined.includes(id) ? (this.infraBoxes.get(id) ?? { w: 220, h: 70 }) : size(id)),
      dir,
      mirror,
      { pad: PAD },
    );
    const cables: Cable[] = links.map(link => ({ ...link, ...sidesFor(placed, link, dir, card) }));
    orderSlots(cables, id => ({ ...(placed[id] ?? { x: 0, y: 0 }), ...card(id) }));
    this.nodes = this.nodes.map(node => ({ ...node, position: placed[node.id] ?? node.position }));
    this.edges = cables.map(({ from, to, ...data }) => cable(from, to, data));
    let cards: InfraNode[] = this.infra.map(one => {
      const at = placed[one.id];
      return at ? { ...one, position: at } : one;
    });
    for (const node of this.nodes) cards = this.#beside(node.id, cards, card(node.id), true);
    this.infra = cards;
  }
}

export const board = new Board();
