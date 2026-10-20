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

const box = async (of: import('@playwright/test').Locator) => {
  const drawn = await of.boundingBox();
  if (!drawn) throw new Error('not drawn');
  return drawn;
};
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

test("scrolling over a card's action bar moves the board as it does anywhere else", async ({ page }) => {
  await card(page, 'web').locator('header').click();
  const bar = await box(page.getByRole('toolbar', { name: 'Web Shop actions' }));
  const before = (await box(card(page, 'web'))).x;
  await page.mouse.move(bar.x + 10, bar.y + bar.height / 2);
  await page.mouse.wheel(40, 0);
  await expect.poll(async () => (await card(page, 'web').boundingBox())?.x).toBe(before - 40);
});

test("with the Hand tool, a drag that starts on a card's action bar moves the board", async ({ page }) => {
  await card(page, 'web').locator('header').click();
  await page.keyboard.press('h');
  const bar = await box(page.getByRole('toolbar', { name: 'Web Shop actions' }));
  const before = (await box(card(page, 'web'))).x;
  await page.mouse.move(bar.x + 10, bar.y + bar.height / 2);
  await page.mouse.down();
  await page.mouse.move(bar.x + 110, bar.y + bar.height / 2, { steps: 6 });
  await page.mouse.up();
  expect((await card(page, 'web').boundingBox())?.x).toBe(before + 100);
});
