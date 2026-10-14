// Zoomed out, a card is drawn short, in the middle of the room its full form takes: the cables on its sides stay put.
import { at, card, expect, test } from './canvas.ts';

test.use({
  board: {
    env: 'qa',
    mode: 'auto',
    zoom: 1,
    pan: { x: 60, y: 60 },
    // A note makes the full card much taller than its short form, so the two cards shrink by different amounts.
    nodes: {
      web: at(0, 0),
      orders: {
        ...at(520, 0),
        note: 'Use the test merchant account, and keep the sandbox webhook pointed at the local API.',
      },
    },
    edges: [{ from: 'web', to: 'orders', fromSide: 'right', toSide: 'left' }],
  },
});

test('a cable between two cards runs the same way when the cards turn short', async ({ page }) => {
  const plug = page.locator('.ends .plug[data-cable="web>orders"]');
  const socket = page.locator('.ends .socket[data-cable="web>orders"]');
  // Where a point on screen is on the board.
  const onBoard = async (dot: typeof plug) => {
    const [box, transform] = await Promise.all([
      dot.boundingBox(),
      page.locator('.svelte-flow__viewport').evaluate(el => {
        const pane = el.closest('.svelte-flow')?.getBoundingClientRect();
        const [, x = 0, y = 0, k = 1] =
          /translate\(([-\d.]+)px, *([-\d.]+)px\) scale\(([\d.]+)\)/.exec(el.style.transform)?.map(Number) ?? [];
        return { x: x + (pane?.x ?? 0), y: y + (pane?.y ?? 0), k };
      }),
    ]);
    return Math.round(((box?.y ?? 0) + (box?.height ?? 0) / 2 - transform.y) / transform.k);
  };
  await expect(socket).toBeVisible();
  const full = [await onBoard(plug), await onBoard(socket)];
  // Zoomed out past the point where cards turn short.
  for (let step = 0; step < 6; step++) {
    await page.getByRole('button', { name: 'Zoom out' }).click();
    await page.waitForTimeout(250);
  }
  await expect(card(page, 'orders').locator('.card.short')).toHaveCount(1);
  await page.waitForTimeout(300);
  const short = [await onBoard(plug), await onBoard(socket)];
  // The board closes up as a whole; what must not change is how the cable runs between its two cards.
  const slant = (ends: number[]) => (ends[1] ?? 0) - (ends[0] ?? 0);
  expect(Math.abs(slant(short) - slant(full))).toBeLessThanOrEqual(2);
});
