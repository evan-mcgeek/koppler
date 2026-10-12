// The new canvas's side panel: the stack's apps, found, added to the board and taken off it.
import type { Page } from '@playwright/test';
import { test, expect } from '../canvas.ts';

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
  await page.getByRole('complementary').getByRole('button', { name: 'Payments API' }).click();
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
