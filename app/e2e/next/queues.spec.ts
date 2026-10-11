// The new canvas's queue cards, outside systems and the apps a card still calls in the deployed environment.
import type { Page } from '@playwright/test';
import { test, expect, STACK } from '../canvas.ts';

const card = (page: Page, id: string) => page.locator(`.svelte-flow__node[data-id="${id}"]`);
const queue = (page: Page) => page.locator('.svelte-flow__node-queue');
const outside = (page: Page) => page.locator('.svelte-flow__node-outside');
const saved = (page: Page) =>
  page.waitForResponse(r => r.url().includes('/state?') && r.request().method() === 'POST' && r.ok());
const at = (x: number, y: number) => ({ x, y, run: 'cli', branch: 'main' });
const { orders, payments } = STACK.apps;
const stack = {
  ...STACK,
  queues: {
    'order-events': { name: 'Order events', type: 'sqs', queue: 'order-events-qa' },
    receipts: { name: 'Receipts', type: 'sns', queue: 'receipts-qa' },
  },
  apps: {
    ...STACK.apps,
    orders: { ...orders, publishes: { 'order-events': {}, receipts: {} } },
    payments: {
      ...payments,
      reads: { 'order-events': {} },
      consumes: { billing: { how: 'env', env: 'BILLING_URL' } },
    },
    billing: {
      name: 'Billing',
      kind: 'other',
      outside: 'a hosted service',
      deployedUrl: 'https://api.billing.example',
    },
  },
};
test.use({
  start: 'next/',
  stack,
  board: {
    env: 'qa',
    mode: 'auto',
    zoom: 0.8,
    pan: { x: 60, y: 40 },
    nodes: { orders: at(0, 0), payments: at(700, 0) },
    edges: [],
  },
});

test('a queue between two apps shows as a card linked to both, and an outside system beside its caller', async ({
  page,
}) => {
  await expect(queue(page)).toHaveCount(2);
  const events = queue(page).filter({ hasText: 'Order events' });
  await expect(events).toContainText('SQS');
  await expect(events).toContainText("Shared with QA's reader");
  await expect(outside(page)).toHaveCount(1);
  await expect(outside(page)).toContainText('Billing');
  await expect(outside(page)).toContainText('QA: api.billing.example');
  // Orders API to each of its queues, the queue to its reader, and the call to Billing.
  await expect(page.locator('.links .flow.msg')).toHaveCount(3);
  await expect(page.locator('.links .flow.ext')).toHaveCount(1);
  await page.screenshot({ path: 'test-results/next-queues.png' });
});

test('a queue is switched to a local copy where Koppler can run one, and the choice is kept', async ({ page }) => {
  const events = queue(page).filter({ hasText: 'Order events' });
  const receipts = queue(page).filter({ hasText: 'Receipts' });
  await expect(receipts.getByRole('radio', { name: 'Local' })).toBeDisabled();
  const kept = saved(page);
  await events.getByRole('radio', { name: 'Local' }).check();
  await expect(events).not.toContainText('Shared with');
  await expect(page.locator('.links .flow.msg.local')).toHaveCount(2);
  await kept;
  await page.reload();
  await expect(queue(page).filter({ hasText: 'Order events' }).getByRole('radio', { name: 'Local' })).toBeChecked();
});

test("a queue is hidden from its card, and an app's Queues switch hides or brings back all of its queues", async ({
  page,
}) => {
  await queue(page).filter({ hasText: 'Receipts' }).getByRole('button', { name: 'Hide Receipts' }).click();
  await expect(queue(page)).toHaveCount(1);
  await card(page, 'orders').getByRole('button', { name: 'Show 1 hidden' }).click();
  await expect(queue(page)).toHaveCount(2);
  const all = card(page, 'orders').getByRole('switch', { name: "Show Orders API's queues" });
  await all.uncheck();
  await expect(queue(page)).toHaveCount(0);
  await expect(page.locator('.links .flow.msg')).toHaveCount(0);
  await all.check();
  await expect(queue(page)).toHaveCount(2);
});

test('a card lists the apps it still calls in the deployed environment, and a click runs one locally too', async ({
  page,
}) => {
  const calls = card(page, 'orders').locator('.calls');
  await expect(calls).toContainText('Calls QA');
  await expect(calls.getByRole('button')).toHaveText(['Payments API', 'Catalog API']);
  await calls.getByRole('button', { name: 'Catalog API' }).click();
  await expect(card(page, 'catalog')).toBeVisible();
  await expect(page.locator('.svelte-flow__edge[data-id="orders>catalog"]')).toHaveCount(1);
  await calls.getByRole('button', { name: 'Payments API' }).click();
  await expect(page.locator('.svelte-flow__edge[data-id="orders>payments"]')).toHaveCount(1);
  await expect(calls).toHaveCount(0);
});
