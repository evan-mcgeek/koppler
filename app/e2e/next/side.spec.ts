// The new canvas's side panel: the stack's apps, found, added to the board and taken off it.
import type { Page } from '@playwright/test';
import fs from 'node:fs';
import path from 'node:path';
import { test, expect, nextEdit } from '../canvas.ts';

const card = (page: Page, id: string) => page.locator(`.svelte-flow__node[data-id="${id}"]`);
const rows = (page: Page) => page.getByRole('complementary').getByRole('listitem');
test.use({
  start: 'next/',
  uncloned: ['payments'],
  board: {
    env: 'qa',
    mode: 'auto',
    zoom: 1,
    pan: { x: 0, y: 0 },
    nodes: { web: { x: 0, y: 0, run: 'cli', branch: 'main' }, orders: { x: 420, y: 0, run: 'cli', branch: 'main' } },
    edges: [{ from: 'web', to: 'orders', fromSide: 'right', toSide: 'left' }],
  },
});

test('the apps on the board come first, then the rest, with what can be done with each', async ({ page }) => {
  await expect(page.getByText('2 of 4 on the board')).toBeVisible();
  await expect(rows(page)).toHaveText([/Orders API/, /Web Shop/, /Catalog API/, /Payments API\s*not cloned/]);
  await page.screenshot({ path: 'test-results/next-side.png' });
  await page.getByRole('button', { name: /Sorted by name/ }).click();
  // In the order they were added: to the board, then to the stack.
  await expect(rows(page)).toHaveText([/Web Shop/, /Orders API/, /Payments API/, /Catalog API/]);
});

test('an app is added from the list to a free spot, shown from the list, and removed with its cables', async ({
  page,
}) => {
  await page.getByRole('button', { name: 'Add Catalog API to the board', exact: true }).first().click();
  await expect(card(page, 'catalog')).toBeVisible();
  await expect(page.getByText('3 of 4 on the board')).toBeVisible();
  const boxes = await Promise.all(['web', 'orders', 'catalog'].map(id => card(page, id).boundingBox()));
  const [web, orders, catalog] = boxes;
  if (!web || !orders || !catalog) throw new Error('a card is missing');
  for (const other of [web, orders])
    expect(
      catalog.x >= other.x + other.width ||
        other.x >= catalog.x + catalog.width ||
        catalog.y >= other.y + other.height ||
        other.y >= catalog.y + catalog.height,
    ).toBe(true);

  await page.getByRole('button', { name: 'Web Shop', exact: true }).click();
  await expect(card(page, 'web')).toHaveClass(/selected/);
  await rows(page).filter({ hasText: 'Web Shop' }).hover();
  await page.getByRole('button', { name: 'Remove Web Shop from the board' }).click();
  await expect(card(page, 'web')).toHaveCount(0);
  await expect(page.locator('.svelte-flow__edge')).toHaveCount(0);
  await expect(page.getByText('2 of 4 on the board')).toBeVisible();
});

test('the list is filtered by a name or a kind, and an app that is not cloned offers its clone command', async ({
  page,
}) => {
  const search = page.getByRole('searchbox', { name: 'Find an app by name or kind' });
  await search.fill('cat');
  await expect(rows(page)).toHaveText([/Catalog API/]);
  await search.fill('.net');
  await expect(rows(page)).toHaveText([/Orders API/, /Payments API/]);
  await search.fill('nothing like it');
  await expect(page.getByText('No app matches.')).toBeVisible();
  await search.fill('pay');
  await page.context().grantPermissions(['clipboard-read', 'clipboard-write']);
  await page.getByRole('complementary').getByRole('button', { name: 'Payments API', exact: true }).click();
  await expect(page.getByRole('complementary').getByRole('status')).toHaveText(
    'Clone command for Payments API copied.',
  );
  expect(await page.evaluate(() => navigator.clipboard.readText())).toBe(
    'git clone git@github.com:acme/payments-api.git',
  );
  await expect(card(page, 'payments')).toHaveCount(0);
});

test('the environment is switched in the panel, and the panel folds away', async ({ page }) => {
  await expect(page.getByRole('banner')).toContainText('QA');
  await page.getByRole('radio', { name: 'PROD' }).check();
  await expect(page.getByRole('banner')).toContainText('PROD');
  await page.getByRole('button', { name: 'Hide the side pane' }).click();
  await expect(page.getByRole('complementary')).toHaveCount(0);
  // A rail is left: where the board stands, the settings, and the way back in.
  const rail = page.getByRole('navigation', { name: 'Side pane, folded' });
  await expect(rail.getByRole('button', { name: 'Board and environment: PROD' })).toHaveText('PROD');
  await expect(rail.getByRole('button', { name: 'Apps: 2 of 4 on the board' })).toHaveText('2/4');
  await rail.getByRole('button', { name: 'Settings' }).click();
  await expect(page.getByRole('radiogroup', { name: 'Theme' })).toBeVisible();
  await page.screenshot({ path: 'test-results/next-rail.png' });
  await page.keyboard.press('Escape');
  await rail.getByRole('button', { name: /^Apps/ }).click();
  await expect(page.getByText('2 of 4 on the board')).toBeVisible();
  await expect(rail).toHaveCount(0);
});

test('a row dragged onto the board puts the card where it is dropped', async ({ page }) => {
  const row = page.getByRole('complementary').getByRole('button', { name: 'Catalog API', exact: true });
  const area = page.locator('.area');
  const box = await area.boundingBox();
  if (!box) throw new Error('no board');
  const drop = { x: box.width - 200, y: box.height - 300 };
  await row.dragTo(area, { targetPosition: drop });
  const placed = await card(page, 'catalog').boundingBox();
  if (!placed) throw new Error('no card');
  // Its header is under the pointer.
  expect(placed.x).toBeLessThan(box.x + drop.x);
  expect(placed.x + placed.width).toBeGreaterThan(box.x + drop.x);
  expect(Math.abs(placed.y + 22 * (placed.width / 300) - (box.y + drop.y))).toBeLessThan(12);
  await expect(page.getByText('3 of 4 on the board')).toBeVisible();
});

test('repos found on this machine are added to the stack from a picker', async ({ page, canvas }) => {
  const repo = (name: string, kind: string | null, folder: string, inStack?: string) => ({
    slug: `acme/${name}`,
    name: name.replace(/^./, first => first.toUpperCase()),
    kind,
    path: `${folder}/${name}`,
    folder,
    ...(inStack && { inStack }),
  });
  const found = [
    repo('web', 'node', '~/work', 'web'),
    repo('mailer', 'node', '~/work'),
    repo('reports', null, '~/work'),
    repo('tools', 'dotnet', '~/other'),
  ];
  fs.writeFileSync(
    path.join(canvas.temp, 'repos.json'),
    JSON.stringify({ roots: ['~/work', '~/other'], repos: found }),
  );
  const asked: unknown[] = [];
  await page.route('**/apps?*', async route => {
    asked.push(route.request().postDataJSON());
    await route.fulfill({ json: { added: ['mailer', 'reports'] } });
  });
  await page.getByRole('button', { name: 'Add repos…' }).click();
  const picker = page.getByRole('dialog', { name: 'Add repos to Acme Shop' });
  // What is in the stack already is not offered.
  await expect(picker.getByRole('checkbox')).toHaveCount(3);
  await expect(picker.getByRole('button', { name: /^Add/ })).toBeDisabled();
  await picker.getByRole('button', { name: 'Pick all 2' }).click();
  await picker.getByLabel('Name of acme/mailer in the stack').fill('Mail service');
  await page.screenshot({ path: 'test-results/next-repos.png' });
  await picker.getByRole('button', { name: 'Add 2 apps' }).click();
  await expect(picker.getByRole('alert')).toHaveText('Choose what kind of app Reports is.');
  await picker.getByLabel('Kind of app for Reports').selectOption('dotnet');
  await picker.getByLabel('Find a repo').fill('tools');
  await expect(picker.getByRole('checkbox')).toHaveCount(1);
  await picker.getByRole('button', { name: 'Add 2 apps' }).click();
  await expect
    .poll(() => asked)
    .toEqual([
      {
        apps: [
          { slug: 'acme/mailer', name: 'Mail service', kind: 'node' },
          { slug: 'acme/reports', name: 'Reports', kind: 'dotnet' },
        ],
      },
    ]);
});

test('an app is removed from the stack after a question', async ({ page }) => {
  const asked: unknown[] = [];
  await page.route('**/apps-remove?*', async route => {
    asked.push(route.request().postDataJSON());
    await route.fulfill({ json: { removed: 'catalog' } });
  });
  await page.getByRole('button', { name: 'Remove Catalog API from the stack' }).click();
  const ask = page.getByRole('dialog').filter({ hasText: 'Remove Catalog API from the stack?' });
  await expect(ask).toContainText('The repo stays on your Mac.');
  await ask.getByRole('button', { name: 'Remove from stack' }).click();
  await expect.poll(() => asked).toEqual([{ id: 'catalog' }]);
});

test('an app runs alone on a board of its own, with the board before one click back', async ({ page, canvas }) => {
  await nextEdit(page);
  await page.getByRole('button', { name: 'Run Catalog API alone' }).click();
  const review = page.getByRole('dialog').filter({ hasText: 'Run on QA' });
  await expect(review).toContainText('Catalog API');
  await expect(review).not.toContainText('Orders API');
  await expect(page.getByRole('button', { name: 'Board: Catalog API alone' })).toBeVisible();
  await expect(card(page, 'catalog')).toBeVisible();
  await expect(page.locator('.svelte-flow__node-app')).toHaveCount(1);
  // One app alone is not kept as a board; the board before still is.
  await nextEdit(page);
  const kept = (await (await page.request.get(`${canvas.url}data/state.json`)).json()) as {
    presets?: { name: string }[];
  };
  expect(kept.presets?.map(one => one.name)).toEqual(['Web Shop + 1']);
  await review.getByRole('button', { name: 'Back to Web Shop + 1' }).click();
  await expect(review).toBeHidden();
  await expect(page.locator('.svelte-flow__node-app')).toHaveCount(2);
  await expect(page.locator('.svelte-flow__edge')).toHaveCount(1);
});
