// Scenes of the canvas for the docs, on a demo stack: nothing here reads a real stack.
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import type { Page } from '@playwright/test';
import { actions, card, expect, STACK, test } from '../e2e/canvas.ts';

const images = path.join(path.dirname(fileURLToPath(import.meta.url)), '..', '..', 'docs', 'images');
// A hint left open by where the pointer rests is not part of the picture.
const shot = async (page: Page, name: string, clip?: { x: number; y: number; width: number; height: number }) => {
  await page.evaluate(() => {
    for (const tip of document.querySelectorAll<HTMLElement>('[role=tooltip]:popover-open')) tip.hidePopover();
  });
  await page.screenshot({ path: path.join(images, `${name}.png`), ...(clip && { clip }) });
};

const { web = {}, orders = {}, payments = {}, catalog = {} } = STACK.apps;
type Apps = Record<string, Record<string, unknown>>;
const stack: { queues: object; databases: object; apps: Apps } & typeof STACK = {
  ...STACK,
  queues: { 'order-events': { name: 'Order events', type: 'sqs', queue: 'order-events-qa' } },
  // One tunnel to the Aurora cluster, with each API's database behind it.
  databases: {
    'orders-db': { name: 'Orders', kind: 'postgres', tunnel: 'aurora.qa.acme.example', port: 5432 },
    'payments-db': { name: 'Payments', kind: 'postgres', tunnel: 'aurora.qa.acme.example', port: 5432 },
  },
  apps: {
    mobile: {
      name: 'Mobile App',
      kind: 'flutter',
      slug: 'acme/mobile-app',
      consumes: { orders: { how: 'env', env: 'ORDERS_URL' } },
    },
    web,
    orders: { ...orders, prereqs: [], envs: {}, publishes: { 'order-events': {} }, uses: { 'orders-db': {} } },
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
    orders: { ...at(560, 0), note: 'Seed two test orders after it starts' },
    payments: { ...at(1160, 0), note: 'Use the sandbox merchant account, not the live one' },
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

test('the board, running', async ({ page }) => {
  await running(page);
  await healthy(page);
  await page.reload();
  await settle(page);
  await shot(page, 'board');
});

test('the board, running, in the Live view', async ({ page }) => {
  await running(page);
  await healthy(page);
  await page.reload();
  await settle(page);
  await page.getByRole('radio', { name: 'Live' }).click();
  await page.mouse.move(1430, 850);
  await page.waitForTimeout(900);
  await shot(page, 'live');
});

test('the review before a Run', async ({ page }) => {
  await ready(page);
  await page.reload();
  await settle(page);
  await page.getByRole('button', { name: 'Run', exact: true }).click();
  const review = page.getByRole('dialog');
  await expect(review.getByRole('heading')).toHaveText('Run on QA');
  await page.waitForTimeout(400);
  const box = await review.boundingBox();
  if (!box) throw new Error('no review');
  await shot(page, 'review', { x: box.x - 24, y: box.y - 24, width: box.width + 48, height: box.height + 48 });
});

test('a card, running', async ({ page }) => {
  await running(page);
  await healthy(page);
  await page.reload();
  await settle(page);
  await (await actions(page, 'orders')).waitFor();
  await page.waitForTimeout(400);
  const box = await card(page, 'orders').boundingBox();
  if (!box) throw new Error('no card');
  await shot(page, 'card', { x: box.x - 40, y: box.y - 64, width: box.width + 80, height: box.height + 104 });
});

test("an app's settings", async ({ page }) => {
  await settle(page);
  await (await actions(page, 'orders')).getByRole('button', { name: 'Settings for Orders API' }).click();
  const panel = page.getByRole('dialog', { name: 'Orders API' });
  await expect(panel).toBeVisible();
  await page.waitForTimeout(400);
  const box = await panel.boundingBox();
  if (!box) throw new Error('no settings');
  await shot(page, 'settings', { x: box.x - 24, y: box.y - 24, width: box.width + 48, height: box.height + 48 });
});

test.describe('zoomed out', () => {
  test.use({ board: { ...board, zoom: 0.5, pan: { x: 120, y: 120 } } });
  test("a picked card's choices beside the board", async ({ page }) => {
    await running(page);
    await healthy(page);
    await page.reload();
    await settle(page);
    await card(page, 'orders').locator('header').click();
    await expect(page.getByRole('complementary', { name: 'Orders API' })).toBeVisible();
    await page.mouse.move(700, 850);
    await page.waitForTimeout(600);
    await shot(page, 'zoomed-out');
  });
});

// Two APIs whose databases sit behind one tunnel to the Aurora cluster.
test.describe('databases', () => {
  const { apps } = stack;
  const alone = (id: string, uses: string) => {
    const { publishes: _p, reads: _r, consumes: _c, ...app } = apps[id] ?? {};
    return { ...app, uses: { [uses]: {} } };
  };
  test.use({
    stack: {
      ...stack,
      queues: {},
      apps: { orders: alone('orders', 'orders-db'), payments: alone('payments', 'payments-db') },
    },
    board: {
      env: 'qa',
      mode: 'auto',
      zoom: 0.62,
      pan: { x: 80, y: 90 },
      nodes: { orders: { ...at(0, 0), showQueues: false }, payments: { ...at(760, 0), showQueues: false } },
      edges: [],
    },
  });
  test('behind their tunnel', async ({ page }) => {
    await running(page);
    await healthy(page);
    await page.reload();
    await settle(page);
    await expect(page.locator('.svelte-flow__node-database')).toHaveCount(2);
    const boxes = (
      await Promise.all((await page.locator('.svelte-flow__node').all()).map(one => one.boundingBox()))
    ).flatMap(one => one ?? []);
    const x = Math.min(...boxes.map(one => one.x)) - 32;
    const y = Math.min(...boxes.map(one => one.y)) - 32;
    const width = Math.max(...boxes.map(one => one.x + one.width)) + 32 - x;
    const height = Math.max(...boxes.map(one => one.y + one.height)) + 32 - y;
    await shot(page, 'databases', { x, y, width, height });
  });
});
