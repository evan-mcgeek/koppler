import { describe, expect, it } from 'vitest';
import { guide } from './guide.ts';
import type { Stack } from './stack.ts';

const stack = {
  name: 'Acme Shop',
  envs: ['qa', 'prod'],
  notes: ['Orders are paid through the payment provider.'],
  queues: { events: { name: 'Order events', type: 'sqs' } },
  databases: { 'orders-db': { name: 'Orders', kind: 'postgres' } },
  apps: {
    web: { name: 'Web Shop', kind: 'web', slug: 'acme/web-shop', consumes: { orders: { env: 'ORDERS_URL' } } },
    orders: {
      name: 'Orders API',
      description: 'Keeps every order',
      kind: 'dotnet',
      slug: 'acme/orders-api',
      publishes: { events: {} },
      uses: { 'orders-db': {} },
      consumes: { psp: {} },
      prereqs: [
        { sso: 'acme-qa', account: '123456789012' },
        { tunnel: 'db.qa.acme.dev', port: 5432, what: 'Orders database' },
      ],
      secrets: [{ env: 'PSP_KEY', fetch: { ui: 'the team vault' } }],
      envs: { prod: { prereqs: [{ sso: 'acme-prod' }], secrets: [] } },
    },
    payments: { name: 'Payments API', kind: 'node', slug: 'acme/payments', reads: { events: {} } },
    psp: { name: 'Payment provider', kind: 'other', outside: 'a hosted service' },
  },
  presets: [
    {
      name: 'Checkout',
      version: 1,
      feature: {
        request: 'A customer pays for an order.',
        cards: [],
        phases: [{ name: 'Pay', steps: [{ from: 'web', to: 'orders', kind: 'call', note: 'POST /orders' }] }],
      },
    },
    { name: 'Just a board', version: 1 },
  ],
} as unknown as Stack;

describe('guide', () => {
  const page = guide(stack);
  it('lists each app with what it does, what it calls and is called by, its queues and data', () => {
    expect(page).toContain('# Acme Shop\n\n- Orders are paid through the payment provider.\n\nEnvironments: qa, prod.');
    expect(page).toContain(
      '### Orders API\n\n.NET, in `acme/orders-api`.\n\nKeeps every order\n\n- Calls Payment provider.\n- Called by Web Shop.',
    );
    expect(page).toContain('- Sends to Order events.\n- Uses Orders.');
    expect(page).toContain('### Payments API\n\nNode, in `acme/payments`.\n\n- Reads Order events.\n');
  });
  it("says what this Mac needs per environment, once when they agree, and never a secret's value", () => {
    expect(page).toContain(
      'To run it here on qa:\n\n- Signed in to AWS with the profile `acme-qa` (account 123456789012)\n- A tunnel to Orders database on port 5432\n- The secret `PSP_KEY`, from the team vault',
    );
    expect(page).toContain('To run it here on prod:\n\n- Signed in to AWS with the profile `acme-prod`');
    expect(page).not.toContain('To run it here on qa:\n\n- Signed in to AWS with the profile `acme-prod`');
  });
  it('puts outside systems apart, and walks each feature board in its phases', () => {
    expect(page).toContain('## Outside systems\n\n- Payment provider: a hosted service');
    expect(page).toContain(
      '### Checkout\n\n> A customer pays for an order.\n\n1. Pay\n   - 1.1 Web Shop → Orders API: POST /orders',
    );
    expect(page).not.toContain('Just a board');
  });
});
