// A board changed from the terminal while it is open: the canvas makes the change, says so, and keeps it.
import fs from 'node:fs';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import type { Page } from '@playwright/test';
import { at, card, expect, saved, saveSettles, STACK, test } from './canvas.ts';

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
  return run.stdout;
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

test('a board made from the terminal joins your boards on an open canvas, which opens it, says so and keeps it', async ({
  page,
  canvas,
}) => {
  await expect(card(page, 'web')).toBeVisible();
  koppler(canvas, 'board', 'new', 'Orders work', '--add', 'orders,payments', '--cable', 'orders:payments');
  await expect(page.getByRole('status').filter({ hasText: 'The agent made a board, Orders work.' })).toBeVisible();
  await expect.poll(() => waiting(canvas.temp)).toBe(0);
  await expect(page.getByRole('button', { name: /^Board: Orders work/ })).toBeVisible();
  await expect(card(page, 'web')).toHaveCount(0);
  await expect(page.locator('.svelte-flow__edge[data-id="orders>payments"]')).toHaveCount(1);
  await expect
    .poll(() => state(canvas.temp).presets.find(one => one.name === 'Orders work')?.nodes)
    .toEqual({ orders: { run: 'cli' }, payments: { run: 'cli' } });
});

test('koppler canvas --board switches a canvas open in a background tab to a board just made', async ({
  page,
  canvas,
}) => {
  await expect(card(page, 'web')).toBeVisible();
  // The tab is out of view while the agent works in the terminal.
  const hide = (hidden: boolean) =>
    page.evaluate(hidden => {
      Object.defineProperty(document, 'hidden', { value: hidden, configurable: true });
      document.dispatchEvent(new Event('visibilitychange'));
    }, hidden);
  await hide(true);
  koppler(canvas, 'board', 'new', 'Orders work', '--add', 'orders,payments', '--cable', 'orders:payments');
  expect(koppler(canvas, 'canvas', '--board', 'Orders work')).toContain('Switched the open canvas to Orders work.');
  await hide(false);
  await expect(page.getByRole('button', { name: /^Board: Orders work/ })).toBeVisible();
  await expect(card(page, 'web')).toHaveCount(0);
  await expect(card(page, 'orders')).toBeVisible();
  await expect(card(page, 'payments')).toBeVisible();
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
  // A message reaches the page with the server's status: put together every 1.5 s (slower on a busy machine), then
  // fetched by the page every 1.5 s.
  await expect(panel.getByRole('heading', { level: 3 }).first()).toHaveText('Change Shop?', { timeout: 15_000 });
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

/** The stack as a sync leaves it with a new app, Shipping API, cloned here and called by Orders API. */
const withShipping = ({ dir, temp }: { dir: string; temp: string }) => {
  type Apps = Record<string, Record<string, unknown>>;
  const file = (name: string) => path.join(temp, `${name}.json`);
  const read = (name: string) => JSON.parse(fs.readFileSync(file(name), 'utf8')) as { apps: Apps };
  const registry = read('registry');
  const orders = registry.apps['orders'] as { consumes: Record<string, unknown> };
  orders.consumes['shipping'] = { how: 'env', env: 'Shipping__Url' };
  registry.apps['shipping'] = {
    name: 'Shipping API',
    kind: 'dotnet',
    slug: 'acme/shipping-api',
    url: 'http://localhost:5004',
  };
  fs.writeFileSync(file('registry'), JSON.stringify(registry));
  const local = read('local');
  local.apps['shipping'] = { ...local.apps['orders'], path: path.join(dir, 'clones', 'shipping') };
  fs.writeFileSync(file('local'), JSON.stringify(local));
};
const shippingFlow = (dir: string) => {
  const file = path.join(dir, 'shipping.json');
  fs.writeFileSync(
    file,
    JSON.stringify({
      name: 'Shipping flow',
      version: 1,
      nodes: { web: { run: 'cli' }, orders: { run: 'cli' }, shipping: { run: 'cli' } },
      edges: [
        { from: 'web', to: 'orders' },
        { from: 'orders', to: 'shipping' },
      ],
    }),
  );
  return file;
};
/** The board as the page kept it, once the page has kept it. */
const keptFlow = async (temp: string) => {
  await expect.poll(() => (state(temp) as { preset?: string }).preset).toBe('Shipping flow');
  const flow = state(temp).presets.find(one => one.name === 'Shipping flow') as
    { nodes: Record<string, unknown>; edges: { from: string; to: string }[] } | undefined;
  return { apps: Object.keys(flow?.nodes ?? {}).sort(), cables: flow?.edges.map(({ from, to }) => `${from}>${to}`) };
};

test('a board opened from the terminal after the stack changed shows every app of it', async ({ page, canvas }) => {
  await expect(card(page, 'web')).toBeVisible();
  withShipping(canvas);
  koppler(canvas, 'board', 'open', shippingFlow(canvas.dir), '--no-open');
  await expect(page.getByRole('status').filter({ hasText: 'Opened Shipping flow from the terminal.' })).toBeVisible();
  await expect(card(page, 'shipping')).toBeVisible();
  await expect(page.locator('.svelte-flow__node-app')).toHaveCount(3);
  await expect(page.locator('.svelte-flow__edge')).toHaveCount(2);
  expect(await keptFlow(canvas.temp)).toEqual({
    apps: ['orders', 'shipping', 'web'],
    cables: ['web>orders', 'orders>shipping'],
  });
});

test('a board keeps an app the stack does not have, says so, and shows it once the stack has it', async ({
  page,
  canvas,
}) => {
  await expect(card(page, 'web')).toBeVisible();
  koppler(canvas, 'board', 'open', shippingFlow(canvas.dir), '--no-open');
  const said = page.getByRole('status').filter({ hasText: 'Opened Shipping flow from the terminal' });
  await expect(said).toContainText(
    'shipping is not in this stack, kept on the board and hidden until the stack has it',
  );
  await expect(page.locator('.svelte-flow__node-app')).toHaveCount(2);
  await page.screenshot({ path: 'test-results/board-kept-hidden.png' });
  // Hidden, not lost: the board as kept still has it and its cable.
  expect(await keptFlow(canvas.temp)).toEqual({
    apps: ['orders', 'shipping', 'web'],
    cables: ['web>orders', 'orders>shipping'],
  });

  withShipping(canvas);
  koppler(canvas, 'refresh', '--no-sync');
  await expect(card(page, 'shipping')).toBeVisible();
  await expect(page.locator('.svelte-flow__edge[data-id="orders>shipping"]')).toHaveCount(1);
});

test('an app kept hidden on the board on screen comes off it when the terminal removes it', async ({
  page,
  canvas,
}) => {
  await expect(card(page, 'web')).toBeVisible();
  koppler(canvas, 'board', 'open', shippingFlow(canvas.dir), '--no-open');
  expect((await keptFlow(canvas.temp)).apps).toEqual(['orders', 'shipping', 'web']);
  koppler(canvas, 'board', 'edit', 'Shipping flow', '--remove', 'shipping');
  await expect(page.getByRole('status')).toContainText('The agent changed Shipping flow: removed shipping.');
  await expect.poll(() => waiting(canvas.temp)).toBe(0);
  await saveSettles(page);
  expect(await keptFlow(canvas.temp)).toEqual({ apps: ['orders', 'web'], cables: ['web>orders'] });
});

test('an app the stack has no more comes off the board from the note about it', async ({ page, canvas }) => {
  await expect(card(page, 'web')).toBeVisible();
  koppler(canvas, 'board', 'open', shippingFlow(canvas.dir), '--no-open');
  expect((await keptFlow(canvas.temp)).apps).toEqual(['orders', 'shipping', 'web']);
  const note = page
    .getByRole('note')
    .filter({ hasText: 'shipping is kept on this board, but this stack has no such app.' });
  await expect(note).toBeVisible();
  await note.getByRole('button', { name: 'Take it off the board' }).click();
  await expect(note).toHaveCount(0);
  await saveSettles(page);
  expect(await keptFlow(canvas.temp)).toEqual({ apps: ['orders', 'web'], cables: ['web>orders'] });
});

test.describe('a team board with an app not cloned here', () => {
  test.use({
    uncloned: ['payments'],
    stack: {
      ...STACK,
      presets: [
        {
          name: 'Checkout',
          version: 1,
          nodes: {
            web: { run: 'cli' },
            orders: { run: 'cli' },
            payments: { run: 'ide', branch: 'feature/checkout', note: 'Refunds on' },
          },
          edges: [
            { from: 'web', to: 'orders' },
            { from: 'orders', to: 'payments' },
          ],
        },
      ],
    },
  });
  const openCheckout = async (page: Page) => {
    await page.getByRole('button', { name: /^Board: / }).click();
    await page
      .getByRole('dialog', { name: 'Boards' })
      .getByRole('button', { name: /^Checkout/ })
      .click();
    await expect(page.locator('.svelte-flow__node-app')).toHaveCount(2);
  };
  const own = (temp: string) => state(temp).presets.map(one => one.name);

  test('shows the app as the board keeps it once it is cloned, and stays the team board', async ({ page, canvas }) => {
    await expect(card(page, 'web')).toBeVisible();
    await openCheckout(page);
    const local = path.join(canvas.temp, 'local.json');
    const clones = JSON.parse(fs.readFileSync(local, 'utf8')) as { apps: Record<string, object> };
    clones.apps['payments'] = { ...clones.apps['orders'], path: path.join(canvas.dir, 'clones', 'payments') };
    fs.writeFileSync(local, JSON.stringify(clones));
    koppler(canvas, 'refresh', '--no-sync');
    await expect(card(page, 'payments')).toBeVisible();
    await expect(card(page, 'payments').getByLabel('Branch')).toHaveValue('feature/checkout');
    await expect(page.locator('.svelte-flow__edge[data-id="orders>payments"]')).toHaveCount(1);
    await saveSettles(page);
    const payments = (state(canvas.temp).nodes as Record<string, { run?: string; branch?: string; note?: string }>)[
      'payments'
    ];
    expect(payments).toMatchObject({ run: 'ide', branch: 'feature/checkout', note: 'Refunds on' });
    expect(own(canvas.temp)).toEqual(['Shop']);
  });

  test('takes the app off when the terminal removes it, in a board of your own', async ({ page, canvas }) => {
    await expect(card(page, 'web')).toBeVisible();
    await openCheckout(page);
    koppler(canvas, 'board', 'edit', 'Checkout', '--remove', 'payments');
    await expect(page.getByRole('status')).toContainText('The agent changed Checkout: removed Payments API.');
    await expect.poll(() => waiting(canvas.temp)).toBe(0);
    await saveSettles(page);
    const checkout = state(canvas.temp).presets.find(one => one.name === 'Checkout');
    expect(Object.keys(checkout?.nodes ?? {}).sort()).toEqual(['orders', 'web']);
  });
});

test('a board deleted from the terminal goes to Recently deleted on an open canvas, which says so', async ({
  page,
  canvas,
}) => {
  await expect(card(page, 'web')).toBeVisible();
  koppler(canvas, 'board', 'delete', 'Shop');
  await expect(page.getByRole('status')).toContainText('The agent deleted Shop. Recently deleted brings it back.');
  await expect.poll(() => waiting(canvas.temp)).toBe(0);
  // The page keeps it gone, so its own copy never brings the board back.
  // With no board of the user's left, the page saves no list at all.
  const own = () => (state(canvas.temp) as { presets?: { name: string }[] }).presets ?? [];
  await expect.poll(() => own().some(one => one.name === 'Shop')).toBe(false);
  await page.getByRole('button', { name: /^Board:/ }).click();
  await expect(page.getByText('Recently deleted (1)')).toBeVisible();
});

test.describe('in a stack with areas', () => {
  test.use({ stack: { ...STACK, areas: { payments: { name: 'Payments' } } } as typeof STACK });

  test('an area set from the terminal on the board on screen is kept through its next save', async ({
    page,
    canvas,
  }) => {
    await expect(card(page, 'web')).toBeVisible();
    const area = () => (state(canvas.temp).presets.find(one => one.name === 'Shop') as { area?: string }).area;
    // A change made on the canvas saves the board as it holds it.
    const move = async () => {
      const box = await card(page, 'web').boundingBox();
      if (!box) throw new Error('no card');
      const save = saved(page);
      await page.mouse.move(box.x + 80, box.y + 14);
      await page.mouse.down();
      await page.mouse.move(box.x + 80, box.y + 120, { steps: 6 });
      await page.mouse.up();
      await save;
    };
    koppler(canvas, 'board', 'edit', 'Shop', '--area', 'payments');
    await expect.poll(() => waiting(canvas.temp)).toBe(0);
    await move();
    expect(area()).toBe('payments');
    koppler(canvas, 'board', 'edit', 'Shop', '--area', 'auto');
    await expect.poll(() => waiting(canvas.temp)).toBe(0);
    await move();
    expect(area()).toBeUndefined();
  });
});
