// The new canvas's health light and Flow check: the board at a glance, and every connection tested in one go.
import fs from 'node:fs';
import net, { type AddressInfo } from 'node:net';
import path from 'node:path';
import { at, expect, test } from './canvas.ts';

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

test('the light sums up the board, and the Flow check tests every connection and hands failures to the agent', async ({
  page,
  canvas,
}) => {
  const chip = page.locator('header .chip');
  await expect(chip).toHaveText('Nothing running');
  await chip.click();
  const check = page.getByRole('dialog', { name: 'Flow check' });
  await expect(check).toContainText('Press Run to start the apps on your board.');
  await page.keyboard.press('Escape');

  // The server's tests are stood in for: everything about Payments API fails, the tunnel cannot be told, the rest works.
  type Asked = { node?: string; from?: string; to?: string; app?: string };
  await page.route('**/cable-test?*', async route => {
    const asked = route.request().postDataJSON() as Asked;
    const fails = asked.node === 'payments' || asked.to === 'payments';
    const answer = asked.app
      ? { ok: true, unsure: true, text: 'Open, not logged in', detail: 'The port is open.' }
      : fails
        ? { ok: false, text: 'No answer', detail: 'Nothing answers on localhost:5002.' }
        : { ok: true, text: 'Answers, 200 in 12 ms', detail: 'It answered.' };
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
  write('status', { apps: { web: { port: port(web) }, orders: { port: port(orders) }, payments: { port: 1 } } });
  write('progress', { run: 'run12345', env: 'qa', apps: { web: [], orders: [], payments: [] } });
  try {
    // Payments API was started and does not answer; the database tunnel counts too when nothing listens on its port.
    await expect(chip).toHaveText(/^\d things? (is|are) off$/);
    await expect(chip).toHaveAttribute('data-state', 'bad');
    await chip.click();
    await expect(check.locator('.sum')).toHaveText('2 of 6 connections fail');
    await expect(check.locator('.fail .route')).toHaveText(['Payments API', 'Orders API → local Payments API']);
    await expect(check.locator('.fail .why').first()).toHaveText('Nothing answers on localhost:5002.');
    await expect(check.locator('summary')).toHaveText([
      /Apps\s*1 of 3 fails/,
      /Cables between local apps\s*1 of 2 fails/,
      /Databases and caches\s*0 of 1 work, 1 not checked/,
    ]);
    // Read out with the title and its count apart.
    await expect(check.locator('summary').first()).toHaveAccessibleName('Apps: 1 of 3 fails');
    await expect(chip).toHaveText('2 things are off');
    await page.screenshot({ path: 'test-results/next-flow.png' });

    await check.getByRole('button', { name: 'Ask the agent to fix these' }).click();
    await expect(check.getByRole('button', { name: 'Sent to the agent' })).toBeDisabled();
    const sent = fs
      .readFileSync(path.join(canvas.temp, 'prompts.jsonl'), 'utf8')
      .split('\n')
      .filter(Boolean)
      .map(line => JSON.parse(line) as { tag: string; text: string; data: { failures: { connection: string }[] } });
    expect(sent[0]?.tag).toBe('koppler-fix');
    expect(sent[0]?.data.failures.map(one => one.connection)).toEqual([
      'Payments API',
      'Orders API to local Payments API',
    ]);
    // A failure shows its card and closes the report.
    await check.locator('.fail').first().click();
    await expect(check).toBeHidden();
  } finally {
    web.close();
    orders.close();
  }
});

test('an app the Flow check found starting is checked again once it answers', async ({ page }) => {
  const asked: { node?: string }[] = [];
  await page.route('**/cable-test?*', async route => {
    asked.push(route.request().postDataJSON() as { node?: string });
    await route.fulfill({ json: { ok: true, text: 'Answers, 200 in 12 ms', detail: 'It answered.' } });
  });
  // Web Shop was started and its process is up, but nothing answers on its port yet.
  let listening = false;
  await page.route('**/data/status.json', route =>
    route.fulfill({
      json: {
        apps: { web: { port: 3000, listening } },
        running: ['web'],
        progress: { run: 'run12345', env: 'qa', apps: ['web'] },
      },
    }),
  );
  const chip = page.locator('header .chip');
  await expect(chip).toHaveText('Starting Web Shop');
  await chip.click();
  const row = page.getByRole('dialog', { name: 'Flow check' }).locator('.row', { hasText: 'Web Shop' }).first();
  await expect(row).toContainText('Starting');
  expect(asked.filter(one => one.node === 'web')).toHaveLength(0);
  listening = true;
  await expect(row).toContainText('200 in 12 ms');
  expect(asked.filter(one => one.node === 'web')).toHaveLength(1);
});
