// A board changed from the terminal while it is open: the canvas makes the change, says so, and keeps it.
import fs from 'node:fs';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { at, card, expect, test } from './canvas.ts';

const layout = { nodes: { web: { x: 0, y: 0 }, orders: { x: 420, y: 0 } } };
test.use({
  board: {
    env: 'qa',
    mode: 'auto',
    zoom: 0.8,
    pan: { x: 120, y: 60 },
    preset: 'Shop',
    presets: [
      {
        name: 'Shop',
        version: 1,
        nodes: { web: { run: 'cli' }, orders: { run: 'cli' } },
        edges: [{ from: 'web', to: 'orders' }],
        layout,
      },
    ],
    nodes: { web: at(0, 0), orders: at(420, 0) },
    edges: [{ from: 'web', to: 'orders', fromSide: 'right', toSide: 'left' }],
  },
});

const koppler = ({ dir, temp }: { dir: string; temp: string }, ...args: string[]) => {
  const entry = path.join(path.dirname(fileURLToPath(import.meta.url)), '..', 'dist', 'koppler.mjs');
  const env = {
    ...process.env,
    KOPPLER_STATE: path.join(dir, 'state'),
    KOPPLER_TEMP: temp,
    KOPPLER_CONFIG_DIR: path.join(dir, 'config'),
  };
  const run = spawnSync(process.execPath, [entry, ...args], { encoding: 'utf8', env });
  expect(run.status, run.stderr).toBe(0);
};
const state = (temp: string) =>
  JSON.parse(fs.readFileSync(path.join(temp, 'state.json'), 'utf8')) as {
    nodes: Record<string, { branch?: string }>;
    presets: { name: string; nodes: Record<string, unknown> }[];
  };
const waiting = (temp: string) =>
  (JSON.parse(fs.readFileSync(path.join(temp, 'board-edits.json'), 'utf8')) as { edits: unknown[] }).edits.length;

test('the board on screen takes the change as it comes, and the cards it does not touch stay put', async ({
  page,
  canvas,
}) => {
  await expect(card(page, 'web')).toBeVisible();
  const web = await card(page, 'web').boundingBox();
  koppler(
    canvas,
    'board',
    'edit',
    'Shop',
    '--add',
    'payments',
    '--cable',
    'orders:payments',
    '--branch',
    'web=feature/checkout',
  );
  await expect(card(page, 'payments')).toBeVisible();
  await expect(page.getByRole('status')).toContainText(
    'The agent changed Shop: added Payments API; cabled Orders API to Payments API; Web Shop on feature/checkout.',
  );
  await expect(page.locator('.svelte-flow__edge')).toHaveCount(2);
  await expect(card(page, 'web').getByLabel('Branch')).toHaveValue('feature/checkout');
  expect(await card(page, 'web').boundingBox()).toEqual(web);
  await expect.poll(() => waiting(canvas.temp)).toBe(0);
  // The page keeps it, so its own copy never goes back over the change.
  await expect.poll(() => Object.keys(state(canvas.temp).nodes).sort()).toEqual(['orders', 'payments', 'web']);
  expect(state(canvas.temp).nodes['web']?.branch).toBe('feature/checkout');
  await page.screenshot({ path: 'test-results/next-board-edit.png' });
  await page.reload();
  await expect(card(page, 'payments')).toBeVisible();
  expect(await card(page, 'web').boundingBox()).toEqual(web);
});

test('a board that is not on screen is changed where it is kept', async ({ page, canvas }) => {
  await expect(card(page, 'web')).toBeVisible();
  koppler(canvas, 'board', 'edit', 'Checkout', '--remove', 'payments');
  await expect(page.getByRole('status')).toContainText('The agent changed Checkout: removed Payments API.');
  await expect.poll(() => waiting(canvas.temp)).toBe(0);
  await expect(page.locator('.svelte-flow__node-app')).toHaveCount(2);
  await expect
    .poll(() => Object.keys(state(canvas.temp).presets.find(one => one.name === 'Checkout')?.nodes ?? {}))
    .toEqual(['web', 'orders']);
});

test('a board made from the terminal joins your boards on an open canvas, which says so and keeps it', async ({
  page,
  canvas,
}) => {
  await expect(card(page, 'web')).toBeVisible();
  koppler(canvas, 'board', 'new', 'Orders work', '--add', 'orders,payments', '--cable', 'orders:payments');
  await expect(page.getByRole('status').filter({ hasText: 'The agent made a board, Orders work.' })).toBeVisible();
  await expect.poll(() => waiting(canvas.temp)).toBe(0);
  // The board on screen stays as it was; the new one is among the user's, with its apps and cable.
  await expect(page.locator('.svelte-flow__node-app')).toHaveCount(2);
  await expect
    .poll(() => state(canvas.temp).presets.find(one => one.name === 'Orders work')?.nodes)
    .toEqual({ orders: { run: 'cli' }, payments: { run: 'cli' } });
});

test('an edit with --arrange lays the board on screen out along its calls, as Arrange does', async ({
  page,
  canvas,
}) => {
  await expect(card(page, 'web')).toBeVisible();
  koppler(canvas, 'board', 'edit', 'Shop', '--add', 'payments', '--cable', 'orders:payments', '--arrange');
  await expect(card(page, 'payments')).toBeVisible();
  await expect.poll(() => waiting(canvas.temp)).toBe(0);
  // Web calls Orders, which calls Payments: laid out top-down in that order, each card clear of the one above.
  await expect
    .poll(async () => {
      const [web, orders, payments] = await Promise.all(
        ['web', 'orders', 'payments'].map(async id => card(page, id).boundingBox()),
      );
      return !!web && !!orders && !!payments && web.y + web.height < orders.y && orders.y + orders.height < payments.y;
    })
    .toBe(true);
});

test('koppler refresh has an open canvas read the stack and its board again, without reloading the page', async ({
  page,
  canvas,
}) => {
  await expect(card(page, 'web')).toContainText('Web Shop');
  await page.evaluate(() => ((window as { stayed?: boolean }).stayed = true));
  // A change made outside the canvas: the run copy of the stack, as a sync leaves it.
  const file = path.join(canvas.temp, 'registry.json');
  const stack = JSON.parse(fs.readFileSync(file, 'utf8')) as { apps: Record<string, { name: string }> };
  stack.apps['web'] = { ...stack.apps['web'], name: 'Storefront' };
  fs.writeFileSync(file, JSON.stringify(stack));
  koppler(canvas, 'refresh', '--no-sync');
  await expect(card(page, 'web')).toContainText('Storefront');
  expect(await page.evaluate(() => (window as { stayed?: boolean }).stayed)).toBe(true);
});

test('a proposed change waits for a yes in the inbox: accepted it is made, declined nothing changes', async ({
  page,
  canvas,
}) => {
  await expect(card(page, 'web')).toBeVisible();
  koppler(canvas, 'board', 'edit', 'Shop', '--add', 'payments', '--cable', 'orders:payments', '--propose');
  expect(Object.keys(state(canvas.temp).presets[0]?.nodes ?? {})).toEqual(['web', 'orders']);
  const panel = page.getByRole('dialog', { name: 'Messages from the agent' });
  await expect(panel.getByRole('heading', { level: 3 }).first()).toHaveText('Change Shop?');
  await expect(panel).toContainText('add Payments API');
  await expect(panel).toContainText('cable Orders API to Payments API');
  await expect(card(page, 'payments')).toHaveCount(0);
  await page.screenshot({ path: 'test-results/next-proposal.png' });
  await panel.getByRole('button', { name: /Make the change/ }).click();
  await expect(card(page, 'payments')).toBeVisible();
  await expect(page.locator('.svelte-flow__edge[data-id="orders>payments"]')).toHaveCount(1);

  koppler(canvas, 'board', 'edit', 'Shop', '--remove', 'web', '--propose');
  await expect(panel).toContainText('remove Web Shop');
  await panel.getByRole('button', { name: /Leave it as it is/ }).click();
  await expect(panel.getByRole('button', { name: /Leave it as it is/ })).toHaveCount(0);
  await expect(card(page, 'web')).toBeVisible();
  expect(Object.keys(state(canvas.temp).presets[0]?.nodes ?? {})).toContain('web');
});

test('a board opened from a file in the terminal shows on the canvas, and Reload reads the file again', async ({
  page,
  canvas,
}) => {
  await expect(card(page, 'web')).toBeVisible();
  const file = path.join(canvas.dir, 'payments.json');
  const write = (nodes: Record<string, unknown>) => {
    fs.writeFileSync(file, JSON.stringify({ name: 'Payments flow', version: 1, nodes, edges: [] }));
  };
  write({ orders: { run: 'cli' } });
  koppler(canvas, 'board', 'open', file, '--no-open');
  await expect(page.getByRole('status').filter({ hasText: 'Opened Payments flow from the terminal.' })).toBeVisible();
  await expect(page.getByRole('button', { name: /^Board: Payments flow/ })).toBeVisible();
  await expect(card(page, 'web')).toHaveCount(0);
  await expect(card(page, 'orders')).toBeVisible();

  write({ orders: { run: 'cli' }, payments: { run: 'cli' } });
  await page.getByRole('button', { name: /^Board: Payments flow/ }).click();
  await page.getByRole('button', { name: 'Reload Payments flow' }).click();
  await expect(card(page, 'payments')).toBeVisible();
  await expect(page.getByRole('status').filter({ hasText: 'Reloaded Payments flow' })).toBeVisible();
});
