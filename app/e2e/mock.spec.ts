// A card set to Mock: Koppler answers the app's mock responses from the stack in its place.
import { actions, at, card, expect, sent, STACK, test } from './canvas.ts';

const { orders } = STACK.apps;
test.use({
  stack: {
    ...STACK,
    apps: { ...STACK.apps, orders: { ...orders, mock: [{ method: 'GET', path: '/orders/*', body: { id: 7 } }] } },
  },
  board: {
    env: 'qa',
    mode: 'auto',
    zoom: 0.8,
    pan: { x: 80, y: 60 },
    nodes: { web: at(0, 0), orders: at(420, 0) },
    edges: [{ from: 'web', to: 'orders', fromSide: 'right', toSide: 'left' }],
  },
});

test('an app with mock responses can be set to Mock: the card drops what a mock has no use for, and Run sends it', async ({
  page,
  canvas,
}) => {
  const starters = (id: string) => card(page, id).getByRole('group', { name: 'Who starts it' });
  await expect(starters('web').getByRole('radio')).toHaveCount(2);
  await expect(card(page, 'orders').getByLabel('Branch')).toBeVisible();
  await starters('orders').getByRole('radio', { name: 'Mock' }).check();
  await expect(card(page, 'orders').getByLabel('Branch')).toHaveCount(0);
  await expect(card(page, 'orders').getByText('Tunnels')).toHaveCount(0);
  await card(page, 'orders').screenshot({ path: 'test-results/mock-card.png' });

  await page.getByRole('button', { name: 'Run', exact: true }).click();
  const review = page.getByRole('dialog');
  await expect(review.locator('.lines li').filter({ hasText: 'Starts' })).toContainText(
    'A mock: its responses from the stack answer in its place',
  );
  await expect(review).not.toContainText('Database (Postgres)');
  await review.getByRole('button', { name: 'Run', exact: true }).click();
  await expect.poll(() => sent(canvas.temp).length).toBe(1);
  const [run] = sent(canvas.temp);
  expect(run?.text).toContain('MOCK Orders API: Koppler answers its mock responses from the stack');
  expect(run?.text).toContain('  Web Shop → local Orders API');
  expect(run?.data['nodes']).toContainEqual({ id: 'orders', branch: null, run: 'mock' });
});

test("an app's mock responses are set in its settings", async ({ page }) => {
  await (await actions(page, 'orders')).getByRole('button', { name: 'Settings for Orders API' }).click();
  const panel = page.getByRole('dialog', { name: 'Orders API' });
  const mock = panel.getByRole('group', { name: 'Mock responses' });
  await expect(mock.locator('summary').getByText('GET /orders/*')).toBeVisible();
  await mock.scrollIntoViewIfNeeded();
  await expect(mock.getByLabel('Path', { exact: true })).toHaveValue('/orders/*');
  await panel.screenshot({ path: 'test-results/mock-settings.png' });
});
