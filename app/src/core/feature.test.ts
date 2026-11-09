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

  it('replaces a step taken off and added in one edit, where it was', () => {
    const feature = editFeature(null, {
      phase: ['Pay', 'Ship'],
      step: [
        { from: 'web', to: 'orders', kind: 'call', note: 'old', phase: 'Pay' },
        { from: 'orders', to: 'queue:events', kind: 'publish', phase: 'Pay' },
      ],
    });
    const replaced = editFeature(feature, {
      unstep: [{ from: 'web', to: 'orders' }],
      step: [{ from: 'web', to: 'orders', kind: 'call', note: 'new' }],
    });
    expect(replaced.phases[0]?.steps).toEqual([
      { from: 'web', to: 'orders', kind: 'call', note: 'new' },
      { from: 'orders', to: 'queue:events', kind: 'publish' },
    ]);
    expect(replaced.phases[1]?.steps).toEqual([]);
    expect(editFeature(feature, { unstep: [{ from: 'web', to: 'orders' }] }).phases[0]?.steps).toHaveLength(1);
  });

  it('lets one link be a step in several phases, each with its own note; takes it off one phase or every one', () => {
    const feature = editFeature(null, {
      phase: ['Order', 'Nightly batch'],
      step: [
        { from: 'orders', to: 'database:orders-db', kind: 'uses', note: 'Saves it', phase: 'Order' },
        { from: 'orders', to: 'database:orders-db', kind: 'uses', note: 'Reads the day', phase: 'Nightly batch' },
        { from: 'orders', to: 'database:orders-db', kind: 'uses', note: 'Again', phase: 'Nightly batch' },
      ],
    });
    expect(numbered(feature).map(({ number, step }) => `${number} ${step.note ?? ''}`)).toEqual([
      '1.1 Saves it',
      '2.1 Reads the day',
    ]);
    const db = { from: 'orders', to: 'database:orders-db' } as const;
    const once = editFeature(feature, { unstep: [{ ...db, phase: 'Nightly batch' }] });
    expect(once.phases.map(phase => phase.steps.length)).toEqual([1, 0]);
    expect(editFeature(feature, { unstep: [db] }).phases.map(phase => phase.steps.length)).toEqual([0, 0]);
    // Replaced in its own phase only.
    const replaced = editFeature(feature, {
      unstep: [{ ...db, phase: 'Nightly batch' }],
      step: [{ ...db, kind: 'uses', note: 'Reads yesterday', phase: 'Nightly batch' }],
    });
    expect(replaced.phases.map(phase => phase.steps.map(step => step.note))).toEqual([
      ['Saves it'],
      ['Reads yesterday'],
    ]);
  });

  it('takes a phase off with its steps', () => {
    const feature = editFeature(null, {
      phase: ['Order', 'Refund'],
      step: [{ from: 'web', to: 'orders', kind: 'call', phase: 'Order' }],
    });
    expect(editFeature(feature, { dropPhase: ['Refund'] }).phases.map(phase => phase.name)).toEqual(['Order']);
    expect(editFeature(feature, { dropPhase: ['Order'] }).phases).toEqual([{ name: 'Refund', steps: [] }]);
  });

  it('renames a phase and starts from a card before any step names it', () => {
    const feature = editFeature(editFeature(null, { phase: ['One'], card: ['web'] }), {
      rename: { from: 'One', to: 'Pay in the app' },
    });
    expect(feature.phases.map(phase => phase.name)).toEqual(['Pay in the app']);
    expect(featureCards(feature)).toEqual(['web']);
  });

  it('keeps both phases when a rename would reuse an existing name', () => {
    const feature = editFeature(null, { phase: ['Pay', 'Ship'] });
    const renamed = editFeature(feature, { rename: { from: 'Ship', to: '  Pay  ' } });
    expect(renamed).toEqual(feature);
    const changed = editFeature(renamed, { step: [{ from: 'web', to: 'orders', kind: 'call', phase: 'Pay' }] });
    expect(changed.phases.map(phase => phase.steps.length)).toEqual([1, 0]);
    const long = 'A'.repeat(120);
    const truncated = editFeature(null, { phase: [long, 'Ship'] });
    expect(editFeature(truncated, { rename: { from: 'Ship', to: `${long}B` } })).toEqual(truncated);
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
