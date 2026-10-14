// A card names its app's state: waiting on another app, building, failed to start, or missing a secret.
import { at, card, expect, test } from './canvas.ts';

test.use({
  board: {
    env: 'qa',
    mode: 'auto',
    zoom: 0.8,
    pan: { x: 40, y: 40 },
    nodes: { web: at(0, 0), orders: at(420, 0), payments: at(840, 0), catalog: at(420, 420) },
    edges: [],
  },
});

test('each card says its state in words, with a dot of its colour', async ({ page }) => {
  const status = {
    live: { env: 'qa', nodes: { web: {}, orders: {}, payments: {}, catalog: {} } },
    apps: {
      web: { state: { state: 'waiting', detail: 'Waiting for Orders API.' } },
      orders: {
        port: 5001,
        listening: false,
        state: { state: 'building', detail: 'Nothing answers on port 5001 yet.' },
      },
      payments: { state: { state: 'failed-to-start', detail: 'payments exited right away' } },
    },
    secrets: { catalog: { qa: [{ name: 'Db__Password', stored: false }] } },
  };
  await page.route('**/data/status.json', route => route.fulfill({ json: status }));
  await page.reload();
  await expect(card(page, 'web')).toContainText('Waiting for Orders API.');
  await expect(card(page, 'web').getByRole('img', { name: 'Waiting' })).toBeVisible();
  await expect(card(page, 'orders')).toContainText('Building. Nothing answers on port 5001 yet.');
  await expect(card(page, 'payments')).toContainText('Failed to start: payments exited right away');
  await expect(card(page, 'payments').getByRole('img', { name: 'Failed to start' })).toBeVisible();
  await expect(card(page, 'catalog')).toContainText('Secret missing: Db__Password. Set it under Credentials.');
  await page.screenshot({ path: 'test-results/next-states.png' });
});
