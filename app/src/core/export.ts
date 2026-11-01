// An exported page's data: only the fields named here leave the stack.
import type { Point } from './arrange.ts';
import type { Card } from './discover.ts';
import { featureCards, featureOf } from './feature.ts';
import type { Stack } from './stack.ts';

export interface FlowCard {
  id: Card;
  name: string;
  /** What it is, for someone who does not build it. */
  kind: string;
}
export interface Flow {
  name: string;
  request: string;
  phases: { name: string; steps: { from: Card; to: Card; number: string; note?: string }[] }[];
  cards: FlowCard[];
  /** Where the board's author left the cards that have a place. */
  at: Record<Card, Point>;
}
export interface Exported {
  stack: string;
  /** ISO date. */
  exported: string;
  flows: Flow[];
}

/** A card's size on the page, as the layout sees it. */
export const CARD = { w: 200, h: 60 };

const KIND_WORDS: Record<string, string> = {
  flutter: 'Mobile app',
  web: 'Website',
  lambda: 'Function',
};

function cardOf(stack: Stack, id: Card): FlowCard {
  if (id.startsWith('queue:')) return { id, name: stack.queues?.[id.slice(6)]?.name ?? id.slice(6), kind: 'Queue' };
  if (id.startsWith('database:'))
    return { id, name: stack.databases?.[id.slice(9)]?.name ?? id.slice(9), kind: 'Database' };
  if (id.startsWith('resource:'))
    return { id, name: stack.resources?.[id.slice(9)]?.name ?? id.slice(9), kind: 'Storage' };
  const app = stack.apps[id];
  return {
    id,
    name: app?.name ?? id,
    kind: app?.outside ? 'Outside service' : (KIND_WORDS[app?.kind ?? ''] ?? 'Service'),
  };
}

/** Each team feature board, as a flow: its accepted steps in their phases, and the cards they name. */
export function flowsOf(stack: Stack): Flow[] {
  return (stack.presets ?? []).flatMap(preset => {
    const feature = featureOf((preset as Record<string, unknown>)['feature']);
    if (!feature) return [];
    const accepted = {
      ...feature,
      phases: feature.phases.map(phase => ({ ...phase, steps: phase.steps.filter(step => !step.proposed) })),
    };
    // Numbered once the phases left with no step are gone, as the page numbers them.
    const phases = accepted.phases
      .filter(phase => phase.steps.length)
      .map((phase, at) => ({
        name: phase.name,
        steps: phase.steps.map((step, index) => ({
          from: step.from,
          to: step.to,
          number: `${String(at + 1)}.${String(index + 1)}`,
          ...(step.note && { note: step.note }),
        })),
      }));
    const cards = featureCards(accepted).map(id => cardOf(stack, id));
    const saved = ((preset as Record<string, unknown>)['discover'] as { at?: Record<Card, unknown> } | undefined)?.at;
    const at = Object.fromEntries(
      cards.flatMap(card => {
        const point = saved?.[card.id] as Partial<Point> | undefined;
        return typeof point?.x === 'number' && typeof point.y === 'number'
          ? [[card.id, { x: point.x, y: point.y }] as const]
          : [];
      }),
    );
    return [{ name: preset.name, request: feature.request, phases, cards, at }];
  });
}

/** Cards with no place yet go in a row under the placed ones, so the author's arrangement stays as it is. */
export function placeRest(flow: Flow): Record<Card, Point> {
  const placed = Object.values(flow.at);
  const left = Math.min(...placed.map(point => point.x));
  const below = Math.max(...placed.map(point => point.y)) + CARD.h + 80;
  const rest = flow.cards.filter(card => !flow.at[card.id]);
  return {
    ...flow.at,
    ...Object.fromEntries(rest.map((card, index) => [card.id, { x: left + index * (CARD.w + 60), y: below }])),
  };
}

/** The page's file name, from the stack's name. */
export const fileNameOf = (stack: string): string =>
  `${
    stack
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, '-')
      .replace(/^-|-$/g, '') || 'stack'
  }-flows.html`;
