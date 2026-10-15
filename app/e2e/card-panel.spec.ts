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
  // The board slid left for the panel, so Web Shop is out of view: the Apps list brings it back and picks it.
  await page
    .getByRole('complementary', { name: 'Board and apps' })
    .getByRole('button', { name: 'Web Shop', exact: true })
    .click();
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

test.describe('a card at the right edge', () => {
  test.use({
    board: {
      env: 'qa',
      mode: 'auto',
      zoom: 0.5,
      pan: { x: 80, y: 120 },
      nodes: { web: at(0, 0), orders: at(1500, 0) },
      edges: [],
    },
  });
  test('the board slides left by the panel, so the picked card stays in view, and back when it closes', async ({
    page,
  }) => {
    const x = async () => (await card(page, 'orders').boundingBox())?.x ?? 0;
    await expect(card(page, 'orders')).toBeVisible();
    const before = await x();
    await card(page, 'orders').locator('header').click();
    const panel = page.getByRole('complementary', { name: 'Orders API' });
    await expect.poll(x).toBe(before - 300);
    const box = await card(page, 'orders').boundingBox();
    const edge = (await panel.boundingBox())?.x ?? 0;
    expect((box?.x ?? 0) + (box?.width ?? 0)).toBeLessThanOrEqual(edge);
    await page.screenshot({ path: 'test-results/card-panel-slide.png' });

    // Panning while it is open keeps the saved view free of the slide.
    await page.mouse.wheel(40, 0);
    await page.waitForTimeout(400);
    const panned = await x();
    await panel.getByRole('button', { name: 'Close' }).click();
    await expect.poll(x).toBe(panned + 300);
    await page.waitForTimeout(800);
    await page.reload();
    await expect.poll(x).toBe(panned + 300);
  });
});
