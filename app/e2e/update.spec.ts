// A newer Koppler installed while the canvas runs: the canvas names both versions and restarts itself on a click.
import { at, card, expect, test } from './canvas.ts';

test.use({ board: { env: 'qa', mode: 'auto', nodes: { web: at(0, 0) }, edges: [] } });

test('a newer Koppler installed: the canvas says so, and its button restarts the canvas and reloads the page', async ({
  page,
}) => {
  let status: Record<string, unknown> = {
    apps: {},
    startedAt: '2026-11-01T10:00:00.000Z',
    restart: { running: '0.3.6', installed: '0.3.7' },
  };
  await page.route('**/data/status.json', route => route.fulfill({ json: status }));
  const asked: string[] = [];
  await page.route('**/restart-canvas?*', route => {
    asked.push(route.request().method());
    return route.fulfill({ json: { ok: true } });
  });
  await page.reload();
  await expect(card(page, 'web')).toBeVisible();
  const notice = page.getByRole('alert').filter({ hasText: 'Koppler 0.3.7' });
  await expect(notice).toContainText('Koppler 0.3.7 is installed, and this canvas still runs 0.3.6.');
  await page.screenshot({ path: 'test-results/update-notice.png' });
  await notice.getByRole('button', { name: 'Restart canvas' }).click();
  expect(asked).toEqual(['POST']);
  await expect(notice).toContainText('Restarting');
  // The server comes back started anew: the page loads again, on the new code.
  const loaded = page.waitForEvent('load');
  status = { apps: {}, startedAt: '2026-11-01T10:05:00.000Z' };
  await loaded;
  await expect(card(page, 'web')).toBeVisible();
  await expect(page.getByRole('alert').filter({ hasText: 'is installed' })).toHaveCount(0);
});
