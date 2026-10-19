// Drawing a cable by hand: which side of the card it is plugged into.
import type { Page } from '@playwright/test';
import { card, expect, test } from './canvas.ts';

test.use({
  board: {
    env: 'qa',
    mode: 'auto',
    zoom: 1,
    pan: { x: 40, y: 120 },
    nodes: { web: { x: 0, y: 0, run: 'cli', branch: 'main' }, orders: { x: 420, y: 0, run: 'cli', branch: 'main' } },
    edges: [],
  },
});

/** Draws a cable from Web's right port and lets go at `to`; gives where its socket sits on Orders. */
const draw = async (
  page: Page,
  to: (box: { x: number; y: number; width: number; height: number }) => [number, number],
) => {
  const port = await card(page, 'web')
    .getByRole('button', { name: 'Draw a cable from the right of Web Shop' })
    .boundingBox();
  const orders = await card(page, 'orders').boundingBox();
  if (!port || !orders) throw new Error('not on the page');
  await page.mouse.move(port.x + port.width / 2, port.y + port.height / 2);
  await page.mouse.down();
  const [x, y] = to(orders);
  await page.mouse.move(x, y, { steps: 10 });
  await page.mouse.up();
  const socket = await page.locator('.ends .socket[data-cable="web>orders"]').boundingBox();
  if (!socket) throw new Error('no cable');
  return { x: socket.x + socket.width / 2 - orders.x, y: socket.y + socket.height / 2 - orders.y, orders };
};

test('a cable let go on a card goes into the side that faces where it comes from', async ({ page }) => {
  const at = await draw(page, box => [box.x + box.width / 2, box.y + 30]);
  expect(Math.abs(at.x)).toBeLessThan(4);
  expect(at.y).toBeGreaterThan(20);
});

test('a cable let go on a port goes into that port', async ({ page }) => {
  const at = await draw(page, box => [box.x + box.width / 2, box.y]);
  expect(Math.abs(at.y)).toBeLessThan(4);
  expect(Math.abs(at.x - at.orders.width / 2)).toBeLessThan(4);
});

test('a cable on the pointer, over a port, offers that card and ends there on a click', async ({ page }) => {
  const port = await card(page, 'web')
    .getByRole('button', { name: 'Draw a cable from the right of Web Shop' })
    .boundingBox();
  const target = await card(page, 'orders')
    .getByRole('button', { name: 'Draw a cable from the left of Orders API' })
    .boundingBox();
  if (!port || !target) throw new Error('not on the page');
  await page.mouse.move(port.x + port.width / 2, port.y + port.height / 2);
  await page.mouse.down();
  // Let go on the empty board: the cable stays on the pointer, with a point there.
  await page.mouse.move(port.x + 160, port.y + 120, { steps: 8 });
  await page.mouse.up();
  // The port's outer half, off the card itself.
  await page.mouse.move(target.x + 2, target.y + target.height / 2, { steps: 8 });
  await expect(card(page, 'orders').locator('.drop-ok')).toHaveCount(1);
  await page.screenshot({ path: 'test-results/wiring-over-port.png' });
  await page.mouse.click(target.x + 2, target.y + target.height / 2);
  const socket = await page.locator('.ends .socket[data-cable="web>orders"]').boundingBox();
  if (!socket) throw new Error('no cable');
  expect(Math.abs(socket.x + socket.width / 2 - (target.x + target.width / 2))).toBeLessThan(4);
});
