// What feeds a queue on the board stacks above it: a Kafka topic piped onto a bus that a rule forwards to the bus an app
// reads through its Lambda. Those upstream stay deployed.
import type { Locator, Page } from '@playwright/test';
import { expect, STACK, test } from './canvas.ts';

const queue = (page: Page) => page.locator('.svelte-flow__node-queue');
const stack = {
  ...STACK,
  queues: {
    'orders-created': {
      name: 'Orders created',
      type: 'kafka',
      queue: 'Orders_Created',
      feeds: { 'orders-bus': { via: 'pipe' }, elsewhere: { via: 'pipe' } },
    },
    'orders-bus': { name: 'Orders bus', type: 'eventbridge', feeds: { 'shop-bus': { via: 'rule' } } },
    'shop-bus': { name: 'Shop bus', type: 'eventbridge', queue: 'shop_bus_qa' },
    unrelated: { name: 'Unrelated topic', type: 'kafka', feeds: { elsewhere: { via: 'pipe' } } },
    elsewhere: { name: 'Elsewhere', type: 'sqs' },
  },
  apps: {
    ...STACK.apps,
    orders: { ...STACK.apps.orders, reads: { 'shop-bus': { via: 'rule to Lambda' } } },
    // Reads the same topic and bus, but is not on the board: nothing of it shows.
    payments: { ...STACK.apps.payments, reads: { 'orders-created': {}, 'shop-bus': {}, elsewhere: {} } },
  },
};
test.use({
  stack,
  board: {
    env: 'qa',
    mode: 'auto',
    zoom: 0.7,
    pan: { x: 60, y: 420 },
    nodes: { orders: { x: 0, y: 0, run: 'cli', branch: 'main', showQueues: true } },
    edges: [],
  },
});

test('the topic and the buses that feed a queue an app reads stack above it, each link saying how', async ({
  page,
}) => {
  // Only what joins Orders API: not the unrelated topic, not Elsewhere though the topic also feeds it.
  await expect(queue(page)).toHaveCount(3);
  await expect(queue(page).filter({ hasText: /Unrelated|Elsewhere/ })).toHaveCount(0);
  await expect(page.locator('.svelte-flow__node[data-id="payments"]')).toHaveCount(0);
  const named = (name: string) => queue(page).filter({ hasText: name });
  const [topic, bus, shop] = [named('Orders created'), named('Orders bus'), named('Shop bus')];
  const top = async (card: Locator) => (await card.boundingBox())?.y ?? 0;
  expect(await top(topic)).toBeLessThan(await top(bus));
  expect(await top(bus)).toBeLessThan(await top(shop));
  // Upstream stays deployed: no Local switch, and the card says what it feeds.
  await expect(topic).toContainText('Stays deployed');
  await expect(topic.getByRole('radiogroup')).toHaveCount(0);
  // The app reads the bus through its deployed Lambda: the local app takes nothing off the deployed bus.
  await expect(shop.getByRole('img', { name: /reads the QA queue/ })).toHaveCount(0);
  await page.screenshot({ path: 'test-results/next-queue-feeds.png' });
  await topic.hover();
  await expect(page.getByRole('tooltip')).toContainText('Stays deployed on QA: it feeds Orders bus.');
  const labels = page.locator('.links .flow .via');
  await expect(labels).toHaveCount(3);
  await expect(page.locator('.links .flow')).toHaveCount(3);
  expect((await labels.allTextContents()).sort()).toEqual(['pipe', 'rule', 'rule to Lambda']);
  await page.screenshot({ path: 'test-results/next-queue-feeds.png' });
});

test.describe('outside systems on a chain upstream of a queue an app reads', () => {
  test.use({
    stack: {
      ...STACK,
      queues: {
        'crm-topic': { name: 'CRM topic', type: 'kafka', feeds: { events: { via: 'pipe' } } },
        events: { name: 'Events bus', type: 'eventbridge', feeds: { 'shop-bus': { via: 'rule' } } },
        'shop-bus': { name: 'Shop bus', type: 'eventbridge' },
      },
      apps: {
        ...STACK.apps,
        orders: { ...STACK.apps.orders, reads: { 'shop-bus': { via: 'rule to Lambda' } } },
        crm: { name: 'Acme CRM', kind: 'other', outside: 'SaaS', publishes: { 'crm-topic': {} } },
        bridge: {
          name: 'Acme Bridge',
          kind: 'other',
          outside: 'Lambda',
          reads: { 'crm-topic': { via: 'pipe' } },
          publishes: { events: {} },
        },
      },
    },
  });

  test('keep their cards and their links to the queues they publish to and read', async ({ page }) => {
    await expect(queue(page)).toHaveCount(3);
    const outside = page.locator('.svelte-flow__node-outside');
    await expect(outside.filter({ hasText: 'Acme CRM' })).toBeVisible();
    await expect(outside.filter({ hasText: 'Acme Bridge' })).toBeVisible();
    // CRM to its topic, the topic to the bridge, the bridge to the bus, two feeds, and the bus to Orders API.
    await expect(page.locator('.links .flow')).toHaveCount(6);
    await page.screenshot({ path: 'test-results/next-queue-feeds-outside.png' });
  });
});
