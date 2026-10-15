// A card dragged until one of its cables is almost straight snaps so it is; dragged further, it goes where it is put.
import { at, card, expect, test } from './canvas.ts';

test.use({
  board: {
    env: 'qa',
    mode: 'auto',
    zoom: 1,
    pan: { x: 60, y: 60 },
    nodes: { web: at(0, 0), payments: at(520, 120) },
    edges: [{ from: 'web', to: 'payments', fromSide: 'right', toSide: 'left' }],
  },
});

test('a cable dragged close to straight snaps straight, like a magnet', async ({ page }) => {
  const plug = page.locator('.ends .plug[data-cable="web>payments"]');
  const socket = page.locator('.ends .socket[data-cable="web>payments"]');
  const ends = async () => {
    const [a, b] = await Promise.all([plug.boundingBox(), socket.boundingBox()]);
    return Math.round(((b?.y ?? 0) + (b?.height ?? 0) / 2 - ((a?.y ?? 0) + (a?.height ?? 0) / 2)) * 10) / 10 || 0;
  };
  await expect(socket).toBeVisible();
  const off = await ends();
  expect(Math.abs(off)).toBeGreaterThan(20);
  const grab = await card(page, 'payments').locator('header').boundingBox();
  if (!grab) throw new Error('not on the page');
  const from = { x: grab.x + 60, y: grab.y + grab.height / 2 };
  // Within a few pixels of level, and let go: the cable runs straight.
  await page.mouse.move(from.x, from.y);
  await page.mouse.down();
  await page.mouse.move(from.x, from.y - off, { steps: 10 });
  // The drag starts a little late: whatever is left, short of level by a few pixels.
  const left = await ends();
  if (left !== 0) await page.mouse.move(from.x, from.y - off - left + 5, { steps: 4 });
  // Snapped while still held: the cable goes a shade darker, so the snap shows.
  const lit = page.locator('.svelte-flow__edge[data-id="web>payments"] g.snapped');
  await expect(lit).toHaveCount(1);
  await page.waitForTimeout(400);
  await page.screenshot({ path: 'test-results/next-cable-snap.png' });
  await page.mouse.up();
  await expect.poll(ends).toBe(0);
  await expect(lit).toHaveCount(0);
  // Well away from level, it stays where it is put.
  const again = await card(page, 'payments').locator('header').boundingBox();
  if (!again) throw new Error('not on the page');
  await page.mouse.move(again.x + 60, again.y + again.height / 2);
  await page.mouse.down();
  await page.mouse.move(again.x + 60, again.y + again.height / 2 + 30, { steps: 10 });
  await page.mouse.up();
  await expect.poll(ends).toBeGreaterThan(15);
});

test.describe('a tunnel card', () => {
  test.use({
    board: { env: 'qa', mode: 'auto', zoom: 1, pan: { x: 60, y: 60 }, nodes: { orders: at(0, 0) }, edges: [] },
  });

  test('snaps its middle in line with its app when dragged close to it, its link darker while it is', async ({
    page,
  }) => {
    const tunnel = page.locator('.svelte-flow__node-tunnel').first();
    await expect(tunnel).toBeVisible();
    const middle = async () => {
      const [a, t] = await Promise.all([card(page, 'orders').boundingBox(), tunnel.boundingBox()]);
      // `|| 0`: a difference under half a pixel rounds to -0.
      return Math.round((t?.x ?? 0) + (t?.width ?? 0) / 2 - ((a?.x ?? 0) + (a?.width ?? 0) / 2)) || 0;
    };
    const box = await tunnel.boundingBox();
    if (!box) throw new Error('not on the page');
    const from = { x: box.x + 30, y: box.y + 10 };
    // Away from its app's middle first, then back to within a few pixels of it.
    await page.mouse.move(from.x, from.y);
    await page.mouse.down();
    await page.mouse.move(from.x + 140, from.y + 60, { steps: 8 });
    const off = await middle();
    await page.mouse.move(from.x + 140 - off + 4, from.y + 60, { steps: 4 });
    const left = await middle();
    if (Math.abs(left) > 6) await page.mouse.move(from.x + 140 - off + 4 - left + 3, from.y + 60, { steps: 2 });
    await expect(page.locator('.links .link.snapped')).toHaveCount(1);
    await page.screenshot({ path: 'test-results/next-tunnel-snap.png' });
    await page.mouse.up();
    await expect.poll(middle).toBe(0);
    await expect(page.locator('.links .link.snapped')).toHaveCount(0);
  });
});
