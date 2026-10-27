import { describe, expect, it } from 'vitest';
import { deadEnds, linksOf, mapOf, type Facts } from './discover.ts';

const app = (name: string, extra: object = {}) => ({ name, kind: 'node', slug: `acme/${name}`, ...extra });
const facts = {
  apps: {
    web: app('Web Shop', { consumes: { orders: {} } }),
    orders: app('Orders API', { publishes: { events: {} }, uses: { 'orders-db': {} } }),
    payments: app('Payments API', { reads: { events: { via: 'rule to Lambda' } }, consumes: { psp: {} } }),
    psp: app('Pay provider', { outside: 'SaaS' }),
    reports: app('Reports', { consumes: { payments: {} } }),
  },
  queues: { events: { name: 'Order events', type: 'sqs' } },
  databases: { 'orders-db': { name: 'Orders', kind: 'postgres' } },
  found: { orders: { payments: 'src/pay.ts' }, web: { orders: 'already recorded' } },
} as unknown as Facts;

describe('linksOf', () => {
  it('reads calls, found calls, queues and databases, and leaves out a found call the stack records', () => {
    expect(linksOf(facts)).toEqual([
      { from: 'web', to: 'orders', kind: 'call', sure: 'confirmed' },
      { from: 'orders', to: 'payments', kind: 'call', sure: 'found', via: 'src/pay.ts' },
      { from: 'orders', to: 'queue:events', kind: 'publish', sure: 'confirmed' },
      { from: 'orders', to: 'database:orders-db', kind: 'uses', sure: 'confirmed' },
      { from: 'payments', to: 'psp', kind: 'call', sure: 'confirmed' },
      { from: 'queue:events', to: 'payments', kind: 'read', sure: 'confirmed', via: 'rule to Lambda' },
      { from: 'reports', to: 'payments', kind: 'call', sure: 'confirmed' },
    ]);
  });
});

describe('deadEnds', () => {
  it('flags a queue sent to that nothing reads or passes on, and not one that does', () => {
    const queues = {
      events: { name: 'Order events', type: 'sqs' },
      status: { name: 'Status', type: 'sns' },
      bus: { name: 'Bus', type: 'eventbridge', feeds: { events: {} } },
      idle: { name: 'Idle', type: 'sqs' },
    };
    const orders = { ...facts.apps['orders'], publishes: { events: {}, status: {}, bus: {} } };
    expect([...deadEnds({ ...facts, apps: { ...facts.apps, orders }, queues } as unknown as Facts)]).toEqual([
      'queue:status',
    ]);
  });
});

describe('mapOf', () => {
  it('shows the board and one step around it, its apps queues and databases as its own, and counts what each card leaves out', () => {
    const { cards, links } = mapOf(facts, ['orders']);
    expect(cards).toEqual([
      { card: 'orders', onBoard: true, hidden: 0 },
      { card: 'web', onBoard: false, hidden: 0 },
      { card: 'payments', onBoard: false, hidden: 2 },
      { card: 'queue:events', onBoard: true, hidden: 0 },
      { card: 'database:orders-db', onBoard: true, hidden: 0 },
    ]);
    expect(links).toHaveLength(5);
  });

  it('brings in one step more around a card that is opened, and leaves out what does not exist', () => {
    const { cards } = mapOf(facts, ['orders', 'gone'], ['payments']);
    expect(cards.map(one => one.card).sort()).toEqual(
      ['database:orders-db', 'orders', 'payments', 'psp', 'queue:events', 'reports', 'web'].sort(),
    );
    expect(cards.find(one => one.card === 'payments')?.hidden).toBe(0);
  });
});

describe('mapOf on a feature board', () => {
  it('shows only its own cards until one is opened', () => {
    expect(mapOf(facts, ['web', 'orders'], [], false).cards).toEqual([
      { card: 'web', onBoard: true, hidden: 0 },
      { card: 'orders', onBoard: true, hidden: 3 },
    ]);
    expect(mapOf(facts, ['web', 'orders'], ['orders'], false).cards).toHaveLength(5);
  });
});
