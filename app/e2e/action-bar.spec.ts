// A card's floating action bar is for one app: with several picked, none shows.
import type { Page } from '@playwright/test';
import { at, card, expect, test } from './canvas.ts';

test.use({
  board: {
    env: 'qa',
    mode: 'auto',
    zoom: 0.8,
    pan: { x: 60, y: 80 },
    nodes: { web: at(0, 0), orders: at(480, 0) },
    edges: [],
  },
});

const bar = (page: Page, id: string) => page.locator(`.tools[data-card="${id}"]`);

test('one app picked shows its action bar; several picked show none, even pointed at', async ({ page }) => {
  await card(page, 'web').locator('header').click();
  await page.mouse.move(5, 5);
  await expect(bar(page, 'web')).toBeVisible();

  // A selection dragged round both cards.
  const web = await card(page, 'web').boundingBox();
  const orders = await card(page, 'orders').boundingBox();
  if (!web || !orders) throw new Error('not on the page');
  await page.locator('.svelte-flow__pane').click({ position: { x: 10, y: 10 } });
  await page.mouse.move(web.x - 20, web.y - 20);
  await page.mouse.down();
  await page.mouse.move(orders.x + orders.width + 10, orders.y + orders.height + 10, { steps: 10 });
  await page.mouse.up();
  await expect(card(page, 'web')).toHaveClass(/selected/);
  await expect(card(page, 'orders')).toHaveClass(/selected/);
  await page.mouse.move(5, 5);
  await expect(bar(page, 'web')).toBeHidden();
  await expect(bar(page, 'orders')).toBeHidden();
  await card(page, 'orders').locator('header').hover();
  await page.waitForTimeout(300);
  await expect(bar(page, 'orders')).toBeHidden();
});
