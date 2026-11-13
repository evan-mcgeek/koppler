// Categories: what each card on the map is, worked out from the facts the stack already has, so whole kinds of card
// can be hidden from Discover.
import type { Card, Facts, Link, MapCard } from './discover.ts';

export type Category = 'service' | 'job' | 'outside' | 'queue' | 'database' | 'resource';
/** Each category, in the order the Show menu lists them, with its name for one and for many. */
export const CATEGORIES: readonly { id: Category; one: string; many: string }[] = [
  { id: 'service', one: 'service', many: 'Services and clients' },
  { id: 'job', one: 'job', many: 'Jobs and functions' },
  { id: 'outside', one: 'outside system', many: 'Outside systems' },
  { id: 'queue', one: 'queue', many: 'Queues and topics' },
  { id: 'database', one: 'database', many: 'Databases' },
  { id: 'resource', one: 'cloud resource', many: 'Cloud resources' },
];
/** Kinds whose apps are jobs: they run when something starts them, not as a service. */
const JOB_KINDS = ['lambda', 'workflow'];
/** Kinds whose apps are databases, run here so the others have one. */
const DATABASE_KINDS = ['compose'];

export function categoryOf(facts: Facts, card: Card): Category {
  if (card.startsWith('queue:')) return 'queue';
  if (card.startsWith('database:')) return 'database';
  if (card.startsWith('resource:')) return 'resource';
  const app = facts.apps[card];
  if (app?.outside) return 'outside';
  if (app?.schedule || JOB_KINDS.includes(app?.kind ?? '')) return 'job';
  if (DATABASE_KINDS.includes(app?.kind ?? '')) return 'database';
  return 'service';
}

/** What a card can be hidden by: its category, and a queue's type as `queue:<type>` too. */
function filtersOf(facts: Facts, card: Card): string[] {
  const category = categoryOf(facts, card);
  const type = category === 'queue' ? facts.queues?.[card.slice(6)]?.type : undefined;
  return type ? [category, `queue:${type}`] : [category];
}

/** Whether the hidden filters take this card off the map. */
export const hides = (facts: Facts, hidden: readonly string[], card: Card): boolean =>
  filtersOf(facts, card).some(one => hidden.includes(one));

/** How many cards of the stack each filter covers. */
export function countsOf(facts: Facts): Record<string, number> {
  const cards = [
    ...Object.keys(facts.apps),
    ...Object.keys(facts.queues ?? {}).map(id => `queue:${id}`),
    ...Object.keys(facts.databases ?? {}).map(id => `database:${id}`),
    ...Object.keys(facts.resources ?? {}).map(id => `resource:${id}`),
  ];
  const counts: Record<string, number> = {};
  for (const card of cards) for (const one of filtersOf(facts, card)) counts[one] = (counts[one] ?? 0) + 1;
  return counts;
}

/**
 * The map with the hidden cards taken off: a run of links through hidden cards becomes one link between the cards shown
 * either side, saying which cards it went through. None is drawn where a link between the two already runs.
 */
export function withoutHidden(
  map: { cards: MapCard[]; links: Link[] },
  hidden: (card: Card) => boolean,
): { cards: MapCard[]; links: Link[] } {
  if (!map.cards.some(one => hidden(one.card))) return map;
  const cards = map.cards.filter(one => !hidden(one.card));
  const links = map.links.filter(link => !hidden(link.from) && !hidden(link.to));
  const joined: Link[] = [];
  const runs = (from: Card, to: Card) => [...links, ...joined].some(link => link.from === from && link.to === to);
  for (const first of map.links) {
    if (hidden(first.from) || !hidden(first.to)) continue;
    // Each way on through hidden cards, until one is shown.
    const ways: { at: Card; through: Card[]; found: boolean }[] = [
      { at: first.to, through: [first.to], found: first.sure === 'found' },
    ];
    for (let way = ways.shift(); way; way = ways.shift())
      for (const next of map.links.filter(link => link.from === way.at)) {
        const found = way.found || next.sure === 'found';
        if (!hidden(next.to)) {
          if (next.to !== first.from && !runs(first.from, next.to))
            joined.push({
              from: first.from,
              to: next.to,
              kind: first.kind,
              sure: found ? 'found' : 'confirmed',
              through: way.through,
            });
        } else if (!way.through.includes(next.to))
          ways.push({ at: next.to, through: [...way.through, next.to], found });
      }
  }
  return { cards, links: [...links, ...joined] };
}
