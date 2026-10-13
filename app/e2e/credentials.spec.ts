// The new canvas's Credentials: what the apps on the board need stored, set and tested without ever being shown.
// The server's side is stood in for here: no real store is touched.
import { test, expect } from './canvas.ts';

const at = (x: number, y: number) => ({ x, y, run: 'cli', branch: 'main' });
test.use({
  board: { env: 'qa', mode: 'auto', nodes: { web: at(0, 0), orders: at(420, 0) }, edges: [] },
});

test('a missing credential is set, tested and removed, and its value never reaches the debug log', async ({ page }) => {
  const needs = [
    {
      name: 'ConnectionStrings__Orders',
      stored: false,
      when: 'Always. The app does not start without it.',
      fetchUi: 'AWS console → Secrets Manager → acme-qa-orders',
      fetchCli: 'aws secretsmanager get-secret-value --secret-id acme-qa-orders | koppler keep orders',
    },
    { name: 'Stripe__Key', stored: true, when: 'Only when you test payments.' },
  ];
  await page.route('**/data/status.json', route =>
    route.fulfill({ json: { apps: {}, dev: true, secrets: { orders: { qa: needs } } } }),
  );
  const asked: { route: string; body: Record<string, unknown> }[] = [];
  const logged: string[] = [];
  await page.route('**/debug-log?*', async route => {
    logged.push(route.request().postData() ?? '');
    await route.fulfill({ json: {} });
  });
  for (const [name, answer] of [
    ['secret', { ok: true }],
    ['secret-test', { ok: false, message: 'failed: the database refused the password' }],
    ['secret-remove', { ok: true }],
  ] as const)
    await page.route(`**/${name}?*`, async route => {
      asked.push({ route: name, body: route.request().postDataJSON() as Record<string, unknown> });
      await route.fulfill({ json: answer });
    });

  const open = page.getByRole('button', { name: 'Credentials' });
  await expect(open).toHaveAttribute('title', '1 credential is missing for the apps on the board (QA)');
  await open.click();
  const panel = page.getByRole('dialog', { name: 'Credentials' });
  await expect(panel.getByRole('heading')).toHaveText('Orders API on QA');
  await expect(panel.locator('.state')).toHaveText(['Missing', 'Stored']);

  await panel.getByRole('button', { name: 'When ConnectionStrings__Orders is needed and where to get it' }).click();
  await expect(panel.locator('ol li')).toHaveText(['AWS console', 'Secrets Manager', 'acme-qa-orders']);
  await panel.getByRole('button', { name: 'Show fetch command' }).click();
  await expect(panel.locator('.cmd code')).toContainText('aws secretsmanager get-secret-value');
  await page.screenshot({ path: 'test-results/next-credentials.png' });

  await panel.getByRole('button', { name: 'Set', exact: true }).click();
  const value = panel.getByLabel('Value for ConnectionStrings__Orders');
  await expect(value).toHaveAttribute('type', 'password');
  await value.fill('not-a-real-value-123');
  await value.press('Enter');
  await expect(panel.locator('.state').first()).toHaveText('Stored');
  expect(asked[0]).toEqual({
    route: 'secret',
    body: { app: 'orders', env: 'qa', name: 'ConnectionStrings__Orders', value: 'not-a-real-value-123' },
  });

  await panel.getByRole('button', { name: 'Test' }).first().click();
  await expect(panel.locator('.state').first()).toHaveText('Does not work');
  await expect(panel.locator('.result')).toHaveText('The database refused the password');
  await panel.getByRole('button', { name: 'Remove' }).first().click();
  await expect(panel.locator('.state').first()).toHaveText('Missing');
  expect(asked.map(one => one.route)).toEqual(['secret', 'secret-test', 'secret-remove']);

  // The debug log is on here; nothing done in this panel is kept in it, least of all the value.
  await page.keyboard.press('Escape');
  await page.getByRole('button', { name: 'Fit' }).click();
  await expect.poll(() => logged.join('').includes('Zoom to fit'), { timeout: 10000 }).toBe(true);
  expect(logged.join('')).not.toContain('not-a-real-value-123');
  expect(logged.join('')).not.toContain('ConnectionStrings__Orders');
});
