import { describe, expect, it } from 'vitest';
import { fileNameOf, flowsOf, placeRest } from './export.ts';
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

describe('flowsOf', () => {
  it("gives each team feature board as a flow: its steps without the agent's proposals, its cards named in plain words", () => {
    const [checkout] = flowsOf(stack);
    expect(checkout).toEqual({
      name: 'Checkout',
      request: 'A customer pays for the order.',
      phases: [
        {
          name: 'Pay',
          steps: [
            { from: 'shop', to: 'orders', number: '1.1', note: 'Sends the order' },
            { from: 'orders', to: 'queue:events', number: '1.2' },
          ],
        },
      ],
      cards: [
        { id: 'shop', name: 'Mobile App', kind: 'Mobile app' },
        { id: 'orders', name: 'Orders API', kind: 'Service' },
        { id: 'queue:events', name: 'Order events', kind: 'Queue' },
      ],
      at: { shop: { x: 0, y: 0 }, orders: { x: 300, y: 0 }, 'queue:events': { x: 600, y: 0 } },
    });
  });

  it('leaves out boards that are no feature, phases with no step left, and places the board does not have', () => {
    const flows = flowsOf(stack);
    expect(flows.map(flow => flow.name)).toEqual(['Checkout', 'Refund']);
    expect(flows[1]?.at).toEqual({});
    // A phase left with no step goes, and the next is numbered as the page shows it.
    expect(flows[1]?.phases.map(phase => [phase.name, phase.steps[0]?.number])).toEqual([['R', '1.1']]);
    expect(flows[1]?.cards.find(card => card.id === 'psp')?.kind).toBe('Outside service');
  });

  it('carries no address, secret, setting or path of the stack', () => {
    const text = JSON.stringify(flowsOf(stack));
    for (const kept of ['localhost', 'acme.example', 'ORDERS_DB', 'PSP_URL', 'acme/', 'flutter', 'dotnet'])
      expect(text).not.toContain(kept);
  });

  it('keeps the places the author gave, and puts a card added since in a row below', () => {
    const [checkout] = flowsOf(stack);
    if (!checkout) throw new Error('no Checkout');
    const { orders: _, ...partial } = checkout.at;
    expect(placeRest({ ...checkout, at: partial })).toEqual({
      shop: { x: 0, y: 0 },
      'queue:events': { x: 600, y: 0 },
      orders: { x: 0, y: 140 },
    });
  });
});

describe('fileNameOf', () => {
  it('names the page after the stack, in plain letters', () => {
    expect(fileNameOf('Acme Shop')).toBe('acme-shop-flows.html');
    expect(fileNameOf('  ** ')).toBe('stack-flows.html');
  });
});
