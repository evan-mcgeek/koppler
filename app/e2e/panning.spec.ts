// Moving the board, with Space held or the Hand tool, never picks a card and never drops the one picked.
import { at, card, expect, test } from './canvas.ts';

test.use({
  board: {
    env: 'qa',
    mode: 'auto',
    zoom: 1,
    pan: { x: 80, y: 120 },
    nodes: { web: at(0, 0), orders: at(420, 0) },
    edges: [],
  },
});

const picked = (page: import('@playwright/test').Page, id: string) =>
  card(page, id).evaluate(node => node.closest('.svelte-flow__node')?.classList.contains('selected') ?? false);

test('with Space held, a click on a card does not pick it, and moving the board keeps the pick', async ({ page }) => {
  await expect(card(page, 'web')).toBeVisible();
  await card(page, 'web').locator('header').click();
  expect(await picked(page, 'web')).toBe(true);

  await page.keyboard.down('Space');
  await card(page, 'orders').locator('header').click();
  expect(await picked(page, 'orders')).toBe(false);
  expect(await picked(page, 'web')).toBe(true);
  const before = (await card(page, 'web').boundingBox())?.x ?? 0;
  await page.mouse.move(700, 600);
  await page.mouse.down();
  await page.mouse.move(600, 560, { steps: 6 });
  await page.mouse.up();
  await page.keyboard.up('Space');
  expect((await card(page, 'web').boundingBox())?.x).toBe(before - 100);
  expect(await picked(page, 'web')).toBe(true);
});

test('with the Hand tool, a click on a card does not pick it, and moving the board keeps the pick', async ({
  page,
}) => {
  await expect(card(page, 'web')).toBeVisible();
  await card(page, 'web').locator('header').click();
  await page.keyboard.press('h');
  await card(page, 'orders').locator('header').click();
  expect(await picked(page, 'orders')).toBe(false);
  expect(await picked(page, 'web')).toBe(true);
  await page.mouse.move(700, 600);
  await page.mouse.down();
  await page.mouse.move(600, 560, { steps: 6 });
  await page.mouse.up();
  expect(await picked(page, 'web')).toBe(true);
});
