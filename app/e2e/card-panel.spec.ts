// Zoomed out, cards show only a summary; the one picked has its choices in a panel beside the board.
import { at, card, expect, test } from './canvas.ts';

test.use({
  board: {
    env: 'qa',
    mode: 'auto',
    zoom: 0.5,
    pan: { x: 80, y: 120 },
    nodes: { web: at(0, 0), orders: at(420, 0) },
    edges: [{ from: 'web', to: 'orders', fromSide: 'right', toSide: 'left' }],
  },
});

test("zoomed out, the picked card's choices open beside the board, change it, and close", async ({ page }) => {
  const panel = page.getByRole('complementary', { name: 'Orders API' });
  await expect(card(page, 'orders').getByLabel('Branch')).toHaveCount(0);
  await expect(panel).toHaveCount(0);

  await card(page, 'orders').locator('header').click();
  await expect(panel).toBeVisible();
  await expect(panel.getByLabel('Branch')).toHaveValue('main');
  await panel.getByRole('radio', { name: 'Me' }).check();
  await expect(card(page, 'orders')).toContainText('Started by you');
  await page.screenshot({ path: 'test-results/card-panel.png' });

  // Another card takes its place; two picked at once have no panel.
  await card(page, 'web').locator('header').click();
  await expect(page.getByRole('complementary', { name: 'Web Shop' })).toBeVisible();
  await page.keyboard.press('ControlOrMeta+a');
  await expect(page.locator('aside[aria-labelledby="card-panel-title"]')).toHaveCount(0);

  // A click on the empty board picks nothing, then one card is picked again.
  await page.locator('.svelte-flow__pane').click({ position: { x: 40, y: 400 } });
  await card(page, 'orders').locator('header').click();
  await panel.getByRole('button', { name: 'Close' }).click();
  await expect(panel).toHaveCount(0);
  await expect(card(page, 'orders')).not.toHaveClass(/selected/);
});

test.describe('at normal zoom', () => {
  test.use({
    board: { env: 'qa', mode: 'auto', zoom: 1, pan: { x: 80, y: 120 }, nodes: { orders: at(0, 0) }, edges: [] },
  });
  test('the card keeps its choices and no panel opens', async ({ page }) => {
    await card(page, 'orders').locator('header').click();
    await expect(card(page, 'orders').getByLabel('Branch')).toBeVisible();
    await expect(page.getByRole('complementary', { name: 'Orders API' })).toHaveCount(0);
  });
});
