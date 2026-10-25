// Discover: the map of the board's apps and what they touch, from the stack's facts. Nothing on it runs or changes the
// board; it keeps only which cards were opened and where its cards sit, per board.
import { arrange, type Point } from '../src/core/arrange.ts';
import { linksOf, mapOf, type Card, type Link } from '../src/core/discover.ts';
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
}

export const CARD = { w: 200, h: 64 };
const QUEUE_TAGS: Record<string, [string, string]> = {
  sqs: ['SQS', 'Queue'],
  sns: ['SNS', 'Topic'],
  eventbridge: ['BUS', 'Bus'],
  kafka: ['KAFKA', 'Topic'],
};

class Discovered {
  /** The map: the board's apps, what they touch, and what was brought in from each opened card. */
  map = $derived.by(() => {
    const facts = board.facts;
    if (!facts) return { cards: [], links: [] as Link[] };
    const feature = board.feature;
    if (!feature)
      return mapOf(
        facts,
        board.nodes.map(node => node.id),
        board.discover.open,
      );
    const shown = mapOf(
      facts,
      [...featureCards(feature), ...board.nodes.map(node => node.id)],
      board.discover.open,
      false,
    );
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

  /** What a card shows. */
  data(card: Card, onBoard: boolean, hidden: number): LeanData {
    const facts = board.facts;
    const proposed = !!board.feature && proposedCard(board.feature, card);
    const base = { onBoard, hidden, cloned: false, app: false, proposed };
    if (card.startsWith('queue:')) {
      const queue = facts?.queues?.[card.slice(6)];
      const [tag, meta] = QUEUE_TAGS[queue?.type ?? ''] ?? ['QUEUE', 'Queue'];
      return { ...base, name: queue?.name ?? card.slice(6), tag, meta };
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

  /** Where each card sits: where it was left, else laid out with the rest. */
  positions = $derived.by((): Record<Card, Point> => {
    const { cards, links } = this.map;
    const kept = board.discover.at;
    const ids = cards.map(one => one.card);
    if (ids.every(id => kept[id])) return kept;
    // A feature board is laid out in step order.
    const ordered = board.feature ? numbered(board.feature).map(({ step }) => step) : [];
    const laid = arrange(
      ids,
      [...ordered, ...links].map(({ from, to }) => ({ from, to })),
      () => CARD,
      'right',
      false,
      { pad: 80 },
    );
    return Object.fromEntries(ids.map(id => [id, kept[id] ?? laid[id] ?? { x: 0, y: 0 }]));
  });

  /** Brings in the links a card leaves out, beside it. */
  open(card: Card): void {
    const before = new Set(this.map.cards.map(one => one.card));
    const at = { ...this.positions };
    board.discover = { ...board.discover, open: [...new Set([...board.discover.open, card])] };
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
  /** Laid out again from scratch. */
  rearrange(): void {
    board.discover = { ...board.discover, at: {} };
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
