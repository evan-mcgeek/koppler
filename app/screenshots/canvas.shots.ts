// Scenes of the canvas for the docs, on a demo stack: nothing here reads a real stack.
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import type { Page, TestInfo } from '@playwright/test';
import { actions, card, expect, STACK, test } from '../e2e/canvas.ts';

const images = path.join(path.dirname(fileURLToPath(import.meta.url)), '..', '..', 'docs', 'images');
const shot = (
  page: Page,
  info: TestInfo,
  name: string,
  clip?: { x: number; y: number; width: number; height: number },
) => page.screenshot({ path: path.join(images, `${name}-${info.project.name}.png`), ...(clip && { clip }) });

const { web = {}, orders = {}, payments = {}, catalog = {} } = STACK.apps;
type Apps = Record<string, Record<string, unknown>>;
const stack: { queues: object; apps: Apps } & typeof STACK = {
  ...STACK,
  queues: { 'order-events': { name: 'Order events', type: 'sqs', queue: 'order-events-qa' } },
  apps: {
    mobile: {
      name: 'Mobile App',
      kind: 'flutter',
      slug: 'acme/mobile-app',
      consumes: { orders: { how: 'env', env: 'ORDERS_URL' } },
    },
    web,
    orders: { ...orders, publishes: { 'order-events': {} } },
    payments: {
      ...payments,
      reads: { 'order-events': {} },
      consumes: { provider: { how: 'env', env: 'PROVIDER_URL' } },
    },
    catalog,
    provider: {
      name: 'Payment provider',
      kind: 'other',
      outside: 'a hosted service',
      deployedUrl: 'https://api.pay.example',
    },
  },
};
// One feature, worked on across the apps it touches: each runs its feature branch.
const at = (x: number, y: number) => ({ x, y, run: 'cli', branch: 'feature/checkout', showQueues: true });
const board = {
  env: 'qa',
  mode: 'auto',
  zoom: 0.72,
  pan: { x: 48, y: 120 },
  nodes: {
    mobile: { ...at(0, 0), platform: 'ios' },
    web: at(0, 480),
    orders: { ...at(560, 200), note: 'Seed two test orders after it starts' },
    payments: { ...at(1160, 200), note: 'Use the sandbox merchant account, not the live one' },
  },
  queues: { 'order-events': 'local' },
  edges: [
    { from: 'mobile', to: 'orders', fromSide: 'right', toSide: 'left' },
    { from: 'web', to: 'orders', fromSide: 'right', toSide: 'left' },
    { from: 'orders', to: 'payments', fromSide: 'right', toSide: 'left' },
  ],
};
const done = [
  { label: 'Branch', state: 'done' },
  { label: 'Tunnels', state: 'done' },
  { label: 'Start', state: 'done', detail: 'Running.' },
];
/** Every app of the board runs and answers, as after a Run. */
const running = (page: Page) =>
  page.route('**/data/status.json', route =>
    route.fulfill({
      json: {
        live: { env: 'qa', nodes: Object.fromEntries(Object.keys(board.nodes).map(id => [id, {}])) },
        apps: {
          mobile: { running: [{ device: 'iPhone 16', platform: 'ios', source: 'koppler' }], steps: done },
          web: { listening: true, steps: done },
          orders: { listening: true, steps: done },
          payments: { listening: true, steps: done },
        },
        ports: { '5432': true },
        agent,
      },
    }),
  );
const agent = { state: 'listening', who: { name: 'Checkout flow', agent: 'Claude Code' } };
/** Nothing runs yet, and an agent session is connected. */
const ready = (page: Page) =>
  page.route('**/data/status.json', route =>
    route.fulfill({ json: { live: { env: 'qa', nodes: {} }, apps: {}, agent } }),
  );
/** Each connection check passes, as on a board that works. */
const healthy = (page: Page) =>
  page.route('**/cable-test?*', route =>
    route.fulfill({ json: { ok: true, text: 'Answers, 4 ms', detail: 'It answers on its local address.' } }),
  );
/** Drawn where the board was left, the pointer out of the way. */
const settle = async (page: Page) => {
  await expect(card(page, 'orders')).toBeVisible();
  await page.mouse.move(1430, 850);
  await page.waitForTimeout(900);
};

test.use({ stack, board });

test('the board, running', async ({ page }, info) => {
  await running(page);
  await healthy(page);
  await page.reload();
  await settle(page);
  await shot(page, info, 'board');
});

test('the board, running, in the Live view', async ({ page }, info) => {
  await running(page);
  await healthy(page);
  await page.reload();
  await settle(page);
  await page.getByRole('radio', { name: 'Live' }).click();
  await page.mouse.move(1430, 850);
  await page.waitForTimeout(900);
  await shot(page, info, 'live');
});

test('the review before a Run', async ({ page }, info) => {
  await ready(page);
  await page.reload();
  await settle(page);
  await page.getByRole('button', { name: 'Run', exact: true }).click();
  const review = page.getByRole('dialog');
  await expect(review.getByRole('heading')).toHaveText('Run on QA');
  await page.waitForTimeout(400);
  const box = await review.boundingBox();
  if (!box) throw new Error('no review');
  await shot(page, info, 'review', { x: box.x - 24, y: box.y - 24, width: box.width + 48, height: box.height + 48 });
});

test('a card, running', async ({ page }, info) => {
  await running(page);
  await healthy(page);
  await page.reload();
  await settle(page);
  await (await actions(page, 'orders')).waitFor();
  await page.waitForTimeout(400);
  const box = await card(page, 'orders').boundingBox();
  if (!box) throw new Error('no card');
  await shot(page, info, 'card', { x: box.x - 40, y: box.y - 64, width: box.width + 80, height: box.height + 104 });
});

test("an app's settings", async ({ page }, info) => {
  await settle(page);
  await (await actions(page, 'orders')).getByRole('button', { name: 'Settings for Orders API' }).click();
  const panel = page.getByRole('dialog', { name: 'Orders API' });
  await expect(panel).toBeVisible();
  await page.waitForTimeout(400);
  const box = await panel.boundingBox();
  if (!box) throw new Error('no settings');
  await shot(page, info, 'settings', { x: box.x - 24, y: box.y - 24, width: box.width + 48, height: box.height + 48 });
});

test.describe('zoomed out', () => {
  test.use({ board: { ...board, zoom: 0.5, pan: { x: 120, y: 120 } } });
  test("a picked card's choices beside the board", async ({ page }, info) => {
    await running(page);
    await healthy(page);
    await page.reload();
    await settle(page);
    await card(page, 'orders').locator('header').click();
    await expect(page.getByRole('complementary', { name: 'Orders API' })).toBeVisible();
    await page.mouse.move(700, 850);
    await page.waitForTimeout(600);
    await shot(page, info, 'zoomed-out');
  });
});
