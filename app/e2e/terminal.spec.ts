// A card opens a terminal in its app's clone; a database tunnel card opens psql on it.
import { actions, at, expect, test } from './canvas.ts';

test.use({
  board: { env: 'qa', mode: 'auto', zoom: 1, pan: { x: 60, y: 60 }, nodes: { orders: at(0, 0) }, edges: [] },
});

test('a card asks for a terminal in its clone, and a database tunnel card for psql', async ({ page }) => {
  const asked: unknown[] = [];
  // Never a real Terminal window from a test.
  await page.route('**/open-terminal*', async route => {
    asked.push(route.request().postDataJSON());
    await route.fulfill({ json: { opened: true, command: 'koppler shell orders --env qa' } });
  });
  await (await actions(page, 'orders')).getByRole('button', { name: 'Open a terminal for Orders API' }).click();
  await expect(page.getByRole('status').filter({ hasText: "A terminal opens in Orders API's clone." })).toBeVisible();
  await page
    .locator('.svelte-flow__node-tunnel')
    .getByRole('button', { name: 'Query the Database (Postgres)' })
    .click();
  await expect(page.getByRole('status').filter({ hasText: 'psql opens in a Terminal window.' })).toBeVisible();
  expect(asked).toEqual([
    { app: 'orders', env: 'qa', query: false },
    { app: 'orders', env: 'qa', query: true },
  ]);
  await page.screenshot({ path: 'test-results/next-terminal.png' });
});

test('where no terminal can be opened, the command to run is given to copy', async ({ page }) => {
  await page.route('**/open-terminal*', route =>
    route.fulfill({
      status: 400,
      json: {
        error: 'Open a terminal and run: koppler shell orders --env qa',
        command: 'koppler shell orders --env qa',
      },
    }),
  );
  await (await actions(page, 'orders')).getByRole('button', { name: 'Open a terminal for Orders API' }).click();
  const alert = page.getByRole('alert');
  await expect(alert).toContainText('Open a terminal and run: koppler shell orders --env qa');
  await expect(alert.getByRole('button', { name: 'Copy' })).toBeVisible();
});
