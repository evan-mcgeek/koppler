// A feature board: the request it came from, and which of the stack's links the feature uses, as numbered steps in
// phases. A step the agent proposed waits, dashed, until the user accepts it.
import { linksOf, type Card, type Facts, type Link } from './discover.ts';

export interface Step {
  from: Card;
  to: Card;
  kind: Link['kind'];
  /** What happens on it, in words. */
  note?: string;
  /** The agent's, not accepted yet. */
  proposed?: true;
}
export interface Phase {
  name: string;
  steps: Step[];
}
export interface Feature {
  /** The request, in the words it came in. */
  request: string;
  /** Cards it starts from before any step names them. */
  cards: Card[];
  phases: Phase[];
}

export interface FeatureEdit {
  request?: string;
  /** Phases added, in order, by name. */
  phase?: string[];
  /** Steps added, each to its phase (by name), or to the last one. */
  step?: (Step & { phase?: string })[];
  unstep?: { from: Card; to: Card }[];
  /** Proposed steps accepted, or dropped. */
  accept?: { from: Card; to: Card }[];
  drop?: { from: Card; to: Card }[];
  card?: Card[];
  rename?: { from: string; to: string };
}

const MAX_REQUEST = 4000;
const KINDS: Link['kind'][] = ['call', 'publish', 'read', 'uses', 'feeds', 'bucket', 'route', 'starts'];
const isCard = (value: unknown): value is Card =>
  typeof value === 'string' && /^((queue|database):)?[a-z0-9][a-z0-9-]{0,63}$/.test(value);
const isObject = (value: unknown): value is Record<string, unknown> =>
  typeof value === 'object' && value !== null && !Array.isArray(value);
const words = (value: unknown, max: number) => (typeof value === 'string' ? value.trim().slice(0, max) : '');

/** A feature as kept with a board, or null when there is none; whatever wrote it, only what makes sense is kept. */
export function featureOf(given: unknown): Feature | null {
  if (!isObject(given)) return null;
  const list = (value: unknown) => (Array.isArray(value) ? (value as unknown[]) : []);
  const phases = list(given['phases'])
    .filter(isObject)
    .slice(0, 50)
    .map((phase): Phase => ({
      name: words(phase['name'], 120) || 'Steps',
      steps: list(phase['steps'])
        .filter(isObject)
        .filter(step => isCard(step['from']) && isCard(step['to']))
        .slice(0, 200)
        .map(step => ({
          from: step['from'] as Card,
          to: step['to'] as Card,
          kind: KINDS.includes(step['kind'] as Link['kind']) ? (step['kind'] as Link['kind']) : 'call',
          ...(words(step['note'], 300) && { note: words(step['note'], 300) }),
          ...(step['proposed'] === true && { proposed: true as const }),
        })),
    }));
  return {
    request: words(given['request'], MAX_REQUEST),
    cards: [...new Set(list(given['cards']).filter(isCard))].slice(0, 200),
    phases,
  };
}

/** How one card reaches another, as the stack says, else as their kinds allow. */
export function kindBetween(facts: Facts, from: Card, to: Card): Link['kind'] {
  const known = linksOf(facts).find(link => link.from === from && link.to === to);
  if (known) return known.kind;
  const queue = (card: Card) => card.startsWith('queue:');
  if (queue(from) && queue(to)) return 'feeds';
  if (queue(from)) return 'read';
  if (queue(to)) return 'publish';
  return to.startsWith('database:') ? 'uses' : 'call';
}

/** Whether the stack has this card. */
export function inStack(facts: Facts, card: Card): boolean {
  if (card.startsWith('queue:')) return !!facts.queues?.[card.slice(6)];
  if (card.startsWith('database:')) return !!facts.databases?.[card.slice(9)];
  if (card.startsWith('resource:')) return !!facts.resources?.[card.slice(9)];
  return !!facts.apps[card];
}

const same = (a: { from: Card; to: Card }) => (b: { from: Card; to: Card }) => a.from === b.from && a.to === b.to;

/** The feature with the edit made; a step it has already is not added twice. */
export function editFeature(given: Feature | null, edit: FeatureEdit): Feature {
  let feature: Feature = given ?? { request: '', cards: [], phases: [] };
  if (edit.request !== undefined) feature = { ...feature, request: words(edit.request, MAX_REQUEST) };
  if (edit.card?.length) feature = { ...feature, cards: [...new Set([...feature.cards, ...edit.card])] };
  const phase = (name: string) => {
    if (!feature.phases.some(one => one.name === name))
      feature = { ...feature, phases: [...feature.phases, { name, steps: [] }] };
  };
  for (const name of edit.phase ?? []) phase(name.trim().slice(0, 120) || 'Steps');
  const renamed = edit.rename?.to.trim().slice(0, 120);
  if (edit.rename && renamed && !feature.phases.some(one => one.name === renamed))
    feature = {
      ...feature,
      phases: feature.phases.map(one => (one.name === edit.rename?.from ? { ...one, name: renamed } : one)),
    };
  for (const { phase: into, ...step } of edit.step ?? []) {
    if (feature.phases.some(one => one.steps.some(same(step)))) continue;
    const name = into?.trim() || feature.phases.at(-1)?.name || 'Steps';
    phase(name);
    feature = {
      ...feature,
      phases: feature.phases.map(one => (one.name === name ? { ...one, steps: [...one.steps, step] } : one)),
    };
  }
  const steps = (change: (steps: Step[]) => Step[]) => {
    feature = { ...feature, phases: feature.phases.map(one => ({ ...one, steps: change(one.steps) })) };
  };
  for (const gone of [...(edit.unstep ?? []), ...(edit.drop ?? [])])
    steps(all => all.filter(step => !same(gone)(step)));
  for (const kept of edit.accept ?? [])
    steps(all => all.map(({ proposed, ...step }) => (same(kept)(step) || !proposed ? step : { ...step, proposed })));
  return feature;
}

export interface Numbered {
  step: Step;
  /** Phase, then step, from 1: `2.3`. */
  number: string;
  phase: number;
}
/** Every step with its number, in order. */
export const numbered = (feature: Feature): Numbered[] =>
  feature.phases.flatMap((phase, at) =>
    phase.steps.map((step, index) => ({ step, number: `${String(at + 1)}.${String(index + 1)}`, phase: at })),
  );

/** The feature's cards: those it starts from, then each step's two ends, in step order. */
export const featureCards = (feature: Feature): Card[] => [
  ...new Set([...feature.cards, ...numbered(feature).flatMap(({ step }) => [step.from, step.to])]),
];

/** A card the agent proposed: every step that names it is proposed, and the feature does not start from it. */
export const proposedCard = (feature: Feature, card: Card): boolean => {
  const touching = numbered(feature).filter(({ step }) => step.from === card || step.to === card);
  return !feature.cards.includes(card) && touching.length > 0 && touching.every(({ step }) => step.proposed);
};

/** Where the stack keeps a link, for `koppler stack set`, or null when it is not between cards it has. */
export function stackPath(facts: Facts, link: { from: Card; to: Card; kind: Link['kind'] }): string | null {
  const [from, to] = [link.from, link.to];
  if (!inStack(facts, from) || !inStack(facts, to)) return null;
  const id = (card: Card) => card.slice(card.indexOf(':') + 1);
  switch (link.kind) {
    case 'call':
      return from.startsWith('resource:') ? null : `apps.${from}.consumes.${to}`;
    case 'publish':
      return `apps.${from}.publishes.${id(to)}`;
    case 'read':
      return `apps.${to}.reads.${id(from)}`;
    case 'uses':
      return `apps.${from}.uses.${id(to)}`;
    case 'feeds':
      return `queues.${id(from)}.feeds.${id(to)}`;
    // Each needs more than the link says: whether it reads or writes, the route, where in the list it goes.
    case 'bucket':
    case 'route':
    case 'starts':
      return null;
  }
}
