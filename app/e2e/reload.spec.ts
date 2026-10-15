// A running Flutter app's card hot reloads it; Shift-click hot restarts it.
import { actions, at, card, expect, STACK, test } from './canvas.ts';

const mobile = { name: 'Mobile App', kind: 'flutter', slug: 'acme/mobile-app' };
test.use({
  stack: { ...STACK, apps: { ...STACK.apps, mobile } },
  board: { env: 'qa', mode: 'auto', zoom: 1, pan: { x: 60, y: 120 }, nodes: { mobile: at(0, 0) }, edges: [] },
});

test('a running Flutter card hot reloads, and with Shift hot restarts, its app', async ({ page }) => {
  await expect(card(page, 'mobile')).toBeVisible();
  const reload = page.getByRole('button', { name: 'Hot reload Mobile App' });
  await expect(reload).toHaveCount(0);
  const status = {
    live: { env: 'qa', nodes: { mobile: {} } },
    apps: { mobile: { running: [{ device: 'iPhone 16', platform: 'ios', source: 'koppler' }] } },
  };
  await page.route('**/data/status.json', route => route.fulfill({ json: status }));
  await page.route('**/reload?*', route => {
    const { restart } = route.request().postDataJSON() as { restart: boolean };
    return route.fulfill({ json: { said: `${restart ? 'Hot restarted' : 'Hot reloaded'} Mobile App` } });
  });
  await page.reload();
  const bar = await actions(page, 'mobile');
  await bar.getByRole('button', { name: 'Hot reload Mobile App' }).hover();
  await page.screenshot({ path: 'test-results/reload-card.png', clip: { x: 380, y: 60, width: 420, height: 420 } });
  const sent = page.waitForRequest(request => new URL(request.url()).pathname === '/reload');
  await bar.getByRole('button', { name: 'Hot reload Mobile App' }).click();
  expect((await sent).postDataJSON()).toEqual({ app: 'mobile', restart: false });
  await expect(page.getByRole('status').filter({ hasText: 'Hot reloaded Mobile App.' })).toBeVisible();
  const restart = page.waitForRequest(request => new URL(request.url()).pathname === '/reload');
  await bar.getByRole('button', { name: 'Hot reload Mobile App' }).click({ modifiers: ['Shift'] });
  expect((await restart).postDataJSON()).toEqual({ app: 'mobile', restart: true });
  await expect(page.getByRole('status').filter({ hasText: 'Hot restarted Mobile App.' })).toBeVisible();
});
