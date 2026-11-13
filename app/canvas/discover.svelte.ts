// Discover: the map of the stack, the board's apps marked, from the stack's facts. Nothing on it runs or changes the
// board; it keeps only which cards were opened and where its cards sit, per board.
import type { Point } from '../src/core/arrange.ts';
import { DIRECTIONS, type Direction, type Laid } from '../src/core/layout.ts';
import { hiddenBy } from '../src/core/areas.ts';
import { scheduleWords } from '../src/core/schedule.ts';
import { deadEnds, linksOf, mapOf, placesOf, type Card, type Link } from '../src/core/discover.ts';
import {
  editFeature,
  featureCards,
  numbered,
  proposedCard,
  stackPath,
  type Comment,
  type FeatureEdit,
  type Numbered,
  type StepRef,
} from '../src/core/feature.ts';
import { areaNames, chosen } from './areas.svelte.ts';
import { board } from './board.svelte.ts';
import { post } from './data.ts';
import { live } from './live.svelte.ts';
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
  /** The apps it links to that the chosen areas leave out, each with its areas. */
  outside: string[];
  /** An app that can run here. */
  app: boolean;
  /** On a feature board, proposed by the agent and not accepted yet. */
  proposed: boolean;
  /** The repo it is a piece of, when that repo holds another app of the stack too. */
  repo: string;
  /** A queue sent to that nothing reads or passes on. */
  deadEnd: boolean;
  /** Added or changed here and not in the shared stack yet: what to tag it with, and what changed. */
  edited: { tag: 'New' | 'Changed'; says: string } | null;
  /** Its clone's branch and changed files, when the repo's main branch does not have them. */
  changed: string;
  /** A scheduled job: its schedule on the environment read, in words and as written, and the app whose repo it ships from. */
  job?: { words: string; expression: string; env: string; from: string };
}

export const CARD = { w: 200, h: 64 };
/** The Areas checklist under the map, for a card's +N hidden to open. */
export const AREAS = 'discover-areas';
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
  /** The map: the whole stack, or a feature's cards and what was brought in from each opened card. */
  /** The board's own cards: its apps, and the outside systems put on it by hand. */
  #own = $derived([...board.nodes.map(node => node.id), ...board.pinned]);
  /** What the map always shows, whatever the areas: a feature board's own cards. The whole stack keeps none. */
  #always = $derived(board.feature ? [...featureCards(board.feature), ...this.#own] : []);
  /** The apps the chosen areas leave off the map, and the areas they are in. */
  hiding = $derived(
    hiddenBy(
      { areas: board.areas, apps: board.facts?.apps ?? {} },
      chosen.narrows ? chosen.ids : undefined,
      this.#always,
    ),
  );
  map = $derived.by(() => {
    const facts = board.facts;
    if (!facts) return { cards: [], links: [] as Link[] };
    const feature = board.feature;
    const areas = chosen.narrows ? chosen.ids : undefined;
    // The whole stack: every card as it is, none a board's.
    if (!feature) {
      const whole = mapOf(facts, [], [], true, areas);
      return { cards: whole.cards.map(one => ({ ...one, onBoard: true })), links: whole.links };
    }
    const shown = mapOf(facts, this.#always, board.discover.open, false, areas);
    // A step the stack has no link for yet is drawn as found, until it is accepted and recorded.
    const missing = numbered(feature)
      .map(({ step }) => step)
      .filter(step => !shown.links.some(link => link.from === step.from && link.to === step.to))
      .map((step): Link => ({ from: step.from, to: step.to, kind: step.kind, sure: 'found' }));
    return { cards: shown.cards, links: [...shown.links, ...missing] };
  });
  /** The feature's steps, numbered, in order. */
  steps = $derived(board.feature ? numbered(board.feature) : []);
  /** A link's steps: one link can be a step in several phases. */
  stepsOf(link: { from: Card; to: Card }): Numbered[] {
    return this.steps.filter(one => one.step.from === link.from && one.step.to === link.to);
  }
  /** The link's step to show: the picked one, else the one in the picked phase, else its first. */
  stepOf(link: { from: Card; to: Card }): Numbered | undefined {
    const all = this.stepsOf(link);
    return (
      all.find(one => one.number === this.current?.number) ?? all.find(one => one.phase === this.shownPhase) ?? all[0]
    );
  }
  /** The phase picked in the feature's panel: the others dim. */
  phase = $state<number | null>(null);
  /** The step picked by its number on the map: its row in the panel is marked. */
  step = $state<string | null>(null);
  /** The picked step, while the feature still has it. */
  current = $derived(this.step === null ? undefined : this.steps.find(one => one.number === this.step));
  /** The phase marked: the picked step's, else the one picked. */
  shownPhase = $derived(this.current ? this.current.phase : this.phase);
  /** Picks the step `by` places on from the picked one, or the first or last when none is; it stops at either end. */
  walk(by: 1 | -1) {
    const all = this.steps.map(one => one.number);
    if (!all.length) return;
    const at = this.current ? all.indexOf(this.current.number) : by > 0 ? -1 : all.length;
    this.step = all[Math.min(all.length - 1, Math.max(0, at + by))] ?? null;
  }
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
  /** An app's name, and its areas in brackets. */
  #withAreas = (card: Card) => `${board.nameOf(card)} (${areaNames(card).join(', ')})`;
  /** What a card shows. */
  data(card: Card, onBoard: boolean, outside: Card[] = []): LeanData {
    const facts = board.facts;
    const proposed = !!board.feature && proposedCard(board.feature, card);
    const slug = facts?.apps[card]?.slug ?? '';
    const repo = (this.#perRepo[slug.toLowerCase()] ?? 0) > 1 ? (slug.split('/').pop() ?? '') : '';
    const edit = live.status?.changed?.[card];
    const edited = edit
      ? {
          tag: edit.added ? ('New' as const) : ('Changed' as const),
          says: edit.added
            ? 'Added here, not in the shared stack yet'
            : `Changed here, not in the shared stack yet: ${edit.fields.join(', ')}`,
        }
      : null;
    const base = {
      onBoard,
      outside: outside.map(this.#withAreas),
      cloned: false,
      app: false,
      proposed,
      deadEnd: this.#dead.has(card),
      repo,
      edited,
      changed: '',
    };
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
    if (stack?.schedule) {
      const expression = stack.schedule[board.env] ?? '';
      const from = Object.entries(facts?.apps ?? {}).find(
        ([other, one]) => other !== card && !one.schedule && one.slug && one.slug.toLowerCase() === slug.toLowerCase(),
      )?.[1].name;
      return {
        ...base,
        repo: '',
        name: stack.name,
        tag: app?.kindLabel ?? stack.kind,
        meta: '',
        job: {
          words: expression ? scheduleWords(expression) : `no schedule on ${board.env.toUpperCase()}`,
          expression,
          env: board.env,
          from: from ?? '',
        },
      };
    }
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
      changed: app?.changed ?? '',
    };
  }

  /** When a phase starts on a schedule, not from a call: its first step leaves a scheduled job. Its schedule in words. */
  startsOn(phase: { steps: { from: Card }[] }): string {
    const expression = board.facts?.apps[phase.steps[0]?.from ?? '']?.schedule?.[board.env];
    return expression ? scheduleWords(expression) : '';
  }
  /** Each scheduled job on the map with the app on it whose repo it ships from: drawn side by side, joined by a line. */
  sameRepo = $derived.by((): [Card, Card][] => {
    const apps = board.facts?.apps ?? {};
    const shown = this.map.cards.map(one => one.card);
    return shown.flatMap((job): [Card, Card][] => {
      const slug = apps[job]?.schedule && apps[job].slug?.toLowerCase();
      const from =
        slug && shown.find(id => id !== job && !apps[id]?.schedule && apps[id]?.slug?.toLowerCase() === slug);
      return from ? [[from, job]] : [];
    });
  });
  /** The layout Arrange last chose. */
  get direction(): Direction {
    return DIRECTIONS[(board.discover.layout ?? 0) % DIRECTIONS.length] ?? 'RIGHT';
  }
  /** What the map's layout is worked out from: its cards as measured, its links, the layout chosen. */
  layoutInput = $derived.by(() => {
    const cards = this.map.cards.map(({ card }) => ({ id: card, w: CARD.w, h: this.heights[card] ?? CARD.h }));
    const links = [
      ...this.map.links.map(link => ({ id: linkKey(link), from: link.from, to: link.to })),
      ...this.sameRepo.map(([from, to]) => ({ id: `${from}~${to}`, from, to })),
    ];
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
  // While a new layout is worked out, the cards stay where the last one put them.
  positions = $derived(
    placesOf(
      board.discover.at,
      this.map.cards.map(one => one.card),
      (this.layout ?? this.laid)?.at ?? {},
    ),
  );
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

  /** On a feature board, brings in a card's links: laid out again with the rest, or beside it once cards were moved by hand. */
  open(card: Card): void {
    const before = new Set(this.map.cards.map(one => one.card));
    const at = { ...this.positions };
    const laidOut = this.#untouched();
    board.discover = { ...board.discover, open: [...new Set([...board.discover.open, card])] };
    // Laid out and not moved since, or not placed yet: the layout places the new cards with the rest and routes every link.
    if (laidOut) board.discover = { ...board.discover, at: {} };
    if (laidOut || ![...before].every(id => at[id])) return;
    this.#beside(
      at,
      this.map.cards.map(one => one.card).filter(id => !before.has(id)),
      () => card,
    );
  }
  /** Puts each of `fresh` in the first free place right of the card `next` gives, or of the map's corner, and keeps them. */
  #beside(at: Record<Card, Point>, fresh: Card[], next: (card: Card) => Card | undefined): void {
    const taken = (x: number, y: number) =>
      Object.values(at).some(spot => Math.abs(spot.x - x) < CARD.w + 40 && Math.abs(spot.y - y) < CARD.h + 36);
    for (const id of fresh) {
      const from = at[next(id) ?? ''] ?? { x: 0, y: 0 };
      const x = from.x + CARD.w + 120;
      let y = from.y;
      while (taken(x, y)) y += CARD.h + 36;
      at[id] = { x, y };
    }
    board.discover = { ...board.discover, at };
  }
  /** Cards back on the map while the rest were moved by hand: each beside a card it links to, never on one. */
  placeReturning(): void {
    const at = { ...board.discover.at };
    if (!Object.keys(at).length) return;
    const fresh = this.map.cards.map(one => one.card).filter(id => !at[id]);
    if (!fresh.length) return;
    const linked = (id: Card) =>
      this.map.links
        .flatMap(link => (link.from === id ? [link.to] : link.to === id ? [link.from] : []))
        .find(other => at[other]);
    this.#beside(at, fresh, linked);
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

  /** The thread open beside the panel: a comment by its id, or a new one on a card or a step. */
  thread = $state<{ id: string } | { on: Comment['on'] } | null>(null);
  /** Comment, then a click on what it is about. */
  commenting = $state(false);
  /** The threads not resolved yet, on a card or on a step. */
  openOn(on: { card: Card } | { step: StepRef }): Comment[] {
    return (board.feature?.comments ?? []).filter(
      one =>
        !one.resolved &&
        ('card' in on
          ? 'card' in one.on && one.on.card === on.card
          : 'step' in one.on &&
            one.on.step.from === on.step.from &&
            one.on.step.to === on.step.to &&
            (one.on.step.phase ?? '') === (on.step.phase ?? '')),
    );
  }
  /** What a comment is about, in words. */
  about(on: Comment['on']): string {
    return 'card' in on
      ? board.nameOf(on.card)
      : `the step ${board.nameOf(on.step.from)} to ${board.nameOf(on.step.to)}${on.step.phase ? ` in ${on.step.phase}` : ''}`;
  }
  /** A team board keeps its threads in the stack, for the team; yours keeps them on this Mac. */
  async #talk(edit: FeatureEdit): Promise<boolean> {
    const team = !board.own.some(one => one.name === board.name) && board.team.some(one => one.name === board.name);
    if (!team) {
      this.editFeature(edit);
      return true;
    }
    const said = await post<{ ok?: true }>('board-comment', { name: board.name, edit });
    if ('error' in said) {
      toasts.show(`Could not keep the comment. ${said.error}`, 'warning');
      return false;
    }
    // Shown at once on the board on screen; threads are no change to its steps, so it stays the team's.
    this.editFeature(edit);
    // The team's boards as the stack now has them, for the counts in the menus.
    void board.reload();
    return true;
  }
  /** A new thread on a card or a step; the agent is asked to answer it. */
  async comment(on: Comment['on'], text: string): Promise<void> {
    const id = `c${Date.now().toString(36)}`;
    if (!(await this.#talk({ comment: { id, on, text, at: new Date().toISOString() } }))) return;
    this.thread = { id };
    await runs.askComment(board.name ?? '', id, this.about(on), text);
  }
  async reply(id: string, text: string): Promise<void> {
    const on = board.feature?.comments?.find(one => one.id === id)?.on;
    if (!on || !(await this.#talk({ reply: { id, by: 'you', text, at: new Date().toISOString() } }))) return;
    await runs.askComment(board.name ?? '', id, this.about(on), text);
  }
  async resolve(id: string): Promise<void> {
    if (await this.#talk({ resolve: id })) this.thread = null;
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
  async accept(steps: StepRef[]): Promise<void> {
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
  drop(steps: StepRef[]): void {
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
  /** The run boards the picked apps can go to: yours and the team's, never a feature board. */
  get runBoards(): string[] {
    return [...new Set([...board.own, ...board.team].filter(one => !one['feature']).map(one => one.name))];
  }
  /** On a new run board named after the flow, or on the run board `to`. Only apps cross; the rest stay deployed. */
  planRun(to?: string): void {
    const apps = this.picked.filter(card => this.data(card, false).app);
    const leftOut = this.picked.filter(card => !this.data(card, false).app);
    board.planIn(to, board.feature ? board.name : null);
    for (const id of apps) board.add(id);
    // A new run board is laid out along its calls once its cards have their sizes, as Arrange does.
    if (!to) board.opened = 'arrange';
    board.fromDiscover = { picked: this.picked.length, running: apps, leftOut };
    this.picked = [];
    board.goEdit();
  }
}

export const discovered = new Discovered();
