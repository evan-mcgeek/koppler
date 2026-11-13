// `koppler export`: the team's flows as one file, opened straight from disk with nothing else to load, to read.
import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { expect, test } from '@playwright/test';
import { STACK } from './canvas.ts';

const entry = path.join(path.dirname(fileURLToPath(import.meta.url)), '..', 'dist', 'koppler.mjs');
const step = (from: string, to: string, note?: string) => ({ from, to, kind: 'call', ...(note && { note }) });
const stack = {
  ...STACK,
  apps: { ...STACK.apps, orders: { ...STACK.apps.orders, description: 'Keeps every order' } },
  presets: [
    {
      name: 'Checkout',
      version: 1,
      nodes: {},
      edges: [],
      feature: {
        request: 'A customer pays for the order.',
        cards: [],
        phases: [
          { name: 'Order', steps: [step('web', 'orders', 'Sends the order')] },
          {
            name: 'Pay',
            steps: [step('orders', 'payments', 'Takes the money'), { ...step('payments', 'search'), proposed: true }],
          },
        ],
      },
      discover: { open: [], at: { web: { x: 0, y: 0 }, orders: { x: 300, y: 0 }, payments: { x: 600, y: 120 } } },
    },
    {
      name: 'Browse',
      version: 1,
      nodes: {},
      edges: [],
      feature: {
        request: 'A customer looks around.',
        cards: [],
        phases: [{ name: 'Look', steps: [step('web', 'catalog')] }],
      },
    },
  ],
};

test("the exported page is Discover to read: the flows, their walk-through, cards that move, the reader's scheme, and nothing loaded", async ({
  page,
}) => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'koppler-export-'));
  fs.writeFileSync(path.join(dir, 'stack.json'), JSON.stringify(stack));
  const file = path.join(dir, 'flows.html');
  const made = spawnSync(process.execPath, [entry, 'export', file, '--stack', dir], { encoding: 'utf8' });
  expect(made.status, made.stderr).toBe(0);
  expect(made.stdout).toContain('2 flows');
  const html = fs.readFileSync(file, 'utf8');
  // The stack's addresses, ids of its repos and its settings never reach the page.
  for (const kept of Object.values(STACK.apps).flatMap(one => [
    one.slug,
    ...('deployedUrl' in one ? [String(one.deployedUrl)] : []),
  ]))
    expect(html).not.toContain(kept);

  const asked: string[] = [];
  await page.route('**/*', route => {
    if (!route.request().url().startsWith('file:')) asked.push(route.request().url());
    return route.request().url().startsWith('file:') ? route.continue() : route.abort();
  });
  const errors: string[] = [];
  page.on('pageerror', error => errors.push(error.message));
  await page.goto(`file://${file}`);

  // Discover itself: the flow's steps on the left, its map, and the bar says it is to read.
  const header = page.getByRole('banner');
  await expect(header).toContainText('View only');
  await expect(header).toContainText('Made with koppler');
  const steps = page.getByRole('complementary', { name: 'Checkout' });
  await expect(steps).toContainText('A customer pays for the order.');
  const cards = page.locator('.svelte-flow__node');
  // The agent's proposal is no step of the flow, and its card is not drawn.
  await expect(cards).toHaveCount(3);
  await expect(page.locator('.svelte-flow__node[data-id="search"]')).toHaveCount(0);
  // Nothing on it changes the flow.
  for (const name of ['Rename Order', 'Remove Order', 'Comment', 'Add a phase', 'Take step 1.1 off'])
    await expect(page.getByRole('button', { name, exact: true })).toHaveCount(0);
  await expect(page.locator('textarea, input[type="text"]')).toHaveCount(0);
  await page.screenshot({ path: 'test-results/export.png' });

  // A picked card says what it does, and nothing of where it runs.
  await page.locator('.svelte-flow__node[data-id="orders"]').click();
  const about = page.getByRole('complementary', { name: 'Orders API' });
  await expect(about).toContainText('Keeps every order');
  await expect(about).not.toContainText('On GitHub');
  await expect(page.getByRole('button', { name: 'Plan a run with these' })).toHaveCount(0);
  await about.getByRole('button', { name: 'Close' }).click();

  await steps.getByRole('button', { name: 'Walk through the steps' }).click();
  await expect(page.getByRole('status', { name: 'Step 1.1' })).toContainText('Web Shop → Orders API');
  await page.keyboard.press('ArrowRight');
  await expect(page.getByRole('status', { name: 'Step 2.1' })).toContainText('Takes the money');
  await expect(steps.locator('button.phase[aria-pressed="true"]')).toHaveText(/Pay/);
  await page.keyboard.press('Escape');
  await expect(page.getByRole('status', { name: /^Step / })).toHaveCount(0);

  // A card moves where it is dragged, and its links follow.
  const orders = page.locator('.svelte-flow__node[data-id="orders"]');
  const before = await orders.boundingBox();
  const links = () => page.locator('.links').innerHTML();
  const drawn = await links();
  if (!before) throw new Error('no Orders API card');
  await page.mouse.move(before.x + 30, before.y + 20);
  await page.mouse.down();
  await page.mouse.move(before.x + 30, before.y + 140, { steps: 8 });
  await page.mouse.up();
  await expect.poll(async () => (await orders.boundingBox())?.y ?? 0).toBeGreaterThan(before.y + 60);
  expect(await links()).not.toBe(drawn);

  // The other flow, from the bar; one its author never arranged is laid out for the page.
  await header.getByRole('button', { name: 'Flows' }).click();
  await page.getByRole('menuitem', { name: 'Browse' }).click();
  await expect(page.getByRole('complementary', { name: 'Browse' })).toContainText('A customer looks around.');
  await expect(page.locator('.svelte-flow__node[data-id="catalog"]')).toBeInViewport();
  await page.screenshot({ path: 'test-results/export-browse.png' });

  // The scheme is the reader's to pick, and this browser keeps it.
  await header.getByRole('button', { name: 'Scheme' }).click();
  await page.getByRole('menuitem', { name: 'Paper' }).click();
  await expect(page.locator('html')).toHaveAttribute('data-scheme', 'paper');
  await page.reload();
  await expect(page.locator('html')).toHaveAttribute('data-scheme', 'paper');

  expect(asked).toEqual([]);
  expect(errors).toEqual([]);
  fs.rmSync(dir, { recursive: true, force: true });
});
