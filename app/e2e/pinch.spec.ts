// A pinch zooms the board only: over a panel it does nothing, never the whole page.
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
  // A trackpad pinch reaches the page as a wheel flagged with Ctrl, though no Ctrl key is held.
  await page
    .getByRole('complementary', { name: 'Board and apps' })
    .evaluate(el =>
      el.dispatchEvent(new WheelEvent('wheel', { deltaY: 40, ctrlKey: true, bubbles: true, cancelable: true })),
    );
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
