// The board menu: one list of the team's boards and your own, by area, a Team tag on the team's when the stack is
// shared. A team board an older Koppler copied is one board.
import type { Page } from '@playwright/test';
import { expect, fromMenu, STACK, test } from './canvas.ts';

const apps = STACK.apps as Record<string, object>;
const own = [
  { name: 'Checkout (local)', version: 1, nodes: { payments: { run: 'cli' } }, edges: [] },
  { name: 'Refunds', version: 1, nodes: { payments: { run: 'cli' } }, edges: [] },
  { name: 'Parcel notes', version: 1, nodes: { catalog: { run: 'cli' } }, edges: [] },
  // A feature board: Discover's, never in Run's list.
  { name: 'basket rework', version: 1, nodes: { payments: { run: 'cli' } }, edges: [], feature: {} },
];
const team = [...(STACK.presets ?? []), { name: 'Smoke test', version: 1, nodes: { web: { run: 'cli' } }, edges: [] }];
const board = { env: 'qa', mode: 'auto', nodes: { web: { x: 0, y: 0, run: 'cli' } }, edges: [], presets: own };

const menuOf = async (page: Page) => {
  await page
    .getByRole('banner')
    .getByRole('button', { name: /^Board:/ })
    .click();
  return page.getByRole('dialog', { name: 'Boards' });
};
const rows = (menu: ReturnType<Page['locator']>) => menu.locator('.row:not(.gone) > button:first-child');

test.describe('a stack with areas', () => {
  test.use({
    stack: {
      ...STACK,
      areas: { payments: { name: 'Payments' }, shipping: { name: 'Shipping' } },
      apps: {
        ...apps,
        orders: { ...apps['orders'], areas: ['payments'] },
        payments: { ...apps['payments'], areas: ['payments'] },
        catalog: { ...apps['catalog'], areas: ['shipping'] },
      },
      presets: team,
    } as typeof STACK,
    board,
    teamStack: true,
  });

  test('lists both kinds under each area by name, a copied team board once, and counts what the areas hide', async ({
    page,
  }) => {
    const menu = await menuOf(page);
    await expect(menu.locator('p.sub')).toHaveText(['Payments2', 'Shipping2', 'No area2']);
    await expect(rows(menu)).toHaveText([
      /^Checkout\s*Team\s*$/,
      /^Refunds\s*$/,
      /^Browse\s*Team\s*$/,
      /^Parcel notes\s*$/,
      /^Smoke test\s*Team\s*$/,
      // The board on screen, kept as your own.
      /^Web Shop\s*$/,
    ]);
    await page.screenshot({ path: 'test-results/board-list.png' });
    // The … sits after the tag column: pointing at a row moves no name.
    const name = menu.locator('.row').filter({ hasText: 'Browse' }).locator('.name');
    const before = await name.boundingBox();
    await name.hover();
    await expect(menu.getByRole('button', { name: 'More for Browse', exact: true })).toHaveCSS('opacity', '1');
    expect(await name.boundingBox()).toEqual(before);

    await menu.getByRole('button', { name: /^Areas:/ }).click();
    const list = page.getByRole('dialog', { name: 'Areas to see' });
    await list.locator('[data-area]').filter({ hasText: 'Payments' }).hover();
    await list.getByRole('button', { name: 'Only' }).filter({ visible: true }).click();
    await page.keyboard.press('Escape');
    await expect(menu.locator('p.sub')).toHaveText(['Payments2', 'No area2']);
    await expect(menu.locator('.hidden-line .said')).toHaveText('2 boards in Shipping: 1 team, 1 yours');
    await page.screenshot({ path: 'test-results/board-list-hidden.png' });
  });
});

test.describe('a stack with no areas', () => {
  test.use({ stack: { ...STACK, presets: team }, board, teamStack: true });

  test('is one flat list by name, with the same row and tag', async ({ page }) => {
    const menu = await menuOf(page);
    await expect(menu.locator('p.sub')).toHaveCount(0);
    await expect(rows(menu)).toHaveText([
      /^Browse\s*Team\s*$/,
      /^Checkout\s*Team\s*$/,
      /^Parcel notes\s*$/,
      /^Refunds\s*$/,
      /^Smoke test\s*Team\s*$/,
      /^Web Shop\s*$/,
    ]);
    // The … holds every action of the row; Set area… waits for the first area.
    await menu.locator('.row').filter({ hasText: 'Parcel notes' }).hover();
    await menu.getByRole('button', { name: 'More for Parcel notes', exact: true }).click();
    await expect(page.getByRole('menu', { name: 'Parcel notes' }).getByRole('menuitem')).toHaveText([
      'Open',
      'Share with the team…',
      'Delete…',
    ]);
    await page.keyboard.press('Escape');
    // Paper: the tag keeps its hairline box and muted ink.
    await page.keyboard.press('Escape');
    await fromMenu(page, 'Settings', 'Appearance');
    await page.getByRole('radio', { name: /^Paper/ }).click();
    await page.keyboard.press('Escape');
    const again = await menuOf(page);
    await again.locator('.row').filter({ hasText: 'Browse' }).hover();
    await page.screenshot({ path: 'test-results/board-list-paper.png' });
  });
});

test.describe('a stack only on this Mac', () => {
  test.use({ stack: { ...STACK, presets: team }, board });

  test("marks no board as the team's", async ({ page }) => {
    const menu = await menuOf(page);
    await expect(rows(menu)).toHaveText([
      /^Browse\s*$/,
      /^Checkout\s*$/,
      /^Parcel notes\s*$/,
      /^Refunds\s*$/,
      /^Smoke test\s*$/,
      /^Web Shop\s*$/,
    ]);
  });
});
