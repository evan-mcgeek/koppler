// Discover: how the stack fits together, read from its facts. The board's apps, everything one step away from them, and
// one step further from each card whose hidden links were brought in.
import type { Call, Stack } from './stack.ts';

/**
 * A card on the map: an app or outside system by its id, a queue as `queue:<id>`, a database as `database:<id>`, a
 * bucket, API Gateway or Step Functions as `resource:<id>`.
 */
export type Card = string;

export interface Link {
  from: Card;
  to: Card;
  kind: 'call' | 'publish' | 'read' | 'uses' | 'feeds' | 'bucket' | 'route' | 'starts';
  /** Recorded in the stack, or only found in the code. */
  sure: 'confirmed' | 'found';
  /** How it goes when the stack says: a rule, a pipe, where it was found, a bucket's reads, writes or both, routes. */
  via?: string;
  /** A call the stack records without saying where it comes from: no setting, file or place in the code. */
  unsourced?: true;
}

export type Facts = Pick<Stack, 'apps'> &
  Partial<Pick<Stack, 'queues' | 'databases' | 'resources'>> & {
    /** Calls the stack does not record, found in the clones: caller, then callee, then where. */
    found?: Record<string, Record<string, string>>;
  };

/** Whether a recorded call says where it comes from. */
const sourced = (call: Call | undefined) =>
  !!call && (!!call.env || !!call.file || !!call.key || !!call.found || (!!call.how && call.how !== 'unknown'));
const via = (use: unknown): string | undefined => {
  const said = (use as { via?: unknown } | null | undefined)?.via;
  return typeof said === 'string' && said ? said : undefined;
};

const ACCESS = { read: 'reads', write: 'writes', both: 'both' } as const;

/** Every link the stack knows: its calls, the calls found in the code, its queues, databases and resources. */
export function linksOf(facts: Facts): Link[] {
  const links: Link[] = [];
  const apps = facts.apps;
  for (const [id, app] of Object.entries(apps)) {
    for (const [to, call] of Object.entries(app.consumes ?? {}))
      if (apps[to])
        links.push({
          from: id,
          to,
          kind: 'call',
          sure: 'confirmed',
          ...(call.found && { via: call.found }),
          ...(!sourced(call) && { unsourced: true }),
        });
    for (const [to, where] of Object.entries(facts.found?.[id] ?? {}))
      if (apps[to] && !app.consumes?.[to]) links.push({ from: id, to, kind: 'call', sure: 'found', via: where });
    for (const [queue, use] of Object.entries(app.publishes ?? {}))
      if (facts.queues?.[queue])
        links.push({ from: id, to: `queue:${queue}`, kind: 'publish', sure: 'confirmed', ...withVia(use) });
    for (const [queue, use] of Object.entries(app.reads ?? {}))
      if (facts.queues?.[queue])
        links.push({ from: `queue:${queue}`, to: id, kind: 'read', sure: 'confirmed', ...withVia(use) });
    for (const database of Object.keys(app.uses ?? {}))
      if (facts.databases?.[database])
        links.push({ from: id, to: `database:${database}`, kind: 'uses', sure: 'confirmed' });
    for (const [bucket, use] of Object.entries(app.buckets ?? {}))
      if (facts.resources?.[bucket]?.type === 's3') {
        const [one, other] = use.access === 'read' ? [`resource:${bucket}`, id] : [id, `resource:${bucket}`];
        links.push({ from: one, to: other, kind: 'bucket', sure: 'confirmed', via: ACCESS[use.access] });
      }
  }
  for (const [id, resource] of Object.entries(facts.resources ?? {})) {
    const card = `resource:${id}`;
    // One link per app or queue it hands to, with every route to it.
    const routes = new Map<Card, string[]>();
    for (const [route, to] of Object.entries(resource.routes ?? {}))
      if (to.startsWith('queue:') ? facts.queues?.[to.slice(6)] : apps[to])
        routes.set(to, [...(routes.get(to) ?? []), route]);
    for (const [to, said] of routes)
      links.push({ from: card, to, kind: 'route', sure: 'confirmed', via: said.join(', ') });
    for (const by of new Set(resource.startedBy ?? []))
      if (apps[by]) links.push({ from: by, to: card, kind: 'starts', sure: 'confirmed' });
    for (const to of new Set((resource.steps ?? []).flatMap(step => (step.calls ? [step.calls] : []))))
      if (apps[to]) links.push({ from: card, to, kind: 'call', sure: 'confirmed' });
  }
  for (const [id, queue] of Object.entries(facts.queues ?? {}))
    for (const [to, feed] of Object.entries(queue.feeds ?? {}))
      if (facts.queues?.[to])
        links.push({ from: `queue:${id}`, to: `queue:${to}`, kind: 'feeds', sure: 'confirmed', ...withVia(feed) });
  return links;
}
/** The queues something sends to that nothing reads or passes on: what goes in goes nowhere. */
export function deadEnds(facts: Facts): Set<Card> {
  const links = linksOf(facts);
  return new Set(
    links
      .filter(link => link.to.startsWith('queue:') && (link.kind === 'publish' || link.kind === 'feeds'))
      .map(link => link.to)
      .filter(queue => !links.some(link => link.from === queue)),
  );
}
const withVia = (use: unknown) => {
  const said = via(use);
  return said ? { via: said } : {};
};

export interface MapCard {
  card: Card;
  /** One of the board's cards, or a queue or database one of them uses; the rest are one step away, drawn dimmed. */
  onBoard: boolean;
  /** Links to cards not on the map: the +N chip that brings them in. */
  hidden: number;
}

/**
 * What Discover shows for a board: its apps, the cards one step from them, and one step from each card in `open`;
 * the links between the cards shown, and how many each card leaves out.
 */
export function mapOf(
  facts: Facts,
  board: readonly Card[],
  open: readonly Card[] = [],
  /** The cards one step from the board too; a feature board shows only its own until one is opened. */
  around = true,
): { cards: MapCard[]; links: Link[] } {
  const all = linksOf(facts);
  const near = (card: Card) =>
    all.flatMap(link => (link.from === card ? [link.to] : link.to === card ? [link.from] : []));
  const exists = (card: Card) =>
    card.startsWith('queue:')
      ? !!facts.queues?.[card.slice(6)]
      : card.startsWith('database:')
        ? !!facts.databases?.[card.slice(9)]
        : card.startsWith('resource:')
          ? !!facts.resources?.[card.slice(9)]
          : !!facts.apps[card];
  const onBoard = board.filter(exists);
  const shown = new Set<Card>(onBoard);
  for (const card of [...(around ? onBoard : []), ...open.filter(exists)]) {
    shown.add(card);
    for (const other of near(card)) shown.add(other);
  }
  const links = all.filter(link => shown.has(link.from) && shown.has(link.to));
  // A queue, database or resource a board app uses is the board's own too: it is drawn with them, not drawn back.
  const own = (card: Card) =>
    onBoard.includes(card) || (card.includes(':') && near(card).some(other => onBoard.includes(other)));
  const cards = [...shown].map(card => ({
    card,
    onBoard: own(card),
    hidden: new Set(near(card).filter(other => !shown.has(other))).size,
  }));
  return { cards, links };
}
