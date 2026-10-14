// One app card picked: it, its cables and the cards they reach stay bright; the rest of the board fades back.
import { at, card, expect, test } from './canvas.ts';

test.use({
  board: {
    env: 'qa',
    mode: 'auto',
    zoom: 0.8,
    pan: { x: 60, y: 60 },
    nodes: { web: at(0, 0), orders: at(420, 0), payments: at(840, 0), catalog: at(420, 420) },
    edges: [
      { from: 'web', to: 'orders', fromSide: 'right', toSide: 'left' },
      { from: 'orders', to: 'payments', fromSide: 'right', toSide: 'left' },
      { from: 'web', to: 'catalog', fromSide: 'bottom', toSide: 'left' },
    ],
  },
});

test('picking an app dims what it does not touch and lights its own cables, until nothing is picked', async ({
  page,
}) => {
  const dimmed = (id: string) =>
    card(page, id)
      .locator('.card')
      .evaluate(el => el.classList.contains('dimmed'));
  const cable = (id: string) => page.locator(`.svelte-flow__edge[data-id="${id}"] g`).first();
  await expect(card(page, 'orders')).toBeVisible();
  await card(page, 'payments').locator('h3, header').first().click();
  await expect.poll(() => dimmed('web')).toBe(true);
  expect(await dimmed('catalog')).toBe(true);
  expect(await dimmed('payments')).toBe(false);
  expect(await dimmed('orders')).toBe(false);
  await expect(cable('orders>payments')).toHaveClass(/\blit\b/);
  await expect(cable('web>orders')).toHaveClass(/\bdimmed\b/);
  await page.screenshot({ path: 'test-results/next-focus.png' });

  await page.locator('.svelte-flow__pane').click({ position: { x: 20, y: 600 } });
  await expect.poll(() => dimmed('web')).toBe(false);
  await expect(cable('web>orders')).not.toHaveClass(/\bdimmed\b/);
});
