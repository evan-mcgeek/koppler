// A feature board: its request goes to the agent, whose proposed steps wait dashed until accepted on the map; steps
// are numbered in phases, and the panel changes them.
import fs from 'node:fs';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import type { Page } from '@playwright/test';
import { at, card, expect, nextEdit, sent, STACK, test, fromBoardMenu } from './canvas.ts';

const stack = {
  ...STACK,
  queues: { events: { name: 'Order events', type: 'sqs' } },
  apps: {
    ...STACK.apps,
    orders: { ...STACK.apps.orders, publishes: { events: {} } },
    payments: { ...STACK.apps.payments, reads: { events: {} } },
  },
};
test.use({
  stack,
  board: { env: 'qa', mode: 'auto', zoom: 1, pan: { x: 60, y: 60 }, nodes: { web: at(0, 0) }, edges: [] },
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
// The stack file itself, as `koppler init` set it up: accepting a step the stack misses records it there.
const stackFile = (dir: string) => {
  fs.mkdirSync(path.join(dir, 'stack'), { recursive: true });
  fs.mkdirSync(path.join(dir, 'config'), { recursive: true });
  fs.writeFileSync(path.join(dir, 'stack', 'stack.json'), JSON.stringify(stack));
  fs.writeFileSync(path.join(dir, 'config', 'config.json'), JSON.stringify({ stack: path.join(dir, 'stack') }));
  return () =>
    JSON.parse(fs.readFileSync(path.join(dir, 'stack', 'stack.json'), 'utf8')) as {
      apps: Record<string, { consumes?: Record<string, unknown> }>;
    };
};
const kept = (temp: string) =>
  (
    JSON.parse(fs.readFileSync(path.join(temp, 'state.json'), 'utf8')) as {
      presets?: {
        name: string;
        feature?: { request: string; phases: { steps: unknown[] }[] };
        discover?: { at?: Record<string, { x: number; y: number }> };
      }[];
    }
  ).presets?.find(one => one.name === 'New feature');
const newFeature = async (page: Page) => {
  await expect(card(page, 'web')).toBeVisible();
  await page.keyboard.press('ControlOrMeta+1');
  await page.getByRole('button', { name: /^Board:/ }).click();
  await page.getByRole('button', { name: 'Ask the agent for a new one…' }).click();
  await expect(page.getByRole('radio', { name: 'Discover' })).toBeChecked();
  await expect(page.getByRole('region', { name: 'New feature board' })).toBeVisible();
};

test('the request goes to the agent, and its proposals wait on the map until accepted', async ({ page, canvas }) => {
  const read = stackFile(canvas.dir);
  await newFeature(page);
  await page.getByLabel('Describe the feature').fill('Customers pay for an order and get a receipt.');
  await page.getByRole('button', { name: 'Hand it to the agent' }).click();
  await expect
    .poll(() => sent(canvas.temp).find(one => one.tag === 'koppler-feature')?.data)
    .toEqual({ board: 'New feature', request: 'Customers pay for an order and get a receipt.' });
  await expect.poll(() => kept(canvas.temp)?.feature?.request).toBe('Customers pay for an order and get a receipt.');
  await page.screenshot({ path: 'test-results/feature-start.png' });

  // The agent proposes, as the skill says.
  koppler(
    canvas,
    'board',
    'edit',
    'New feature',
    '--phase',
    'Pay',
    '--propose-step',
    'web:orders=The shop sends the order',
    '--propose-step',
    'orders:queue:events',
    '--phase',
    'Settle',
    '--propose-step',
    'queue:events:payments',
    '--propose-step',
    'web:payments=Shows the receipt',
  );
  const banner = page.getByRole('status').filter({ hasText: 'The agent proposed' });
  await expect(banner).toContainText('The agent proposed 4 cards and 4 links.');
  await expect(page.locator('.lean.proposed')).toHaveCount(4);
  await expect(page.locator('.links .number text')).toHaveText(['1.1', '1.2', '2.1', '2.2']);
  await expect(page.locator('.titles .phase .name')).toHaveText(['Pay', 'Settle']);
  await page.screenshot({ path: 'test-results/feature-proposed.png' });

  await card(page, 'orders').getByRole('button', { name: 'Accept Orders API' }).click();
  // Web Shop and the queue now have a step accepted; Payments API is still all proposal.
  await expect(page.locator('.lean.proposed')).toHaveCount(1);
  await banner.getByRole('button', { name: 'Accept all' }).click();
  await expect(banner).toHaveCount(0);
  // The one link the stack did not have is recorded there.
  await expect.poll(() => read().apps['web']?.consumes).toHaveProperty('payments');
  const panel = page.getByRole('complementary', { name: 'New feature' });
  await expect(panel).toContainText('Customers pay for an order and get a receipt.');
  await expect(panel).toContainText("Uses 4 of the stack's links.");
  await page.screenshot({ path: 'test-results/feature-board.png' });
});

test('steps are added from a card, taken off, and kept in phases the panel names', async ({ page, canvas }) => {
  await newFeature(page);
  await page.getByRole('button', { name: 'All apps…' }).click();
  await page.getByRole('button', { name: 'Web Shop' }).click();
  await expect(card(page, 'web')).toBeVisible();
  const panel = page.getByRole('complementary', { name: 'New feature' });
  await expect(panel).toContainText('No steps yet');

  // A feature board has no +N: a card's panel lists every link it has, and one becomes a step.
  await expect(card(page, 'web').getByRole('button', { name: /more links? of Web Shop/ })).toHaveCount(0);
  await card(page, 'web').click();
  const calls = page
    .getByRole('complementary', { name: 'Web Shop' })
    .locator('section')
    .filter({ has: page.getByRole('heading', { name: 'Calls' }) });
  await calls.locator('.item').filter({ hasText: 'Orders API' }).getByRole('button', { name: 'Add as a step' }).click();
  await expect(calls.locator('.item').filter({ hasText: 'Orders API' })).toContainText('Step 1.1');
  await page.keyboard.press('Escape');

  await panel.getByRole('button', { name: 'Rename Steps' }).click();
  await panel.getByLabel('Name of phase 1').fill('Check out');
  await panel.getByRole('button', { name: 'Done' }).click();
  await expect(panel.getByRole('button', { name: 'Check out', exact: true })).toBeVisible();
  await panel.getByRole('button', { name: 'Add a phase' }).click();
  await panel.getByLabel('Name of the new phase').fill('Ship');
  await panel.getByRole('button', { name: 'Add', exact: true }).click();
  await expect(panel.getByRole('button', { name: 'Ship', exact: true })).toBeVisible();

  await expect.poll(() => kept(canvas.temp)?.feature?.phases.length).toBe(2);
  await page.reload();
  await expect(page.getByRole('radio', { name: 'Discover' })).toBeChecked();
  await expect(page.locator('.links .number text')).toHaveText(['1.1']);
  await panel.locator('.step').hover();
  await panel.getByRole('button', { name: 'Take step 1.1 off' }).click();
  await expect(page.locator('.links .number text')).toHaveCount(0);
});

test('leaving a feature board for the whole stack is undone back to it, its request kept', async ({ page, canvas }) => {
  await newFeature(page);
  await nextEdit(page);
  await page.getByLabel('Describe the feature').fill('Customers pay for an order.');
  await page.getByRole('button', { name: 'Hand it to the agent' }).click();
  await expect.poll(() => kept(canvas.temp)?.feature?.request).toBe('Customers pay for an order.');
  await nextEdit(page);
  await page.getByRole('button', { name: /^Board:/ }).click();
  await page
    .getByRole('dialog', { name: 'Boards' })
    .getByRole('button', { name: /^Whole stack/ })
    .click();
  await expect(page.getByRole('button', { name: /^Board:/ })).toHaveText('Whole stack');
  await page.getByRole('button', { name: 'Undo', exact: true }).click();
  await expect(page.getByRole('button', { name: /^Board:/ })).toHaveAccessibleName('Board: New feature');
  await expect(page.getByLabel('Describe the feature')).toHaveValue('Customers pay for an order.');
});

test("a step's number on the map picks its row in the panel", async ({ page, canvas }) => {
  await newFeature(page);
  await page.getByLabel('Describe the feature').fill('Customers pay for an order.');
  await page.getByRole('button', { name: 'Hand it to the agent' }).click();
  await expect.poll(() => kept(canvas.temp)?.feature?.request).toBe('Customers pay for an order.');
  koppler(
    canvas,
    'board',
    'edit',
    'New feature',
    '--phase',
    'Pay',
    '--step',
    'web:orders',
    '--step',
    'orders:queue:events',
    '--phase',
    'Settle',
    '--step',
    'queue:events:payments',
    '--step',
    'web:payments=Pays the order with the saved card, and asks for a new one when it is declined',
  );
  const panel = page.getByRole('complementary', { name: 'New feature' });
  const row = (number: string) => panel.locator('.step').filter({ has: page.getByText(number, { exact: true }) });
  await expect(page.locator('.links .number text')).toHaveText(['1.1', '1.2', '2.1', '2.2']);
  await page.locator('.links .number').filter({ hasText: '2.2' }).click();
  await expect(row('2.2')).toHaveAttribute('aria-current', 'true');
  await expect(panel.locator('.step[aria-current]')).toHaveCount(1);
  await expect(row('2.2')).toBeInViewport();
  await page.screenshot({ path: 'test-results/feature-step-picked.png' });
  await page.locator('.links .number').filter({ hasText: '1.1' }).click();
  await expect(row('1.1')).toHaveAttribute('aria-current', 'true');
  await expect(panel.locator('.step[aria-current]')).toHaveCount(1);
  // Clicked again, it lets go.
  await page.locator('.links .number').filter({ hasText: '1.1' }).click();
  await expect(panel.locator('.step[aria-current]')).toHaveCount(0);

  // Walked through: the arrows go step by step, stopping at either end, and the bar says each step.
  await panel.getByRole('button', { name: 'Walk through the steps' }).click();
  const bar = page.getByRole('status', { name: /^Step / });
  await expect(bar).toHaveAccessibleName('Step 1.1');
  await expect(bar).toContainText('Web Shop → Orders API');
  await expect(page.locator('.links .link:not(.faded)')).toHaveCount(1);
  await page.keyboard.press('ArrowLeft');
  await expect(bar).toHaveAccessibleName('Step 1.1');
  for (const number of ['1.2', '2.1', '2.2', '2.2']) {
    await page.keyboard.press('ArrowRight');
    await expect(bar).toHaveAccessibleName(`Step ${number}`);
    await expect(row(number)).toHaveAttribute('aria-current', 'true');
  }
  // Both ends of the step are brought into the map, clear of the panel.
  const edge = await page.getByLabel('Discover map').evaluate(el => el.getBoundingClientRect().right);
  await expect
    .poll(async () => {
      const box = await card(page, 'payments').boundingBox();
      return box ? box.x + box.width <= edge : false;
    })
    .toBe(true);
  await page.screenshot({ path: 'test-results/feature-step-walk.png' });
  // The cards the step does not touch dim, as the other links do.
  await expect(card(page, 'payments')).not.toHaveClass(/dimmed/);
  await expect(card(page, 'orders')).toHaveClass(/dimmed/);
  // The bar keeps its size from step to step, so the arrows stay under the pointer.
  const arrows = async () => JSON.stringify(await bar.getByRole('button', { name: 'Previous step' }).boundingBox());
  const at = await arrows();
  await page.keyboard.press('ArrowLeft');
  await expect(bar).toHaveAccessibleName('Step 2.1');
  expect(await arrows()).toBe(at);
  await page.keyboard.press('ArrowLeft');
  await expect(bar).toHaveAccessibleName('Step 1.2');
  expect(await arrows()).toBe(at);
  await page.keyboard.press('ArrowRight');
  await page.keyboard.press('ArrowRight');
  await expect(bar).toHaveAccessibleName('Step 2.2');
  await bar.getByRole('button', { name: 'Previous step' }).click();
  await expect(bar).toHaveAccessibleName('Step 2.1');
  await page.keyboard.press('Escape');
  await expect(bar).toHaveCount(0);
  await expect(page.locator('.links .link.faded')).toHaveCount(0);

  // The request, changed in the panel, stays as wide as the panel and grows with its words, not by a handle.
  await panel.getByTitle('Change the request').click();
  const request = panel.getByLabel('The request');
  await request.fill('Customers pay for an order.\n'.repeat(8));
  const box = await request.boundingBox();
  const room = await request.evaluate(el => {
    const around = getComputedStyle(el.parentElement as HTMLElement);
    return (
      (el.parentElement as HTMLElement).clientWidth - parseFloat(around.paddingLeft) - parseFloat(around.paddingRight)
    );
  });
  expect(box?.width).toBe(room);
  expect(box?.height).toBeGreaterThan(8 * 20);
  expect(await request.evaluate(el => getComputedStyle(el).resize)).toBe('none');
  await page.screenshot({ path: 'test-results/feature-request-grows.png' });
});

test('a feature board shared with the team keeps its steps and where its cards sit', async ({ page, canvas }) => {
  const read = stackFile(canvas.dir) as unknown as () => {
    presets?: { name: string; feature?: { request?: string }; discover?: { at: Record<string, { x: number }> } }[];
  };
  await newFeature(page);
  await page.getByLabel('Describe the feature').fill('Customers pay for an order.');
  await page.getByRole('button', { name: 'Hand it to the agent' }).click();
  await expect.poll(() => kept(canvas.temp)?.feature?.request).toBe('Customers pay for an order.');
  koppler(canvas, 'board', 'edit', 'New feature', '--phase', 'Pay', '--step', 'web:orders');
  await expect(page.locator('.links .number text')).toHaveText(['1.1']);
  const orders = card(page, 'orders');
  const box = await orders.boundingBox();
  if (!box) throw new Error('no Orders API card');
  await page.mouse.move(box.x + 40, box.y + 12);
  await page.mouse.down();
  await page.mouse.move(box.x + 40, box.y + 152, { steps: 8 });
  await page.mouse.up();
  await expect.poll(() => kept(canvas.temp)?.discover?.at?.['orders']).toBeTruthy();
  const placed = kept(canvas.temp)?.discover?.at?.['orders'];
  await page.getByRole('button', { name: /^Board: / }).click();
  await fromBoardMenu(page, 'New feature', 'Share with the team…');
  await page
    .getByRole('dialog', { name: 'Share New feature with the team' })
    .getByRole('button', { name: 'Add to team boards' })
    .click();
  await expect
    .poll(() => read().presets?.find(one => one.name === 'New feature')?.feature?.request)
    .toBe('Customers pay for an order.');
  expect(read().presets?.find(one => one.name === 'New feature')?.discover?.at['orders']).toEqual(placed);
});

test('one link is a step in two phases: both are walked, one is taken off, and a phase is removed', async ({
  page,
  canvas,
}) => {
  await newFeature(page);
  await page.getByLabel('Describe the feature').fill('Customers pay, and get a refund.');
  await page.getByRole('button', { name: 'Hand it to the agent' }).click();
  await expect.poll(() => kept(canvas.temp)?.feature?.request).toBe('Customers pay, and get a refund.');
  koppler(canvas, 'board', 'edit', 'New feature', '--phase', 'Order', '--step', 'web:orders=Places it');
  koppler(canvas, 'board', 'edit', 'New feature', '--phase', 'Refund', '--step', 'web:orders=Refunds it');
  const panel = page.getByRole('complementary', { name: 'New feature' });
  const row = (number: string) => panel.locator('.step').filter({ has: page.getByText(number, { exact: true }) });
  await expect(row('1.1')).toContainText('Places it');
  await expect(row('2.1')).toContainText('Refunds it');
  // One link on the map, numbered by the step in view.
  await expect(page.locator('.links .number text')).toHaveText(['1.1']);
  await panel.getByRole('button', { name: 'Walk through the steps' }).click();
  const bar = page.getByRole('status', { name: /^Step / });
  await expect(bar).toHaveAccessibleName('Step 1.1');
  await page.keyboard.press('ArrowRight');
  await expect(bar).toHaveAccessibleName('Step 2.1');
  await expect(page.locator('.links .number text')).toHaveText(['2.1']);
  await page.keyboard.press('Escape');

  await row('2.1').hover();
  await panel.getByRole('button', { name: 'Take step 2.1 off' }).click();
  await expect(row('1.1')).toContainText('Places it');
  await expect(panel.locator('.step')).toHaveCount(1);
  await panel.getByRole('button', { name: 'Remove Refund' }).click();
  await expect(panel.getByRole('button', { name: 'Refund', exact: true })).toHaveCount(0);
  await expect.poll(() => kept(canvas.temp)?.feature?.phases.length).toBe(1);
});

test('every phase title shows whole on the map; one picked there or in the panel dims the other phases', async ({
  page,
  canvas,
}) => {
  await newFeature(page);
  await page.getByLabel('Describe the feature').fill('Customers pay, settle and get refunds.');
  await page.getByRole('button', { name: 'Hand it to the agent' }).click();
  await expect.poll(() => kept(canvas.temp)?.feature?.request).toBe('Customers pay, settle and get refunds.');
  // Phases that cross the same cards, as a real flow does: each starts from a different card of one column.
  koppler(
    canvas,
    'board',
    'edit',
    'New feature',
    '--phase',
    'Pay',
    '--step',
    'web:orders',
    '--step',
    'orders:payments',
    '--phase',
    'Settle',
    '--step',
    'orders:queue:events',
    '--step',
    'queue:events:payments',
    '--phase',
    'Refund',
    '--step',
    'payments:queue:events',
    '--step',
    'web:payments',
  );
  const titles = page.locator('g.phase');
  await expect(titles).toHaveCount(3);
  await page.waitForTimeout(500);
  // Nothing covers a title: not a card, not another title.
  for (const name of ['Pay', 'Settle', 'Refund']) {
    const title = titles.filter({ hasText: name });
    const box = await title.boundingBox();
    if (!box) throw new Error(`no title ${name}`);
    const on = await page.evaluate(
      ([x, y]) => document.elementFromPoint(x ?? 0, y ?? 0)?.closest('g.phase')?.textContent ?? '',
      [box.x + 30, box.y + box.height / 2],
    );
    expect(on, `${name} is covered`).toContain(name);
  }
  await page.screenshot({ path: 'test-results/feature-phase-titles.png' });

  // A title picks its phase, as the panel does: the cards of the other phases dim, and a second click lets go.
  await titles.filter({ hasText: 'Settle' }).click();
  const panel = page.getByRole('complementary', { name: 'New feature' });
  await expect(panel.getByRole('button', { name: /Settle/ }).first()).toHaveAttribute('aria-pressed', 'true');
  await expect(card(page, 'web')).toHaveClass(/dimmed/);
  for (const id of ['orders', 'payments']) await expect(card(page, id)).not.toHaveClass(/dimmed/);
  await page.screenshot({ path: 'test-results/feature-phase-picked.png' });
  await titles.filter({ hasText: 'Settle' }).click();
  await expect(page.locator('.svelte-flow__node.dimmed')).toHaveCount(0);
  // From the panel too.
  await panel.getByRole('button', { name: /Pay/ }).first().click();
  await expect(card(page, 'web')).not.toHaveClass(/dimmed/);
  await expect(page.locator('.svelte-flow__node.dimmed').first()).toBeVisible();
});
