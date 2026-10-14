// A past run in History opens the app logs it kept, and is pinned so they stay.
import fs from 'node:fs';
import path from 'node:path';
import { expect, test } from './canvas.ts';

test("a run's kept logs open from History in a tab of their own, and the run can be pinned", async ({
  page,
  canvas,
}) => {
  const at = new Date(Date.now() - 20 * 60_000).toISOString();
  const run = {
    id: 'run00001',
    at,
    env: 'qa',
    mode: 'auto',
    state: 'done',
    nodes: { orders: { run: 'cli' } },
    edges: [],
    logs: ['orders'],
    pinned: false,
  };
  fs.mkdirSync(path.join(canvas.temp, 'runs', 'run00001'), { recursive: true });
  fs.writeFileSync(
    path.join(canvas.temp, 'runs', 'run00001', 'orders.log'),
    'info: Now listening on: http://localhost:5001\n',
  );
  await page.route('**/data/status.json', route => route.fulfill({ json: { apps: {}, runs: [run], startedAt: at } }));
  const loaded = page.waitForResponse(answer => answer.url().includes('data/status.json'));
  await page.reload();
  await loaded;
  const list = page.getByRole('dialog', { name: 'History' });
  await page.getByRole('button', { name: 'History' }).click();
  await expect(list).toBeVisible();
  await list.getByRole('button', { name: /QA, auto/ }).click();
  await list.getByRole('button', { name: 'Orders API', exact: true }).click();
  const pane = page.getByRole('region', { name: 'App log' });
  await expect(pane.getByRole('tab', { name: /Orders API, run of / })).toHaveAttribute('aria-selected', 'true');
  await expect(pane.getByRole('log')).toContainText('Now listening on: http://localhost:5001');

  // The list stays open beside the log.
  const pinned = page.waitForRequest(request => request.url().includes('/run-pin'));
  await list.getByRole('button', { name: 'Pin' }).click();
  expect((await pinned).postDataJSON()).toEqual({ id: 'run00001', on: true });
  await page.screenshot({ path: 'test-results/next-run-logs.png' });
});
