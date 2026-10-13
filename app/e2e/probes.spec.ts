// The new canvas tests a cable: the light at its socket says whether the call reaches the local app.
import fs from 'node:fs';
import net, { type AddressInfo } from 'node:net';
import path from 'node:path';
import { test, expect, actions } from './canvas.ts';

const at = (x: number, y: number) => ({ x, y, run: 'cli', branch: 'main' });
test.use({
  board: {
    env: 'qa',
    mode: 'auto',
    zoom: 0.8,
    pan: { x: 80, y: 60 },
    nodes: { web: at(0, 0), orders: at(420, 0), payments: at(840, 0) },
    edges: [
      { from: 'web', to: 'orders', fromSide: 'right', toSide: 'left' },
      { from: 'orders', to: 'payments', fromSide: 'right', toSide: 'left' },
    ],
  },
});

test('a cable is tested once both its apps answer, and again on a click at its socket', async ({ page, canvas }) => {
  const light = (id: string) => page.locator(`.light[data-light="${id}"]`);
  const socket = (id: string) => page.locator(`.socket[data-cable="${id}"]`);
  // Nothing runs: no cable has a light to read.
  await expect(light('web>orders')).not.toHaveAttribute('data-state');

  // The server's own test is stood in for: the first one passes, later ones fail.
  const asked: { from?: string; to?: string; app?: string; env: string; auto?: boolean }[] = [];
  const tunnels: object[] = [];
  await page.route('**/cable-test?*', async route => {
    const body = route.request().postDataJSON() as (typeof asked)[number];
    if (body.app) {
      tunnels.push(body);
      await route.fulfill({ json: { ok: true, unsure: true, text: 'Open', detail: 'The port is open.' } });
      return;
    }
    asked.push(body);
    const answer =
      asked.length === 1
        ? { ok: true, text: 'Works', detail: 'Orders API answered in 12 ms.' }
        : { ok: false, text: 'No answer', detail: 'Orders API does not answer on localhost:5001.' };
    await route.fulfill({ json: answer });
  });
  const listen = () =>
    new Promise<net.Server>(resolve => {
      const server = net.createServer();
      server.listen(0, '127.0.0.1', () => {
        resolve(server);
      });
    });
  const [web, orders] = [await listen(), await listen()];
  const port = (server: net.Server) => (server.address() as AddressInfo).port;
  const write = (name: string, value: unknown) => {
    fs.writeFileSync(path.join(canvas.temp, `${name}.json`), JSON.stringify(value));
  };
  // Web Shop and Orders API answer; Payments API was started and does not.
  write('status', { apps: { web: { port: port(web) }, orders: { port: port(orders) }, payments: { port: 1 } } });
  write('progress', { run: 'run12345', env: 'qa', apps: { web: [], orders: [], payments: [] } });
  try {
    await expect(light('web>orders')).toHaveAttribute('data-state', 'ok');
    expect(asked).toEqual([{ env: 'qa', from: 'web', to: 'orders', auto: true }]);
    await expect(socket('web>orders').locator('title')).toHaveText(
      'Works. Orders API answered in 12 ms. Click to test again.',
    );
    // Orders API's way to its database through the tunnel is tested too; it could not be told either way.
    const link = 'orders>tunnel:db.qa.acme.example:5432';
    await expect(light(link)).toHaveAttribute('data-state', 'warn');
    expect(tunnels).toEqual([{ env: 'qa', app: 'orders', host: 'localhost', port: 5432, original: 5432, auto: true }]);
    await page.locator(`.socket[data-link="${link}"]`).click();
    await expect.poll(() => tunnels.length).toBe(2);
    await expect(page.getByRole('alert')).toContainText('The port is open.');
    await page.getByRole('alert').getByRole('button', { name: 'Dismiss' }).click();
    // The cable to the app that does not answer waits: a light, not tested yet.
    await expect(light('orders>payments')).toHaveAttribute('data-state', 'idle');
    // Its process is up without answering yet: a test by hand says it is starting, and waits.
    await page.route('**/data/status.json', async route => {
      const answer = await route.fetch();
      const status = (await answer.json()) as Record<string, unknown>;
      await route.fulfill({ json: { ...status, running: ['web', 'orders', 'payments'] } });
    });
    const waits = page.getByRole('button', { name: 'Test that local Payments API answers Orders API' });
    await expect((await actions(page, 'payments')).getByRole('button', { name: 'Stop Payments API' })).toBeVisible();
    await expect(async () => {
      await waits.focus();
      await page.keyboard.press('Enter');
      await expect(
        page.getByText('Payments API is starting. Koppler checks again once it answers.', { exact: true }),
      ).toBeVisible({ timeout: 1000 });
    }).toPass();
    await expect(light('orders>payments')).toHaveAttribute('data-state', 'busy');
    await page.getByRole('button', { name: 'Dismiss' }).click();
    await page.screenshot({ path: 'test-results/next-probe-ok.png' });

    await socket('web>orders').click();
    await expect(light('web>orders')).toHaveAttribute('data-state', 'bad');
    await expect(page.getByRole('alert')).toContainText('Orders API does not answer on localhost:5001.');
    expect(asked[1]).toEqual({ env: 'qa', from: 'web', to: 'orders' });
    await page.screenshot({ path: 'test-results/next-probe-bad.png' });

    // In the Live view the light is still there to press.
    await page.getByRole('radio', { name: 'Live' }).check();
    await socket('web>orders').click();
    await expect.poll(() => asked.length).toBe(3);
  } finally {
    web.close();
    orders.close();
  }
});
