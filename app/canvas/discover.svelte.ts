// Discover: the map of the board's apps and what they touch, from the stack's facts. Nothing on it runs or changes the
// board; it keeps only which cards were opened and where its cards sit, per board.
import type { Point } from '../src/core/arrange.ts';
import { DIRECTIONS, type Direction, type Laid } from '../src/core/layout.ts';
import { deadEnds, linksOf, mapOf, type Card, type Link } from '../src/core/discover.ts';
import {
  editFeature,
  featureCards,
  numbered,
  proposedCard,
  stackPath,
  type FeatureEdit,
  type Numbered,
} from '../src/core/feature.ts';
import { board } from './board.svelte.ts';
import { post } from './data.ts';
import { runs } from './run.svelte.ts';
import { toasts } from './toast.svelte.ts';

/** What a card on the map says: its name, kind, and where its code is or what it is. */
export interface LeanData extends Record<string, unknown> {
  name: string;
  tag: string;
  meta: string;
  /** An app cloned on this Mac. */
  cloned: boolean;
  onBoard: boolean;
  hidden: number;
  /** An app that can run here. */
  app: boolean;
  /** On a feature board, proposed by the agent and not accepted yet. */
  proposed: boolean;
  /** The repo it is a piece of, when that repo holds another app of the stack too. */
  repo: string;
  /** A queue sent to that nothing reads or passes on. */
  deadEnd: boolean;
}

export const CARD = { w: 200, h: 64 };
/** A link's name on the map: who, to whom, how. */
export const linkKey = (link: Link) => `${link.from}>${link.to}>${link.kind}`;
const QUEUE_TAGS: Record<string, [string, string]> = {
  sqs: ['SQS', 'Queue'],
  sns: ['SNS', 'Topic'],
  eventbridge: ['BUS', 'Bus'],
  kafka: ['KAFKA', 'Topic'],
};

const RESOURCE_TAGS: Record<string, string> = { s3: 'S3', apigw: 'APIGW', sfn: 'SFN' };
const counted = (n: number, one: string) => `${String(n)} ${one}${n === 1 ? '' : 's'}`;

class Discovered {
  /** The map: the board's apps, what they touch, and what was brought in from each opened card. */
  /** The board's own cards: its apps, and the outside systems put on it by hand. */
  #own = $derived([...board.nodes.map(node => node.id), ...board.pinned]);
  map = $derived.by(() => {
    const facts = board.facts;
    if (!facts) return { cards: [], links: [] as Link[] };
    const feature = board.feature;
    if (!feature) return mapOf(facts, this.#own, board.discover.open);
    const shown = mapOf(facts, [...featureCards(feature), ...this.#own], board.discover.open, false);
    // A step the stack has no link for yet is drawn as found, until it is accepted and recorded.
    const missing = numbered(feature)
      .map(({ step }) => step)
      .filter(step => !shown.links.some(link => link.from === step.from && link.to === step.to))
      .map((step): Link => ({ from: step.from, to: step.to, kind: step.kind, sure: 'found' }));
    return { cards: shown.cards, links: [...shown.links, ...missing] };
  });
  /** The feature's steps, numbered, by link: `from>to`. */
  steps = $derived(
    new Map(board.feature ? numbered(board.feature).map(one => [`${one.step.from}>${one.step.to}`, one]) : []),
  );
  stepOf(link: { from: Card; to: Card }): Numbered | undefined {
    return this.steps.get(`${link.from}>${link.to}`);
  }
  /** The phase picked in the feature's panel: the others dim. */
  phase = $state<number | null>(null);
  /** The last card picked, whose links the panel lists. */
  last = $state<Card | null>(null);
  picked = $state<Card[]>([]);
  /** Each card's height as drawn: a long name makes a card taller. */
  heights = $state<Record<Card, number>>({});

  #dead = $derived(board.facts ? deadEnds(board.facts) : new Set<Card>());
  /** How many of the stack's apps each repo holds. */
  #perRepo = $derived(
    Object.values(board.facts?.apps ?? {}).reduce<Record<string, number>>((count, app) => {
      const slug = app.slug?.toLowerCase();
      if (slug) count[slug] = (count[slug] ?? 0) + 1;
      return count;
    }, {}),
  );
  /** What a card shows. */
  data(card: Card, onBoard: boolean, hidden: number): LeanData {
    const facts = board.facts;
    const proposed = !!board.feature && proposedCard(board.feature, card);
    const slug = facts?.apps[card]?.slug ?? '';
    const repo = (this.#perRepo[slug.toLowerCase()] ?? 0) > 1 ? (slug.split('/').pop() ?? '') : '';
    const base = { onBoard, hidden, cloned: false, app: false, proposed, deadEnd: this.#dead.has(card), repo };
    if (card.startsWith('queue:')) {
      const queue = facts?.queues?.[card.slice(6)];
      const [tag, meta] = QUEUE_TAGS[queue?.type ?? ''] ?? ['QUEUE', 'Queue'];
      return { ...base, name: queue?.name ?? card.slice(6), tag, meta };
    }
    if (card.startsWith('resource:')) {
      const resource = facts?.resources?.[card.slice(9)];
      const meta =
        resource?.type === 'apigw'
          ? counted(Object.keys(resource.routes ?? {}).length, 'route')
          : resource?.type === 'sfn'
            ? counted(resource.steps?.length ?? 0, 'step')
            : 'Bucket';
      return { ...base, name: resource?.name ?? card.slice(9), tag: RESOURCE_TAGS[resource?.type ?? ''] ?? '', meta };
    }
    if (card.startsWith('database:')) {
      const id = card.slice(9);
      const kind = facts?.databases?.[id]?.kind ?? '';
      return {
        ...base,
        name: board.databaseName(id),
        tag: 'DB',
        meta: kind.charAt(0).toUpperCase() + kind.slice(1),
      };
    }
    const stack = facts?.apps[card];
    const app = board.app(card);
    if (stack?.outside)
      return {
        ...base,
        name: stack.name,
        tag: 'OUTSIDE',
        meta: typeof stack.outside === 'string' ? stack.outside : 'Outside system',
      };
    return {
      ...base,
      name: stack?.name ?? card,
      tag: app?.kindLabel ?? stack?.kind ?? '',
      meta: app?.cloned ? '' : 'On GitHub',
      cloned: !!app?.cloned,
      app: !!app?.cloned,
    };
  }

  /** The layout Arrange last chose. */
  get direction(): Direction {
    return DIRECTIONS[(board.discover.layout ?? 0) % DIRECTIONS.length] ?? 'RIGHT';
  }
  /** What the map's layout is worked out from: its cards as measured, its links, the layout chosen. */
  layoutInput = $derived.by(() => {
    const cards = this.map.cards.map(({ card }) => ({ id: card, w: CARD.w, h: this.heights[card] ?? CARD.h }));
    const links = this.map.links.map(link => ({ id: linkKey(link), from: link.from, to: link.to }));
    // Laid out once every card has its height, so the cards are placed once.
    const measured = this.map.cards.every(({ card }) => this.heights[card]);
    return { cards, links, measured, key: JSON.stringify([cards, links, this.direction]) };
  });
  /** That layout once worked out, for the input it was worked out from. */
  laid = $state.raw<(Laid & { key: string }) | null>(null);
  /** The layout for the map as it is now, if it is worked out yet. */
  get layout(): Laid | null {
    return this.laid?.key === this.layoutInput.key ? this.laid : null;
  }

  /** Where each card sits: where it was left, else where the layout puts it. */
  positions = $derived.by((): Record<Card, Point> => {
    const kept = board.discover.at;
    const ids = this.map.cards.map(one => one.card);
    if (ids.every(id => kept[id])) return kept;
    // While a new layout is worked out, the cards stay where the last one put them.
    const laid = (this.layout ?? this.laid)?.at ?? {};
    return Object.fromEntries(
      ids.flatMap(id => {
        const at = kept[id] ?? laid[id];
        return at ? [[id, at] as const] : [];
      }),
    );
  });
  /** A link's route from the layout, while both its cards are where the layout put them (`place`: where each is now). */
  routeOf(link: Link, place: (card: Card) => Point | undefined): Point[] | undefined {
    const layout = this.layout;
    if (!layout) return undefined;
    const still = (card: Card) => {
      const [now, laid] = [place(card), layout.at[card]];
      return !!now && !!laid && Math.abs(now.x - laid.x) < 0.5 && Math.abs(now.y - laid.y) < 0.5;
    };
    return still(link.from) && still(link.to) ? layout.routes[linkKey(link)] : undefined;
  }
  /** Every card where the layout put it: nothing was moved by hand since. */
  #untouched(): boolean {
    const layout = this.layout;
    return (
      !!layout &&
      this.map.cards.every(({ card }) => {
        const [now, laid] = [this.positions[card], layout.at[card]];
        return !!now && !!laid && Math.abs(now.x - laid.x) < 0.5 && Math.abs(now.y - laid.y) < 0.5;
      })
    );
  }
  /** Arrange, as on a board: pressed again on the map as it left it, it gives the next of its layouts. */
  arrange(): void {
    const next = (board.discover.layout ?? 0) + (this.#untouched() ? 1 : 0);
    // The cards go where the layout puts them, once it is worked out.
    board.discover = { ...board.discover, at: {}, layout: next % DIRECTIONS.length };
  }

  /** Brings in the links a card leaves out: laid out again with the rest, or beside it once cards were moved by hand. */
  open(card: Card): void {
    const before = new Set(this.map.cards.map(one => one.card));
    const at = { ...this.positions };
    const laidOut = this.#untouched();
    board.discover = { ...board.discover, open: [...new Set([...board.discover.open, card])] };
    // Laid out and not moved since, or not placed yet: the layout places the new cards with the rest and routes every link.
    if (laidOut) board.discover = { ...board.discover, at: {} };
    if (laidOut || ![...before].every(id => at[id])) return;
    const from = at[card] ?? { x: 0, y: 0 };
    const fresh = this.map.cards.map(one => one.card).filter(id => !before.has(id));
    const x = from.x + CARD.w + 120;
    const taken = (y: number) =>
      Object.values(at).some(spot => Math.abs(spot.x - x) < CARD.w + 40 && Math.abs(spot.y - y) < CARD.h + 36);
    let y = from.y;
    for (const id of fresh) {
      while (taken(y)) y += CARD.h + 36;
      at[id] = { x, y };
    }
    board.discover = { ...board.discover, at };
  }
  /** Moved by hand: kept with the board. */
  moved(card: Card, to: Point): void {
    board.discover = { ...board.discover, at: { ...this.positions, [card]: to } };
  }

  /** A call found in the code becomes one the stack records. */
  async confirm(link: Link): Promise<void> {
    const said = await post<{ error?: string }>('stack-edit', {
      path: `apps.${link.from}.consumes.${link.to}`,
      value: link.via ? { found: link.via } : {},
    });
    if ('error' in said && said.error) {
      toasts.show(said.error, 'warning');
      return;
    }
    await board.reload();
    toasts.show(`${board.nameOf(link.from)} calls ${board.nameOf(link.to)}: kept in the stack.`);
  }

  /** A change to the feature board, made here as `koppler board edit` makes it. */
  editFeature(edit: FeatureEdit): void {
    board.feature = editFeature(board.feature, edit);
  }
  /** A link the feature uses, as the next step of its last phase. */
  addStep(link: Link): void {
    this.editFeature({ step: [{ from: link.from, to: link.to, kind: link.kind }] });
  }
  /** Accepted: a link the stack does not record yet is recorded first, then the step is the feature's own. */
  async accept(steps: { from: Card; to: Card }[]): Promise<void> {
    const facts = board.facts;
    if (!facts) return;
    const known = linksOf(facts);
    let recorded = false;
    for (const one of steps) {
      const step = this.stepOf(one)?.step;
      const link = step && known.find(link => link.from === step.from && link.to === step.to);
      if (!step || link?.sure === 'confirmed') continue;
      const path = stackPath(facts, step);
      if (!path) continue;
      const said = await post<{ error?: string }>('stack-edit', { path, value: link?.via ? { found: link.via } : {} });
      if ('error' in said && said.error) {
        toasts.show(said.error, 'warning');
        return;
      }
      recorded = true;
    }
    this.editFeature({ accept: steps });
    if (recorded) await board.reload();
  }
  drop(steps: { from: Card; to: Card }[]): void {
    this.editFeature({ drop: steps });
  }
  /** Proposed steps, every one. */
  get proposals(): { from: Card; to: Card }[] {
    return board.feature
      ? numbered(board.feature)
          .filter(({ step }) => step.proposed)
          .map(({ step }) => ({ from: step.from, to: step.to }))
      : [];
  }
  /** The steps that name a card the agent proposed. */
  proposalsOf(card: Card): { from: Card; to: Card }[] {
    return this.proposals.filter(step => step.from === card || step.to === card);
  }
  /** The request goes to the agent, which proposes the steps here. */
  async describe(request: string): Promise<void> {
    this.editFeature({ request });
    await runs.askFeature(board.name ?? 'New feature', request.trim());
  }

  /** The picked apps that run here go on the board in Plan; the rest stay deployed and are listed there. */
  planRun(): void {
    const apps = this.picked.filter(card => this.data(card, false, 0).app);
    const leftOut = this.picked.filter(card => !this.data(card, false, 0).app);
    for (const id of apps) board.add(id);
    board.fromDiscover = { picked: this.picked.length, running: apps, leftOut };
    this.picked = [];
    board.goEdit();
  }
}

export const discovered = new Discovered();
