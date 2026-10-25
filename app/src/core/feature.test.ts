import { describe, expect, it } from 'vitest';
import type { Facts } from './discover.ts';
import { editFeature, featureCards, featureOf, kindBetween, numbered, proposedCard, stackPath } from './feature.ts';

const facts = {
  apps: {
    web: { name: 'Web Shop', kind: 'node', consumes: { orders: {} } },
    orders: { name: 'Orders API', kind: 'dotnet', publishes: { events: {} } },
    payments: { name: 'Payments API', kind: 'dotnet' },
  },
  queues: { events: { name: 'Order events', type: 'sqs' } },
  databases: { 'orders-db': { name: 'Orders', kind: 'postgres' } },
} as unknown as Facts;

describe('editFeature', () => {
  it('adds phases and numbered steps, never the same step twice, and keeps proposals until accepted', () => {
    const feature = editFeature(null, {
      request: '  Customers pay for an order.  ',
      phase: ['Pay'],
      step: [
        { from: 'web', to: 'orders', kind: 'call' },
        { from: 'orders', to: 'queue:events', kind: 'publish' },
        { from: 'web', to: 'orders', kind: 'call' },
        { from: 'queue:events', to: 'payments', kind: 'read', proposed: true, phase: 'Settle' },
      ],
    });
    expect(feature.request).toBe('Customers pay for an order.');
    expect(numbered(feature).map(({ number, step }) => `${number} ${step.from}>${step.to}`)).toEqual([
      '1.1 web>orders',
      '1.2 orders>queue:events',
      '2.1 queue:events>payments',
    ]);
    expect(featureCards(feature)).toEqual(['web', 'orders', 'queue:events', 'payments']);
    expect(proposedCard(feature, 'payments')).toBe(true);
    expect(proposedCard(feature, 'queue:events')).toBe(false);
    const accepted = editFeature(feature, { accept: [{ from: 'queue:events', to: 'payments' }] });
    expect(accepted.phases[1]?.steps[0]).toEqual({ from: 'queue:events', to: 'payments', kind: 'read' });
    const dropped = editFeature(feature, { drop: [{ from: 'queue:events', to: 'payments' }] });
    expect(featureCards(dropped)).not.toContain('payments');
  });

  it('renames a phase and starts from a card before any step names it', () => {
    const feature = editFeature(editFeature(null, { phase: ['One'], card: ['web'] }), {
      rename: { from: 'One', to: 'Pay in the app' },
    });
    expect(feature.phases.map(phase => phase.name)).toEqual(['Pay in the app']);
    expect(featureCards(feature)).toEqual(['web']);
  });
});

describe('featureOf', () => {
  it('keeps only what makes sense from whatever wrote it', () => {
    expect(
      featureOf({
        request: 7,
        cards: ['web', 'Not An Id', 'web'],
        phases: [{ steps: [{ from: 'web', to: 'orders', kind: 'teleport', proposed: 'yes' }, { from: 1 }] }],
      }),
    ).toEqual({
      request: '',
      cards: ['web'],
      phases: [{ name: 'Steps', steps: [{ from: 'web', to: 'orders', kind: 'call' }] }],
    });
    expect(featureOf(null)).toBeNull();
  });
});

describe('kindBetween and stackPath', () => {
  it('reads the kind from the stack or the cards, and says where the stack keeps the link', () => {
    expect(kindBetween(facts, 'orders', 'queue:events')).toBe('publish');
    expect(kindBetween(facts, 'queue:events', 'payments')).toBe('read');
    expect(kindBetween(facts, 'orders', 'database:orders-db')).toBe('uses');
    expect(kindBetween(facts, 'web', 'payments')).toBe('call');
    expect(stackPath(facts, { from: 'web', to: 'payments', kind: 'call' })).toBe('apps.web.consumes.payments');
    expect(stackPath(facts, { from: 'queue:events', to: 'payments', kind: 'read' })).toBe('apps.payments.reads.events');
    expect(stackPath(facts, { from: 'orders', to: 'database:orders-db', kind: 'uses' })).toBe(
      'apps.orders.uses.orders-db',
    );
    expect(stackPath(facts, { from: 'web', to: 'lokalise', kind: 'call' })).toBeNull();
  });
});
