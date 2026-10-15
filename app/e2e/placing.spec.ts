// Where a card goes when it is added with a click: beside the cards already there, in line with them.
import { card, expect, test } from './canvas.ts';

test.use({ board: { env: 'qa', mode: 'auto', nodes: {}, edges: [] } });

test('apps added one after another line up in a row, a gap apart', async ({ page }) => {
  const cdp = await page.context().newCDPSession(page);
  await cdp.send('Emulation.setCPUThrottlingRate', { rate: 6 });
  for (const name of ['Web Shop', 'Orders API', 'Payments API'])
    await page
      .getByRole('button', { name: `Add ${name} to the board`, exact: true })
      .first()
      .click();
  await expect(page.locator('.svelte-flow__node-app')).toHaveCount(3);
  await page.waitForTimeout(600);
  const box = async (id: string) => (await card(page, id).boundingBox()) ?? { x: 0, y: 0, width: 0, height: 0 };
  const [web, orders, payments] = [await box('web'), await box('orders'), await box('payments')];
  expect([Math.round(orders.y - web.y), Math.round(payments.y - web.y)]).toEqual([0, 0]);
  expect(Math.round(orders.x - (web.x + web.width))).toBe(Math.round(payments.x - (orders.x + orders.width)));
});
