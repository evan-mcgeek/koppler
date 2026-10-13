// The new canvas's board shortcuts: undo and redo, Clear, Fit, and the keyboard on cards.
import type { Page } from '@playwright/test';
import { test, expect, nextEdit } from './canvas.ts';

const card = (page: Page, id: string) => page.locator(`.svelte-flow__node[data-id="${id}"]`);
const cards = (page: Page) => page.locator('.svelte-flow__node-app');
const cables = (page: Page) => page.locator('.svelte-flow__edge');
const at = (x: number, y: number) => ({ x, y, run: 'cli', branch: 'main' });
test.use({
  board: {
    env: 'qa',
    mode: 'auto',
    zoom: 1,
    pan: { x: 120, y: 80 },
    nodes: { web: at(0, 0), orders: at(420, 0), catalog: at(210, 320) },
    edges: [{ from: 'web', to: 'orders', fromSide: 'right', toSide: 'left' }],
  },
});

test('a removed card comes back with its cable on undo, and goes again on redo', async ({ page }) => {
  const undo = page.getByRole('button', { name: 'Undo' });
  const redo = page.getByRole('button', { name: 'Redo' });
  await expect(cards(page)).toHaveCount(3);
  await expect(undo).toBeDisabled();
  await nextEdit(page);
  await card(page, 'web').getByRole('button', { name: 'Remove Web Shop' }).click();
  await expect(cards(page)).toHaveCount(2);
  await expect(cables(page)).toHaveCount(0);
  await undo.click();
  await expect(card(page, 'web')).toBeVisible();
  await expect(cables(page)).toHaveCount(1);
  await expect(undo).toBeDisabled();
  await redo.click();
  await expect(cards(page)).toHaveCount(2);
  await page.keyboard.press('ControlOrMeta+z');
  await expect(cards(page)).toHaveCount(3);
  await page.keyboard.press('ControlOrMeta+Shift+z');
  await expect(cards(page)).toHaveCount(2);
});

test('a drag is one step to undo', async ({ page }) => {
  await expect(cards(page)).toHaveCount(3);
  await nextEdit(page);
  const before = await card(page, 'catalog').boundingBox();
  if (!before) throw new Error('no card');
  await page.mouse.move(before.x + 80, before.y + 20);
  await page.mouse.down();
  await page.mouse.move(before.x + 260, before.y + 120, { steps: 12 });
  await page.mouse.up();
  expect((await card(page, 'catalog').boundingBox())?.x).toBeGreaterThan(before.x + 100);
  await page.getByRole('button', { name: 'Undo' }).click();
  await expect.poll(async () => (await card(page, 'catalog').boundingBox())?.x).toBe(before.x);
  await expect(page.getByRole('button', { name: 'Undo' })).toBeDisabled();
});

test('Clear empties the board, and undo brings it back', async ({ page }) => {
  await expect(cards(page)).toHaveCount(3);
  await nextEdit(page);
  await page.getByRole('button', { name: 'Clear' }).click();
  await expect(cards(page)).toHaveCount(0);
  await expect(page.getByText('0 of 4 on the board')).toBeVisible();
  await page.getByRole('button', { name: 'Undo' }).click();
  await expect(cards(page)).toHaveCount(3);
  await expect(cables(page)).toHaveCount(1);
});

test('F fits the board, Delete removes the picked cards, and a focused card moves with the arrows', async ({
  page,
}) => {
  await page.mouse.move(700, 700);
  await page.mouse.wheel(3000, 3000);
  await expect(card(page, 'web')).not.toBeInViewport();
  await page.keyboard.press('f');
  await expect(card(page, 'web')).toBeInViewport();
  await expect(card(page, 'catalog')).toBeInViewport();

  const before = await card(page, 'orders').boundingBox();
  await card(page, 'orders').focus();
  await page.keyboard.press('ArrowRight');
  await page.keyboard.press('ArrowRight');
  expect((await card(page, 'orders').boundingBox())?.x).toBeGreaterThan(before?.x ?? 0);
  await page.keyboard.press('Delete');
  await expect(card(page, 'orders')).toHaveCount(0);
  await expect(cables(page)).toHaveCount(0);
  // Typing in a card's note does not remove the card.
  await card(page, 'web').getByRole('button', { name: 'Add a note for the agent' }).click();
  await card(page, 'web').getByLabel('Note for the agent').fill('ab');
  await page.keyboard.press('Backspace');
  await page.keyboard.press('Delete');
  await expect(card(page, 'web')).toBeVisible();
});
