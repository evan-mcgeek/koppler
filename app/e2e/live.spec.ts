// The new canvas shows what is running: the server's live status on the cards, the list, the tunnel and the cables.
import fs from 'node:fs';
import net, { type AddressInfo } from 'node:net';
import path from 'node:path';
import type { Page } from '@playwright/test';
import { test, expect } from './canvas.ts';

const card = (page: Page, id: string) => page.locator(`.svelte-flow__node[data-id="${id}"]`);
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

test('apps of the run in progress show whether they answer, with their steps; the rest stay quiet', async ({
  page,
  canvas,
}) => {
  // Before anything runs: no dots, dashed cables.
  await page.waitForResponse(answer => answer.url().includes('data/status.json'));
  await expect(card(page, 'orders')).toBeVisible();
  await expect(page.locator('.svelte-flow__edge g.idle')).toHaveCount(2);
  await expect(card(page, 'orders').getByRole('img')).toHaveCount(0);

  // Web Shop and Orders API answer on ports of their own; Payments API was started and does not.
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
  // The agent's own checklist for Orders API carries a command; Koppler's own run has plain steps.
  const signIn = {
    label: 'Sign in',
    state: 'user',
    detail: 'Sign in to AWS.',
    copy: 'aws sso login --profile acme-qa',
  };
  write('status', {
    apps: {
      web: { port: port(web) },
      orders: {
        port: port(orders),
        steps: [{ label: 'Branch', state: 'done' }, signIn, { label: 'Start', state: 'todo' }],
      },
      payments: { port: 1 },
    },
  });
  write('progress', {
    run: 'run12345',
    env: 'qa',
    apps: {
      web: [{ label: 'Start', state: 'done' }],
      orders: [],
      payments: [{ label: 'Start', state: 'failed', detail: 'The port is taken.' }],
    },
  });
  try {
    await expect(card(page, 'orders').getByRole('img', { name: 'Running' })).toBeVisible();
    await expect(card(page, 'payments').getByRole('img', { name: 'Not answering' })).toBeVisible();
    await expect(page.getByRole('complementary').getByRole('img', { name: 'Running' })).toHaveCount(2);
    await expect(page.getByRole('complementary').getByRole('img', { name: 'Not answering' })).toHaveCount(1);
    // The cable between the two that answer is solid; the one to the app that does not stays dashed.
    await expect(page.locator('.svelte-flow__edge[data-id="web>orders"] g.idle')).toHaveCount(0);
    await expect(page.locator('.svelte-flow__edge[data-id="orders>payments"] g.idle')).toHaveCount(1);

    const steps = card(page, 'orders').getByRole('button', { name: /Waiting on you: Sign in/ });
    await expect(steps).toBeVisible();
    await steps.click();
    await expect(card(page, 'orders').locator('.step')).toHaveText([
      /Branch/,
      /Sign in\s*Sign in to AWS/,
      /Start\s*Running\./,
    ]);
    await expect(card(page, 'orders').locator('.cmd code')).toHaveText('aws sso login --profile acme-qa');
    // The card grew: its tunnel card is still under it, not behind it.
    const grown = await card(page, 'orders').boundingBox();
    const tunnel = await page.locator('.svelte-flow__node-tunnel').boundingBox();
    expect(tunnel?.y).toBeGreaterThan((grown?.y ?? 0) + (grown?.height ?? 0));
    await expect(card(page, 'payments').getByRole('button', { name: /Failed: Start/ })).toBeVisible();
    await expect(card(page, 'payments').locator('.why')).toHaveText('The port is taken.');
    await page.screenshot({ path: 'test-results/next-live.png' });

    // On another environment's board the same apps are not started.
    await page.getByRole('radio', { name: 'PROD' }).check();
    await expect(card(page, 'orders').getByRole('img')).toHaveCount(0);
    await expect(card(page, 'orders').locator('.progress')).toHaveCount(0);
  } finally {
    web.close();
    orders.close();
  }
});
