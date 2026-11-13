import { describe, expect, it } from 'vitest';
import { boardNamed, exportedOf, fileNameOf } from './export.ts';
import type { Stack } from './stack.ts';

const app = (name: string, extra: object = {}) => ({ name, kind: 'node', slug: `acme/${name}`, ...extra });
const stack = {
  name: 'Acme Shop',
  envs: ['qa'],
  apps: {
    shop: app('Mobile App', {
      kind: 'flutter',
      url: 'http://localhost:5100',
      deployedUrl: 'https://shop.qa.acme.example',
    }),
    orders: app('Orders API', {
      kind: 'dotnet',
      description: 'Keeps every order',
      secrets: ['ORDERS_DB'],
      consumes: { psp: { how: 'env', env: 'PSP_URL' } },
    }),
    psp: app('Payment provider', { outside: 'hosted' }),
  },
  queues: { events: { name: 'Order events', type: 'sqs' } },
  presets: [
    { name: 'Everyday', version: 1, nodes: { orders: { run: 'cli' } }, edges: [] },
    {
      name: 'Checkout',
      version: 1,
      nodes: {},
      edges: [],
      feature: {
        request: 'A customer pays for the order.',
        cards: [],
        phases: [
          {
            name: 'Pay',
            steps: [
              { from: 'shop', to: 'orders', kind: 'call', note: 'Sends the order' },
              { from: 'orders', to: 'queue:events', kind: 'publish' },
              { from: 'orders', to: 'psp', kind: 'call', proposed: true },
            ],
          },
        ],
      },
      discover: { open: [], at: { shop: { x: 0, y: 0 }, orders: { x: 300, y: 0 }, 'queue:events': { x: 600, y: 0 } } },
    },
    {
      name: 'Refund',
      version: 1,
      nodes: {},
      edges: [],
      feature: {
        request: 'r',
        cards: [],
        phases: [
          { name: 'Only proposed', steps: [{ from: 'shop', to: 'orders', kind: 'call', proposed: true }] },
          { name: 'R', steps: [{ from: 'orders', to: 'psp', kind: 'call' }] },
        ],
      },
    },
  ],
} as unknown as Stack;

describe('exportedOf', () => {
  const { facts, boards } = exportedOf(stack);
  const apps = facts['apps'] as Record<string, Record<string, unknown>>;

  it("gives each feature board with its steps but the agent's proposals, and where its author left the cards", () => {
    expect(boards.map(one => one.name)).toEqual(['Checkout', 'Refund']);
    expect(boards[0]).toEqual({
      name: 'Checkout',
      version: 1,
      nodes: {},
      edges: [],
      feature: {
        request: 'A customer pays for the order.',
        cards: [],
        phases: [
          {
            name: 'Pay',
            steps: [
              { from: 'shop', to: 'orders', kind: 'call', note: 'Sends the order' },
              { from: 'orders', to: 'queue:events', kind: 'publish' },
            ],
          },
        ],
      },
      discover: { open: [], at: { shop: { x: 0, y: 0 }, orders: { x: 300, y: 0 }, 'queue:events': { x: 600, y: 0 } } },
    });
    // A phase left with no step goes.
    expect(boards[1]?.feature.phases.map(phase => phase.name)).toEqual(['R']);
    expect(boards[1]?.discover.at).toEqual({});
  });

  it('keeps the layout Arrange last chose for a board', () => {
    const laid = { name: 'Laid', feature: stack.presets?.[1]?.['feature'], discover: { open: [], at: {}, layout: 1 } };
    expect(exportedOf(stack, [laid]).boards[0]?.discover).toEqual({ open: [], at: {}, layout: 1 });
  });

  it("holds only the flows' cards, by name, kind and what each does, and the links between them", () => {
    expect(Object.keys(apps)).toEqual(['shop', 'orders', 'psp']);
    expect(apps['orders']).toEqual({
      name: 'Orders API',
      kind: 'dotnet',
      description: 'Keeps every order',
      consumes: { psp: { how: 'env' } },
    });
    expect(apps['psp']).toEqual({ name: 'Payment provider', kind: 'node', outside: 'hosted' });
    expect(facts['queues']).toEqual({ events: { name: 'Order events', type: 'sqs' } });
    expect(facts).toMatchObject({ name: 'Acme Shop', envs: ['qa'], presets: boards });
  });

  it('carries no address, secret, setting, file or repo of the stack', () => {
    const text = JSON.stringify(exportedOf(stack));
    for (const kept of ['localhost', 'acme.example', 'ORDERS_DB', 'PSP_URL', 'acme/']) expect(text).not.toContain(kept);
  });
});

describe('boardNamed', () => {
  const team = (stack.presets ?? []) as ({ name: string } & Record<string, unknown>)[];
  const mine = {
    name: 'checkout',
    version: 1,
    nodes: {},
    edges: [],
    feature: { request: 'Mine', cards: [], phases: [] },
  };

  it("finds a board by its exact name first, then ignoring case, your own before the team's", () => {
    expect(boardNamed([mine], team, 'checkout')).toEqual({ board: mine });
    expect(boardNamed([mine], team, 'Checkout')).toEqual({ board: team[1] });
    expect(boardNamed([], team, 'REFUND')).toEqual({ board: team[2] });
  });

  it('refuses a board that is not there, naming those there are, and one that is no feature board', () => {
    expect(boardNamed([mine], team, 'Nope')).toEqual({
      error: 'No board called "Nope". Boards with a feature: checkout, Checkout, Refund',
    });
    expect(boardNamed([], team, 'Everyday')).toEqual({
      error: 'Everyday is not a feature board: only a feature board has steps to put in the page',
    });
  });

  it("gives the board found, your own as well as the team's, as the page's one board", () => {
    const found = boardNamed([mine], team, 'Refund');
    expect('board' in found && exportedOf(stack, [found.board]).boards.map(one => one.name)).toEqual(['Refund']);
  });
});

describe('fileNameOf', () => {
  it('names the page after the stack, in plain letters', () => {
    expect(fileNameOf('Acme Shop')).toBe('acme-shop-flows.html');
    expect(fileNameOf('  ** ')).toBe('stack-flows.html');
  });
});
