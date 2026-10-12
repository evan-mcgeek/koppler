// The new canvas's History: every run and Stop with how it ended, and a way to put a run's board back.
import { test, expect } from '../canvas.ts';

test.use({ start: 'next/' });

test('runs are listed newest first with their plan and code changes, and a board is put back from one', async ({
  page,
}) => {
  const history = page.getByRole('button', { name: 'History' });
  await history.click();
  const list = page.getByRole('dialog', { name: 'History' });
  await expect(list).toContainText('No runs yet.');
  await page.keyboard.press('Escape');

  const started = new Date(Date.now() - 3600_000).toISOString();
  const at = (minutes: number) => new Date(Date.now() - minutes * 60_000).toISOString();
  const run = {
    id: 'run00001',
    at: at(20),
    env: 'qa',
    mode: 'auto',
    state: 'failed',
    reason: 'Orders API did not answer.',
    nodes: { web: { run: 'cli' }, orders: { run: 'cli' } },
    edges: [{ from: 'web', to: 'orders' }],
    plan: { starts: [{ id: 'web' }, { id: 'orders', why: ['its branch changed'] }] },
    changes: [
      {
        app: 'web',
        title: 'Points at the local Orders API',
        file: '.env.local',
        fresh: true,
        removed: ['ORDERS_URL=https://orders.qa.acme.example'],
        added: ['ORDERS_URL=http://localhost:5001'],
      },
    ],
  };
  const runs = [
    { id: 'old00001', at: at(600), env: 'qa', mode: 'auto', state: 'done', nodes: { web: { run: 'cli' } }, edges: [] },
    run,
    { id: 'run00002', at: at(5), kind: 'stop', state: 'waiting', nodes: {}, edges: [] },
  ];
  const notes = [{ note: 'stop-apps', at: at(10), stopped: ['web'] }];
  await page.route('**/data/status.json', route =>
    route.fulfill({ json: { apps: {}, runs, notes, startedAt: started } }),
  );
  // A run that waits for the agent marks the button.
  await expect(history).toHaveAttribute('title', 'A run is waiting for the agent');
  await history.click();
  await expect(list.locator(':scope > .run .what')).toHaveText([
    /Stop and revert/,
    /Apps stopped, changes kept\s*Web Shop/,
    /QA, auto\s*Web Shop, Orders API/,
  ]);
  await expect(list).toContainText('Orders API did not answer.');
  await expect(list.getByText('Earlier (1)')).toBeVisible();

  await list.getByRole('button', { name: /QA, auto/ }).click();
  await expect(list).toContainText('its branch changed');
  await expect(list.locator('pre .del')).toContainText('ORDERS_URL=https://orders.qa.acme.example');
  await expect(list.locator('pre .add')).toContainText('ORDERS_URL=http://localhost:5001');
  await page.screenshot({ path: 'test-results/next-history.png' });
  await list.getByRole('button', { name: 'Put this board back' }).click();
  await expect(list).toBeHidden();
  await expect(page.locator('.svelte-flow__node-app')).toHaveCount(2);
  await expect(page.locator('.svelte-flow__edge')).toHaveCount(1);
  await expect(page.getByRole('button', { name: /^Board: Run from / })).toBeVisible();
});
