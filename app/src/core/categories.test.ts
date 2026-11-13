import { describe, expect, it } from 'vitest';
import { categoryOf, countsOf, hides, withoutHidden } from './categories.ts';
import type { Facts, Link } from './discover.ts';

const facts = {
  apps: {
    web: { name: 'Web Shop', kind: 'web' },
    orders: { name: 'Orders API', kind: 'dotnet' },
    mailer: { name: 'Mailer', kind: 'node' },
    psp: { name: 'Payment provider', kind: 'other', outside: true },
    nightly: { name: 'Nightly report', kind: 'dotnet', schedule: { qa: 'rate(1 day)' } },
    pusher: { name: 'Pusher', kind: 'lambda' },
    sync: { name: 'Sync keys', kind: 'workflow' },
    db: { name: 'Orders DB', kind: 'compose' },
  },
  queues: { orders: { name: 'orders', type: 'kafka' }, mail: { name: 'mail', type: 'sqs' } },
  databases: { main: { name: 'Main', kind: 'postgres' } },
  resources: { files: { name: 'Files', type: 's3' } },
} as unknown as Facts;

const link = (from: string, to: string, sure: Link['sure'] = 'confirmed'): Link => ({ from, to, kind: 'call', sure });

describe('categoryOf', () => {
  it('works out what each card is from the facts it has', () => {
    expect(
      [
        'web',
        'orders',
        'psp',
        'nightly',
        'pusher',
        'sync',
        'db',
        'queue:orders',
        'database:main',
        'resource:files',
      ].map(card => categoryOf(facts, card)),
    ).toEqual(['service', 'service', 'outside', 'job', 'job', 'job', 'database', 'queue', 'database', 'resource']);
  });
});

describe('countsOf', () => {
  it('counts every card of the stack by category and each queue type', () => {
    expect(countsOf(facts)).toEqual({
      service: 3,
      job: 3,
      outside: 1,
      queue: 2,
      'queue:kafka': 1,
      'queue:sqs': 1,
      database: 2,
      resource: 1,
    });
  });
});

describe('hides', () => {
  it('hides a card by its category, or a queue by its type', () => {
    expect(hides(facts, ['outside'], 'psp')).toBe(true);
    expect(hides(facts, ['queue:kafka'], 'queue:orders')).toBe(true);
    expect(hides(facts, ['queue:kafka'], 'queue:mail')).toBe(false);
    expect(hides(facts, [], 'web')).toBe(false);
  });
});

describe('withoutHidden', () => {
  const cards = ['web', 'orders', 'queue:orders', 'mailer', 'psp'].map(card => ({ card, onBoard: true }));
  const links = [
    link('web', 'orders'),
    { ...link('orders', 'queue:orders'), kind: 'publish' as const },
    { ...link('queue:orders', 'mailer'), kind: 'read' as const },
    link('orders', 'psp'),
  ];

  it('leaves the map alone when nothing is hidden', () => {
    expect(withoutHidden({ cards, links }, () => false)).toEqual({ cards, links });
  });

  it('takes hidden cards off and joins the cards either side of them', () => {
    const map = withoutHidden({ cards, links }, card => card === 'queue:orders' || card === 'psp');
    expect(map.cards.map(one => one.card)).toEqual(['web', 'orders', 'mailer']);
    expect(map.links).toEqual([
      link('web', 'orders'),
      { from: 'orders', to: 'mailer', kind: 'publish', sure: 'confirmed', through: ['queue:orders'] },
    ]);
  });

  it('follows a run of hidden cards, and a found link anywhere on it makes the joined one found', () => {
    const chain = [link('a', 'h1'), link('h1', 'h2', 'found'), link('h2', 'b'), link('h2', 'h1')];
    const map = withoutHidden(
      { cards: ['a', 'h1', 'h2', 'b'].map(card => ({ card, onBoard: true })), links: chain },
      card => card.startsWith('h'),
    );
    expect(map.links).toEqual([{ from: 'a', to: 'b', kind: 'call', sure: 'found', through: ['h1', 'h2'] }]);
  });

  it('draws no joined link where a direct one already runs, nor one from a card back to itself', () => {
    const map = withoutHidden(
      {
        cards: ['a', 'h', 'b'].map(card => ({ card, onBoard: true })),
        links: [link('a', 'h'), link('h', 'b'), link('a', 'b'), link('h', 'a')],
      },
      card => card === 'h',
    );
    expect(map.links).toEqual([link('a', 'b')]);
  });
});
