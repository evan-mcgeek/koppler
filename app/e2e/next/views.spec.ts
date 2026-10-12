// The new canvas's two views: Edit sets the board up, Live shows it as it runs, in the same places.
import type { Page } from '@playwright/test';
import { test, expect } from '../canvas.ts';

const card = (page: Page, id: string) => page.locator(`.svelte-flow__node[data-id="${id}"]`);
const at = (x: number, y: number) => ({ x, y, run: 'cli', branch: 'main' });
const corner = async (page: Page, id: string) => {
  const box = await card(page, id).boundingBox();
  return [Math.round(box?.x ?? 0), Math.round(box?.y ?? 0)];
};
test.use({
  start: 'next/',
  board: {
    env: 'qa',
    mode: 'auto',
    zoom: 0.8,
    pan: { x: 80, y: 60 },
    nodes: { web: at(0, 0), orders: at(480, 0) },
    edges: [{ from: 'web', to: 'orders', fromSide: 'right', toSide: 'left' }],
  },
});

test('Live shows the same board in the same places as cards to read, and nothing on it can be changed', async ({
  page,
}) => {
  await expect(card(page, 'web').locator('.body')).toBeVisible();
  const before = [await corner(page, 'web'), await corner(page, 'orders')];
  await page.getByRole('radio', { name: 'Live' }).check();
  await expect(card(page, 'web').locator('.body')).toHaveCount(0);
  await expect(card(page, 'web').locator('.glance')).toContainText('main');
  await expect(card(page, 'web').getByRole('button', { name: 'Remove Web Shop' })).toBeHidden();
  expect([await corner(page, 'web'), await corner(page, 'orders')]).toEqual(before);
  await page.screenshot({ path: 'test-results/next-live-view.png' });

  // A card does not move, and a cable is not unplugged by a click.
  const [x = 0, y = 0] = before[0] ?? [];
  await page.mouse.move(x + 60, y + 20);
  await page.mouse.down();
  await page.mouse.move(x + 200, y + 120, { steps: 6 });
  await page.mouse.up();
  expect(await corner(page, 'web')).toEqual(before[0]);
  const wire = await page
    .locator('.svelte-flow__edge .wire')
    .evaluate(el => [
      el.getBoundingClientRect().x + el.getBoundingClientRect().width / 2,
      el.getBoundingClientRect().y,
    ]);
  await page.mouse.click(wire[0] ?? 0, wire[1] ?? 0);
  await expect(page.locator('.svelte-flow__edge')).toHaveCount(1);

  await page.keyboard.press('e');
  await expect(page.getByRole('radio', { name: 'Edit' })).toBeChecked();
  await expect(card(page, 'web').locator('.body')).toBeVisible();
  expect([await corner(page, 'web'), await corner(page, 'orders')]).toEqual(before);
  await expect(page.getByRole('button', { name: 'Undo' })).toBeDisabled();
  await page.keyboard.press('l');
  await expect(page.getByRole('radio', { name: 'Live' })).toBeChecked();
});
