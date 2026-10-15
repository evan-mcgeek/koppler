// Traces across local apps: started from the bar, then opened there, or for one app from its card.
import { actions, at, card, expect, test } from './canvas.ts';

test.use({
  board: { env: 'qa', mode: 'auto', zoom: 1, pan: { x: 60, y: 60 }, nodes: { orders: at(0, 0) }, edges: [] },
});

test('the bar starts collecting traces; once they run, it and each running card open them', async ({ page }) => {
  let traces: { state: string; view?: string } = { state: 'off' };
  await page.route('**/data/status.json', route =>
    route.fulfill({ json: { apps: {}, live: { env: 'qa', nodes: { orders: {} } }, traces } }),
  );
  const asked: unknown[] = [];
  // Never a real collector from a test.
  await page.route('**/traces?*', async route => {
    asked.push(route.request().postDataJSON());
    await route.fulfill({ json: { asked: true } });
  });
  await page.reload();
  await page.getByRole('button', { name: 'Collect traces' }).click();
  expect(asked).toEqual([{ on: true }]);
  await expect(page.getByRole('status').filter({ hasText: 'Collecting traces.' })).toBeVisible();
  await expect((await actions(page, 'orders')).getByRole('link', { name: 'Traces of Orders API' })).toHaveCount(0);

  traces = { state: 'on', view: 'http://localhost:16686/search' };
  await expect(page.getByRole('button', { name: 'Open traces' })).toBeVisible();
  await card(page, 'orders').hover();
  await expect((await actions(page, 'orders')).getByRole('link', { name: 'Traces of Orders API' })).toHaveAttribute(
    'href',
    'http://localhost:16686/search?service=orders',
  );
  await page.screenshot({ path: 'test-results/next-traces.png' });
});
