// Areas: one person's choice of the stack's parts, shared by the Apps list and the board menu, and kept on this Mac.
import type { Page } from '@playwright/test';
import { expect, STACK, test } from './canvas.ts';

const apps = STACK.apps as Record<string, object>;
test.use({
  stack: {
    ...STACK,
    areas: { payments: { name: 'Payments' }, shipping: { name: 'Shipping' } },
    apps: {
      ...apps,
      orders: { ...apps['orders'], areas: ['payments', 'shipping'] },
      payments: { ...apps['payments'], areas: ['payments'] },
      catalog: { ...apps['catalog'], areas: ['shipping'] },
    },
    presets: [
      ...(STACK.presets ?? []),
      { name: 'Smoke test', version: 1, nodes: { web: { run: 'cli' } }, edges: [] },
    ],
  } as typeof STACK,
  board: {
    env: 'qa',
    mode: 'auto',
    nodes: { web: { x: 0, y: 0, run: 'cli' } },
    edges: [],
  },
});

const panel = (page: Page) => page.getByRole('complementary');
/** Opens the Areas checklist under `where` and picks only one area. */
const only = async (page: Page, where: ReturnType<Page['locator']>, name: string) => {
  await where.getByRole('button', { name: /^Areas:/ }).click();
  const list = page.getByRole('dialog', { name: 'Areas to see' });
  await list.locator('[data-area]').filter({ hasText: name }).hover();
  await list.getByRole('button', { name: 'Only' }).filter({ visible: true }).click();
  await page.keyboard.press('Escape');
};

test('the Apps list shows the chosen areas, then apps in none; an app in two lists once', async ({ page }) => {
  await expect(panel(page).getByRole('button', { name: 'Areas: All' })).toBeVisible();
  await only(page, panel(page), 'Payments');
  await expect(panel(page).getByRole('button', { name: 'Areas: Payments' })).toBeVisible();
  await expect(panel(page).getByRole('heading', { level: 3 })).toHaveText(['Payments', 'No area']);
  const payments = panel(page).getByRole('list', { name: 'Payments' });
  await expect(payments.getByRole('listitem')).toHaveText([/Orders API\s*also Shipping/, /Payments API/]);
  await expect(panel(page)).toContainText('1 app in other areas');
  await expect(panel(page)).toContainText('3 of 4');
  await page.screenshot({ path: 'test-results/areas-apps.png' });
  // Kept on this Mac, and the board menu shows the same choice.
  await page.reload();
  await expect(panel(page).getByRole('button', { name: 'Areas: Payments' })).toBeVisible();
  await page.getByRole('banner').getByRole('button', { name: /^Board:/ }).click();
  const menu = page.getByRole('dialog', { name: 'Boards' });
  await expect(menu.getByRole('button', { name: 'Areas: Payments' })).toBeVisible();
  await page.keyboard.press('Escape');
  await panel(page).getByRole('button', { name: 'Show all' }).click();
  await expect(panel(page).getByRole('button', { name: 'Areas: All' })).toBeVisible();
  await expect(panel(page)).toContainText('1 of 4 on the board');
});

test('the board menu groups team boards by area, hides the others with a line, and finds a hidden one', async ({
  page,
}) => {
  const bar = page.getByRole('banner');
  await bar.getByRole('button', { name: /^Board:/ }).click();
  const menu = page.getByRole('dialog', { name: 'Boards' });
  await expect(menu.locator('p.sub')).toHaveText(['Payments', 'Shipping', 'No area']);
  await only(page, menu, 'Payments');
  await bar.getByRole('button', { name: /^Board:/ }).click();
  await expect(menu.locator('p.sub')).toHaveText(['Payments', 'No area']);
  await expect(menu).toContainText('1 team board in Shipping');
  await page.screenshot({ path: 'test-results/areas-menu.png' });
  await menu.getByRole('searchbox', { name: 'Find a board' }).fill('bro');
  await expect(menu.getByText('In other areas')).toBeVisible();
  await menu.getByRole('button', { name: /Browse/ }).click();
  // Opening it leaves the choice alone; the bar says it is outside it.
  await expect(bar.getByRole('button', { name: /^Board: Browse/ })).toContainText('Shipping');
  await expect(panel(page).getByRole('button', { name: 'Areas: Payments' })).toBeVisible();
  await page.screenshot({ path: 'test-results/areas-outside.png' });
});
