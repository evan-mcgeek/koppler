// Zoomed out, a cable is still unplugged in one click: its mark and the room the pointer finds keep their size on screen.
import type { Page } from '@playwright/test';
import { at, expect, test } from './canvas.ts';

const cable = (page: Page, id: string) => page.locator(`.svelte-flow__edge[data-id="${id}"]`);

test.use({
  board: {
    env: 'qa',
    mode: 'auto',
    zoom: 0.3,
    pan: { x: 60, y: 60 },
    nodes: { web: at(0, 0), orders: at(700, 0) },
    edges: [{ from: 'web', to: 'orders', fromSide: 'right', toSide: 'left' }],
  },
});

test("a cable's unplug mark keeps its size on screen, so pointing at the cable and clicking it is one click", async ({
  page,
}) => {
  const wire = cable(page, 'web>orders').locator('.wire');
  const at = await wire.evaluate(el => {
    const box = el.getBoundingClientRect();
    return { x: box.x + box.width / 2, y: box.y + box.height / 2 };
  });
  // Near the cable, not on its thin line: what the pointer finds is as wide as close up.
  await page.mouse.move(at.x - 30, at.y + 6);
  const mark = cable(page, 'web>orders').locator('.cut');
  await expect(mark).toBeVisible();
  expect((await mark.boundingBox())?.width).toBeGreaterThan(15);
  await mark.click();
  await expect(cable(page, 'web>orders')).toHaveCount(0);
});
