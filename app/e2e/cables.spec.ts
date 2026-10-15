// Cables: where their ends sit on the cards they join.
import type { Page } from '@playwright/test';
import { test, expect } from './canvas.ts';

const card = (page: Page, id: string) => page.locator(`.svelte-flow__node-app[data-id="${id}"]`);
/** How far along its card each end of the one cable sits, in pixels from the card's left edge. */
const ends = async (page: Page) => {
  const left = async (id: string) => (await card(page, id).boundingBox())?.x ?? 0;
  const middle = async (end: string) => {
    const box = await page.locator(`.ends .${end}[data-cable="web>orders"]`).boundingBox();
    return (box?.x ?? 0) + (box?.width ?? 0) / 2;
  };
  return [
    Math.round((await middle('plug')) - (await left('web'))),
    Math.round((await middle('socket')) - (await left('orders'))),
  ];
};

test.use({
  board: {
    env: 'qa',
    mode: 'auto',
    zoom: 1,
    pan: { x: 0, y: 0 },
    nodes: {
      web: { x: 200, y: 80, run: 'cli', branch: 'main' },
      orders: { x: 330, y: 520, run: 'cli', branch: 'main' },
    },
    edges: [{ from: 'web', to: 'orders', fromSide: 'bottom', toSide: 'top' }],
  },
});

const drag = async (page: Page) => {
  const box = await card(page, 'web').boundingBox();
  if (!box) throw new Error('no card');
  await page.mouse.move(box.x + 80, box.y + 14);
  await page.mouse.down();
  await page.mouse.move(box.x + 170, box.y + 14, { steps: 6 });
  await page.mouse.up();
  expect((await card(page, 'web').boundingBox())?.x).toBeGreaterThan(box.x + 60);
};

test('dragging a card leaves the ends of its cable where they are on their cards', async ({ page }) => {
  await expect(page.locator('.ends .plug')).toBeVisible();
  const before = await ends(page);
  await drag(page);
  expect(await ends(page)).toEqual(before);
});

test('after Arrange too, dragging a card leaves the ends where Arrange put them', async ({ page }) => {
  await page.getByRole('button', { name: 'Arrange', exact: true }).click();
  await expect(page.locator('.ends .plug')).toBeVisible();
  await page.waitForTimeout(600);
  const before = await ends(page);
  await drag(page);
  expect(await ends(page)).toEqual(before);
});
