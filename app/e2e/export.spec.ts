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

test('the exported page shows the flows, walks their steps, and lets cards be moved, with nothing loaded', async ({
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

  const flows = page.getByRole('navigation', { name: 'Flows' });
  await expect(flows.getByRole('button')).toHaveText([/Checkout\s*2 steps/, /Browse\s*1 step/]);
  await expect(page.getByRole('img', { name: 'Web Shop, Service' })).toBeVisible();
  // The agent's proposal is no step of the flow, and its card is not drawn.
  await expect(page.locator('.card')).toHaveCount(3);
  const steps = page.getByRole('complementary', { name: 'Steps' });
  await expect(steps).toContainText('A customer pays for the order.');
  await page.screenshot({ path: 'test-results/export.png' });

  await steps.getByRole('button', { name: 'Walk through the steps' }).click();
  const bar = page.getByRole('status', { name: 'Step 1.1' });
  await expect(bar).toContainText('Web Shop to Orders API: Sends the order');
  await page.keyboard.press('ArrowRight');
  await expect(page.getByRole('status', { name: 'Step 2.1' })).toContainText('Takes the money');
  await expect(page.locator('.card.dim')).toHaveCount(1);
  await page.keyboard.press('Escape');
  await expect(page.getByRole('status', { name: /^Step / })).toHaveCount(0);

  // A card moves where it is dragged, and its link follows.
  const orders = page.getByRole('img', { name: /^Orders API/ });
  const before = await orders.boundingBox();
  const link = await page.locator('.link path').first().getAttribute('d');
  if (!before) throw new Error('no Orders API card');
  await page.mouse.move(before.x + 30, before.y + 20);
  await page.mouse.down();
  await page.mouse.move(before.x + 30, before.y + 120, { steps: 6 });
  await page.mouse.up();
  expect((await orders.boundingBox())?.y).toBeGreaterThan(before.y + 60);
  expect(await page.locator('.link path').first().getAttribute('d')).not.toBe(link);

  // A flow its author never arranged is laid out for the page.
  await flows.getByRole('button', { name: /Browse/ }).click();
  await expect(page.getByRole('img', { name: 'Catalog API, Service' })).toBeInViewport();
  await page.screenshot({ path: 'test-results/export-browse.png' });
  // Zoomed in, the map grows about its middle: the cards there stay in view.
  await page.getByRole('button', { name: 'Zoom in' }).click();
  await expect(page.getByRole('img', { name: 'Catalog API, Service' })).toBeInViewport();
  await expect(page.getByRole('img', { name: 'Web Shop, Service' })).toBeInViewport();

  expect(asked).toEqual([]);
  expect(errors).toEqual([]);
  fs.rmSync(dir, { recursive: true, force: true });
});
