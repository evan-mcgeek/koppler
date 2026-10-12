// The board: cards and cables as Svelte Flow holds them, and the socket behaviour on top (drawing a cable through
// waypoints, sliding an end along its side). The geometry is core/cables and core/arrange, unchanged.
import type { Edge, Node } from '@xyflow/svelte';
import { arrange, sidesFor, type Point, type Side } from '../src/core/arrange.ts';
import { endOffsets, orderSlots, sidePoint, SIDES, type Box, type Cable } from '../src/core/cables.ts';
import { of as kindOf } from '../src/core/kinds.ts';
import { isProtected, LOCAL_QUEUE_TYPES, queuesOf } from '../src/core/plan.ts';
import { planTunnels, tunnelKind, type Tunnel } from '../src/core/ports.ts';
import type { Registry } from '../src/data.ts';
import type { Loaded, SavedBoard } from './data.ts';
import { toasts } from './toast.svelte.ts';

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
  /** What happens to the clone's uncommitted changes when another branch runs; set aside unless chosen. */
  changes?: Changes;
  /** The libraries it runs with the local copy of, by name. */
  libraries?: string[];
}
export type Changes = 'set-aside' | 'take-along';
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
  drop = $state.raw<{ id: string; ok: boolean } | null>(null);
  /** The cable under the pointer: a click unplugs it. */
  hovered = $state.raw<string | null>(null);
  /** A protected environment (production, usually): local code runs against its real data. */
  #guarded = $state.raw<string[]>([]);
  protected = $derived(this.#guarded.includes(this.env));
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
  /** Tunnel cards, kept apart from the app cards: the flow shows both. */
  infra = $state.raw<InfraNode[]>([]);
  /** The queues run locally instead of the deployed ones, and the queues taken off the board. */
  queues = $state.raw<Record<string, 'local'>>({});
  hiddenQueues = $state.raw<Record<string, true>>({});
  infraBoxes = $derived(
    new Map<string, Box>(
      this.infra.map(({ id, position, measured }) => [
        id,
        { ...position, w: measured?.width ?? TUNNEL.w, h: measured?.height ?? TUNNEL.h },
      ]),
    ),
  );
  #registry: Registry | undefined;
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
    const shown = this.nodes.filter(node => !node.data.hideTunnels);
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
    const taken = this.nodes.flatMap(({ id }) => {
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
  #onBoard = $derived(new Set(this.nodes.map(node => node.id)));
  #outside(id: string): boolean {
    return !!this.#registry?.apps[id]?.outside;
  }
  /** The queues of the stack that an app on the board publishes to or reads, with who uses each. */
  boardQueues = $derived.by(() => {
    const apps = this.#registry?.apps ?? {};
    return Object.entries(this.#registry?.queues ?? {}).flatMap(([id, queue]) => {
      const users = (how: 'publishes' | 'reads') =>
        Object.keys(apps).filter(
          app => Object.hasOwn(apps[app]?.[how] ?? {}, id) && (this.#onBoard.has(app) || this.#outside(app)),
        );
      const [pubs, reads] = [users('publishes'), users('reads')];
      const shown = !this.hiddenQueues[id] && [...pubs, ...reads].some(app => this.#onBoard.has(app));
      return shown ? [{ id, queue, pubs, reads }] : [];
    });
  });
  #leadOf(queue: { pubs: string[]; reads: string[] }): string | undefined {
    return [...queue.pubs, ...queue.reads].find(app => this.#onBoard.has(app));
  }
  queueName(id: string): string {
    return this.#registry?.queues?.[id]?.name ?? id;
  }
  /**
   * An app whose stack entry has no sign-in, tunnel or hosts entry of its own for this environment while the first
   * environment has one: it would run on another environment's.
   */
  /** A branch other than the clone's is asked for while the clone has uncommitted changes. */
  switchesOver(id: string): boolean {
    const branch = this.nodes.find(node => node.id === id)?.data.branch;
    const app = this.apps.find(one => one.id === id);
    return !!(branch && app?.current && branch !== app.current && app.dirty);
  }

  /** The libraries a card runs with the local copy of, among the ones cloned here. */
  localLibraries(id: string): string[] {
    const chosen = this.nodes.find(node => node.id === id)?.data.libraries ?? [];
    const here = this.apps.find(one => one.id === id)?.libraries ?? [];
    return chosen.filter(name => here.some(library => library.name === name));
  }

  borrowsTunnels(id: string): boolean {
    if (this.env === this.envs[0]) return false;
    const app = this.#registry?.apps[id];
    const own = app?.envs?.[this.env]?.prereqs ?? [];
    const hidden = this.nodes.find(node => node.id === id)?.data.hideTunnels;
    return (['sso', 'tunnel', 'hosts'] as const).some(
      kind =>
        (app?.prereqs ?? []).some(need => need[kind]) && !own.some(need => need[kind]) && !(kind !== 'sso' && hidden),
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
      ...this.nodes.flatMap(({ id }) =>
        Object.keys(this.#registry?.apps[id]?.consumes ?? {})
          .filter(app => this.#outside(app))
          .map(app => ({ from: id, to: `outside:${app}` })),
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
    const called = this.apps.find(app => app.id === id)?.calls ?? [];
    return called.flatMap(to => {
      const app = this.apps.find(one => one.id === to);
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
  #beside(id: string, cards: InfraNode[]): InfraNode[] {
    const app = this.nodes.find(node => node.id === id);
    const led = new Set(this.ledBy(id));
    if (!app || !led.size) return cards;
    const box = { ...app.position, ...(this.boxes.get(id) ?? { w: 260, h: 200 }) };
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
          shares: shares ? `Shared with ${env}'s reader` : '',
          about: [
            one.queue.envs?.[this.env]?.queue ?? one.queue.queue ?? one.id,
            shares
              ? `Your local ${shares} reads the ${env} queue, so it takes messages the deployed reader would get.`
              : '',
          ].filter(Boolean),
        },
      };
    });
    const linked = [...new Set(this.flows.flatMap(flow => [flow.from, flow.to]))].filter(key =>
      key.startsWith('outside:'),
    );
    const outside = linked.map((id): OutsideNode => {
      const app = this.#registry?.apps[id.slice(8)];
      const kept = before.get(id);
      const own = this.env === this.envs[0] ? undefined : app?.envs?.[this.env]?.deployedUrl;
      const address = typeof own === 'string' ? own : (app?.deployedUrl ?? '');
      const host = URL.canParse(address) ? new URL(address).hostname : '';
      const why = typeof app?.outside === 'string' ? `: ${app.outside}` : '';
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
  #nextTo(id: string, cards: InfraNode[]): Point {
    const size = TUNNEL;
    const box = (key: string): Box | undefined => {
      const card = cards.find(one => one.id === key && (one.id === id || one.position.x || one.position.y));
      const app = this.nodes.find(node => node.id === key);
      return card
        ? { ...card.position, ...(this.infraBoxes.get(key) ?? size) }
        : app && { ...app.position, ...(this.boxes.get(key) ?? { w: 260, h: 200 }) };
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
  followed(id: string, by: Point, cards: InfraNode[]): InfraNode[] {
    const led = new Set(this.ledBy(id));
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
    const app = (id: string) => this.apps.find(one => one.id === id);
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
        const wired = this.edges.some(edge => edge.id === `${onto.id}>${from}`);
        toasts.show(
          `In the code ${callee} calls ${caller}, not the other way round.${wired ? ' That cable is already on the board.' : ''}`,
          'warning',
          wired
            ? undefined
            : {
                label: 'Connect that way',
                run: () => {
                  this.connect(onto.id, from);
                },
              },
        );
        return;
      }
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
    if (ev.button !== 0 || !pressed || this.live) return;
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
    this.#keptEdit = this.saved();
    this.#edit = this.content();
    this.live = true;
  }
  /** Back to the board as it was left in Edit. */
  goEdit(): void {
    if (!this.live) return;
    this.#apply(this.#edit);
    this.live = false;
  }

  /** Whether there is a step to go back to, or forward to again. */
  canUndo = $state(false);
  canRedo = $state(false);
  #past: string[] = [];
  #future: string[] = [];
  #now = '';
  #at = 0;

  /** The cards and cables as one text: a step of the undo history. */
  content(): string {
    return JSON.stringify({
      nodes: this.nodes.map(({ id, type, position, data }) => ({ id, type, position, data })),
      infra: this.infra.map(({ id, position }) => ({ id, position })),
      queues: this.queues,
      hiddenQueues: this.hiddenQueues,
      edges: this.edges.map(({ id, source, target, type, data }) => ({ id, source, target, type, data })),
    });
  }

  /** Notes a change to the board. Changes less than 0.7 seconds apart, a drag for one, are one step to undo. */
  record(): void {
    if (this.live) return;
    const now = this.content();
    if (now === this.#now) return;
    if (this.#now && Date.now() - this.#at > 700) this.#past.push(this.#now);
    if (this.#now) this.#future = [];
    this.#now = now;
    this.#at = Date.now();
    this.canUndo = this.#past.length > 0;
    this.canRedo = false;
  }

  /** Takes the board as it is now as the current step, without a step to undo. */
  adopt(): void {
    if (!this.live) this.#now = this.content();
  }

  #step(from: string[], to: string[]): void {
    const back = from.pop();
    if (back === undefined) return;
    to.push(this.#now);
    this.#now = back;
    // The next change is a step of its own.
    this.#at = 0;
    this.#apply(back);
    this.canUndo = this.#past.length > 0;
    this.canRedo = this.#future.length > 0;
  }
  /** Puts back a board held as text: its cards, cables and the cards beside them. */
  #apply(back: string): void {
    const { nodes, edges, infra, queues, hiddenQueues } = JSON.parse(back) as {
      nodes: CardNode[];
      edges: CableEdge[];
      infra: { id: string; position: Point }[];
      queues: Record<string, 'local'>;
      hiddenQueues: Record<string, true>;
    };
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
  undo(): void {
    this.#step(this.#past, this.#future);
  }
  redo(): void {
    this.#step(this.#future, this.#past);
  }

  /** Takes every card off the board. Undo brings them back. */
  clear(): void {
    this.nodes = [];
    this.edges = [];
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
        ...(chosen.hideTunnels === true && { hideTunnels: true }),
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
  open({ stack, clones, roots, saved }: Loaded): void {
    this.#registry = stack;
    this.#guarded = stack.envs.filter(env => isProtected(stack, env));
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
      known: Object.keys(app.consumes ?? {}),
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
      libraries: (clones[id]?.libraries ?? []).map(({ name, path }) => ({ name, path })),
      ...(app.outside && { outside: typeof app.outside === 'string' ? app.outside : 'an outside system' }),
    }));
    this.nodes = this.apps.flatMap(app => {
      const at = saved?.nodes?.[app.id];
      return at ? [this.#card(app, { x: at.x, y: at.y }, at)] : [];
    });
    const onBoard = new Set(this.nodes.map(({ id }) => id));
    this.edges = (saved?.edges ?? [])
      .filter(({ from, to }) => onBoard.has(from) && onBoard.has(to))
      .map(({ from, to, fromSide, toSide, ...kept }) =>
        cable(from, to, { fromSide: fromSide ?? 'right', toSide: toSide ?? 'left', ...kept }),
      );
    this.#kept = saved ?? {};
    this.infra = [];
    this.queues = (saved?.['queues'] ?? {}) as Record<string, 'local'>;
    this.hiddenQueues = (saved?.['hiddenQueues'] ?? {}) as Record<string, true>;
    this.syncInfra((saved?.infra ?? {}) as Record<string, Point | undefined>);
    const { zoom, pan } = saved ?? {};
    this.view = zoom && pan ? { x: pan.x, y: pan.y, zoom } : undefined;
  }

  /** The board as the server keeps it: what is on screen, over everything it kept that the canvas does not show yet. */
  saved(): SavedBoard {
    // Cards change size in Live, which nudges the cards stacked under them: what is kept is the board as Edit left it.
    if (this.live) return { ...this.#keptEdit, env: this.env };
    const before = this.#kept.nodes ?? {};
    return {
      mode: 'auto',
      ...this.#kept,
      env: this.env,
      ...(this.view && { zoom: this.view.zoom, pan: { x: this.view.x, y: this.view.y } }),
      nodes: Object.fromEntries(
        this.nodes.map(({ id, position, data: { branch, run, platform, note, hideTunnels, changes, libraries } }) => [
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
            changes,
            libraries: libraries?.length ? libraries : undefined,
          },
        ]),
      ),
      edges: this.edges.map(({ source, target, data }) => ({ from: source, to: target, ...data })),
      queues: this.queues,
      hiddenQueues: this.hiddenQueues,
      infra: Object.fromEntries(
        this.infra.map(({ id, position }) => [id, { x: Math.round(position.x), y: Math.round(position.y) }]),
      ),
    };
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

  /** Arrange: places the cards, picks each cable's sides and its order along them, and drops the waypoints. */
  arrange(): void {
    const links = this.cables.map(({ from, to }) => ({ from, to }));
    const card = (id: string) => this.boxes.get(id) ?? { w: 260, h: 160 };
    // An app is given the room of its tunnel cards too: beside it when it calls others, else under it.
    const size = (id: string) => {
      const led = this.ledBy(id).map(key => this.infraBoxes.get(key) ?? TUNNEL);
      const { w, h } = card(id);
      if (!led.length) return { w, h };
      const tall = led.reduce((sum, box) => sum + box.h + TUNNEL.gap / 2, 0);
      return links.some(link => link.from === id)
        ? { w: w + TUNNEL.gap + Math.max(...led.map(box => box.w)), h: Math.max(h, tall) }
        : { w, h: h + tall };
    };
    const placed = arrange(
      this.nodes.map(node => node.id),
      links,
      size,
      'down',
      false,
      { pad: PAD },
    );
    const cables: Cable[] = links.map(link => ({ ...link, ...sidesFor(placed, link, 'down', card) }));
    orderSlots(cables, id => ({ ...(placed[id] ?? { x: 0, y: 0 }), ...card(id) }));
    this.nodes = this.nodes.map(node => ({ ...node, position: placed[node.id] ?? node.position }));
    this.edges = cables.map(({ from, to, ...data }) => cable(from, to, data));
    let cards = this.infra;
    for (const node of this.nodes) cards = this.#beside(node.id, cards);
    this.infra = cards;
  }
}

export const board = new Board();
