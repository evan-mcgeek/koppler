// A pinch (a wheel with Ctrl) zooms the board only: over a panel it does nothing, never the whole page.
import { at, expect, test } from './canvas.ts';

test.use({
  board: { env: 'qa', mode: 'auto', zoom: 1, pan: { x: 60, y: 60 }, nodes: { orders: at(0, 0) }, edges: [] },
});

test('a pinch over the side pane is ignored, and over the board it zooms the board', async ({ page }) => {
  await expect(page.getByRole('complementary', { name: 'Board and apps' })).toBeVisible();
  await page.evaluate(() => {
    const seen: boolean[] = [];
    (window as unknown as { pinches: boolean[] }).pinches = seen;
    // Last in the bubbling order: whether anything stopped the browser from zooming the page.
    window.addEventListener('wheel', ev => {
      if (ev.ctrlKey) seen.push(ev.defaultPrevented);
    });
  });
  const pinches = () => page.evaluate(() => (window as unknown as { pinches: boolean[] }).pinches);
  const side = await page.getByRole('complementary', { name: 'Board and apps' }).boundingBox();
  if (!side) throw new Error('no side pane');
  await page.mouse.move(side.x + side.width / 2, side.y + side.height / 2);
  await page.keyboard.down('Control');
  await page.mouse.wheel(0, 40);
  await page.keyboard.up('Control');
  await expect.poll(pinches).toEqual([true]);
  await expect(page.getByText('100%', { exact: true })).toBeVisible();

  const pane = await page.locator('.svelte-flow__pane').boundingBox();
  if (!pane) throw new Error('no board');
  await page.mouse.move(pane.x + pane.width / 2, pane.y + pane.height / 2);
  await page.keyboard.down('Control');
  await page.mouse.wheel(0, -100);
  await page.keyboard.up('Control');
  await expect(page.getByText('100%', { exact: true })).toHaveCount(0);
});
