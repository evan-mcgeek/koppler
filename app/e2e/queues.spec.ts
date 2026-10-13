// The new canvas's queue cards, outside systems and the apps a card still calls in the deployed environment.
import type { Page } from '@playwright/test';
import { test, expect, STACK } from './canvas.ts';

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

test("a queue is hidden from its card; an app's Queues switch takes only that app off its queues", async ({
  page,
  canvas,
}) => {
  await queue(page).filter({ hasText: 'Receipts' }).getByRole('button', { name: 'Hide Receipts' }).click();
  await expect(queue(page)).toHaveCount(1);
  await card(page, 'orders').getByRole('button', { name: 'Show 1 hidden' }).click();
  await expect(queue(page)).toHaveCount(2);

  // Order events is between Orders API and Payments API; Receipts is Orders API's alone.
  const ofOrders = card(page, 'orders').getByRole('switch', { name: "Show Orders API's queues" });
  const ofPayments = card(page, 'payments').getByRole('switch', { name: "Show Payments API's queues" });
  await expect(page.locator('.links .flow.msg')).toHaveCount(3);
  const kept = saved(page);
  await ofOrders.uncheck();
  // Its own queue goes, and so does its link to the shared one; that one stays for Payments API, whose switch is still on.
  await expect(queue(page)).toHaveText([/Order events/]);
  await expect(page.locator('.links .flow.msg')).toHaveCount(1);
  await expect(ofPayments).toBeChecked();
  await page.screenshot({ path: 'test-results/next-queues-one-off.png' });
  await kept;
  await page.reload();
  await expect(ofOrders).not.toBeChecked();
  await expect(queue(page)).toHaveCount(1);
  const state = (await (await page.request.get(`${canvas.url}data/state.json`)).json()) as {
    nodes: Record<string, { hideQueues?: boolean }>;
  };
  expect(state.nodes['orders']?.hideQueues).toBe(true);
  expect(state.nodes['payments']?.hideQueues).toBeUndefined();

  // With both off the shared queue leaves the board; either one brings it back.
  await ofPayments.uncheck();
  await expect(queue(page)).toHaveCount(0);
  await ofOrders.check();
  await expect(queue(page)).toHaveCount(2);
  await expect(page.locator('.links .flow.msg')).toHaveCount(2);
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

test('a queue card is joined to its own app on whichever side of the app it is moved to', async ({ page }) => {
  const events = queue(page).filter({ hasText: 'Order events' });
  const link = page.locator('.links .flow.msg .wire').first();
  const app = await card(page, 'orders').boundingBox();
  if (!app) throw new Error('no card');
  /** The end of the link at the app, as a place on the screen. */
  const start = () =>
    link.evaluate(el => {
      const path = el as SVGPathElement;
      const at = path.getPointAtLength(0).matrixTransform(path.getScreenCTM() ?? new DOMMatrix());
      return [Math.round(at.x), Math.round(at.y)];
    });
  const moveTo = async (x: number, y: number) => {
    const box = await events.boundingBox();
    if (!box) throw new Error('no queue card');
    await page.mouse.move(box.x + 30, box.y + 12);
    await page.mouse.down();
    await page.mouse.move(x + 30, y + 12, { steps: 8 });
    await page.mouse.up();
  };
  const [right, bottom] = [Math.round(app.x + app.width), Math.round(app.y + app.height)];
  // Under the app: the link leaves the app's bottom edge.
  await moveTo(app.x, bottom + 60);
  expect(Math.abs(((await start())[1] ?? 0) - bottom)).toBeLessThanOrEqual(1);
  // To its right, level with it: the right edge.
  await moveTo(right + 80, app.y + 40);
  expect(Math.abs(((await start())[0] ?? 0) - right)).toBeLessThanOrEqual(1);
});
