// Fit from far out, where the cards are drawn short: what it shows is the board as it will be drawn, in full.
import { at, card, expect, test } from './canvas.ts';

test.use({
  viewport: { width: 700, height: 760 },
  board: {
    env: 'qa',
    mode: 'auto',
    zoom: 0.2,
    pan: { x: 300, y: 500 },
    nodes: {
      orders: {
        ...at(0, 0),
        note: 'Seed two test orders after it starts, and keep the sandbox webhook pointed at the local API.',
      },
    },
    edges: [],
  },
});

test('Fit from far out shows every card whole, at the size it is drawn in', async ({ page }) => {
  await expect(card(page, 'orders')).toBeVisible();
  await page.getByRole('button', { name: 'Fit', exact: true }).click();
  await page.waitForTimeout(600);
  const pane = await page.locator('.svelte-flow').boundingBox();
  if (!pane) throw new Error('no board');
  for (const one of await page.locator('.svelte-flow__node').all()) {
    const box = await one.boundingBox();
    if (!box) throw new Error('not drawn');
    expect(box.y, 'top inside the board').toBeGreaterThanOrEqual(pane.y);
    expect(box.y + box.height, 'bottom inside the board').toBeLessThanOrEqual(pane.y + pane.height);
  }
});
