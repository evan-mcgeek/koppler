// A card's sections fold to one line each: Setup starts open, the rest folded, and the choice is kept per card.
import { at, card, expect, fromMenu, STACK, test } from './canvas.ts';

const { orders } = STACK.apps;
test.use({
  stack: {
    ...STACK,
    databases: { 'orders-db': { name: 'Orders DB', kind: 'postgres', tunnel: 'aurora.qa.acme.example', port: 5432 } },
    apps: { ...STACK.apps, orders: { ...orders, prereqs: [], envs: {}, uses: { 'orders-db': {} } } },
  },
  board: {
    env: 'qa',
    mode: 'auto',
    zoom: 1,
    pan: { x: 60, y: 40 },
    nodes: {
      orders: { ...at(0, 0), note: 'Repro: refunds fail for a cancelled order. Payments stays deployed.' },
    },
    edges: [],
  },
});

test("a card's sections fold to a line, open on a click, and stay as left", async ({ page }) => {
  const orders = card(page, 'orders');
  const line = (name: string) => orders.locator('.fold .line').filter({ hasText: name });
  await expect(orders.locator('.fold .line .name')).toHaveText(['Setup', 'Databases', 'Note for the agent', 'Calls']);
  // A new card: Setup open, the rest folded, each saying what it holds.
  await expect(line('Setup')).toHaveAttribute('aria-expanded', 'true');
  const setup = orders.locator('.fold').first().locator('.content');
  await expect(setup).toContainText('Branch');
  await expect(line('Databases')).toHaveAttribute('aria-expanded', 'false');
  await expect(line('Databases').locator('.sum')).toHaveText('1 database');
  await expect(line('Note for the agent').locator('.sum')).toHaveText('Repro: refunds fail for a cancelled order.');
  await expect(line('Calls').locator('.sum')).toHaveText('2 deployed apps');
  await expect(line('Calls').locator('.env')).toHaveText('QA');
  for (const name of ['Setup', 'Databases', 'Note for the agent', 'Calls'])
    expect((await line(name).boundingBox())?.height).toBe(30);
  await page.screenshot({ path: 'test-results/folds-new-card.png' });

  // A click opens one; folded, Setup says its values in one line.
  await line('Calls').click();
  await expect(orders.getByRole('button', { name: 'Payments API' })).toBeVisible();
  await expect(line('Calls').locator('.env')).toHaveText('QA');
  await line('Setup').click();
  await expect(setup).toHaveCount(0);
  await expect(line('Setup').locator('.sum')).not.toBeEmpty();

  // Kept on this Mac, per card.
  await page.reload();
  await expect(line('Calls')).toHaveAttribute('aria-expanded', 'true');
  await expect(line('Setup')).toHaveAttribute('aria-expanded', 'false');

  // Option-click does every section, the way the clicked one goes; so do the bar's Fold all and Open all.
  await line('Databases').click({ modifiers: ['Alt'] });
  for (const name of ['Setup', 'Databases', 'Note for the agent', 'Calls'])
    await expect(line(name)).toHaveAttribute('aria-expanded', 'true');
  await orders.hover();
  await page.getByRole('button', { name: 'Fold all sections' }).click();
  for (const name of ['Setup', 'Databases', 'Note for the agent', 'Calls'])
    await expect(line(name)).toHaveAttribute('aria-expanded', 'false');
  await page.screenshot({ path: 'test-results/folds-all-folded.png' });
  await page.getByRole('button', { name: 'Open all sections' }).click();
  await expect(line('Note for the agent')).toHaveAttribute('aria-expanded', 'true');

  // From the keyboard: Enter toggles one, Option+Enter every one.
  await line('Databases').focus();
  await page.keyboard.press('Enter');
  await expect(line('Databases')).toHaveAttribute('aria-expanded', 'false');
  await page.keyboard.press('Alt+Enter');
  for (const name of ['Setup', 'Databases', 'Note for the agent', 'Calls'])
    await expect(line(name)).toHaveAttribute('aria-expanded', 'true');
});

test('the failure stays open when every section is folded', async ({ page }) => {
  const why = 'orders exited before answering on port 5001; its log says why.';
  await page.route('**/data/status.json', route =>
    route.fulfill({
      json: {
        live: { env: 'qa', nodes: { orders: {} } },
        apps: {
          orders: {
            state: { state: 'failed-to-start', detail: why },
            steps: [{ label: 'Start', state: 'failed', detail: why }],
          },
        },
      },
    }),
  );
  await page.reload();
  const orders = card(page, 'orders');
  await orders
    .locator('.fold .line')
    .first()
    .click({ modifiers: ['Alt'] });
  await expect(orders.locator('.fold .line[aria-expanded="true"]')).toHaveCount(0);
  await expect(orders.locator('.why')).toHaveText(why);
  await expect(orders.getByRole('button', { name: 'Ask the agent to fix' })).toBeVisible();
  await page.screenshot({ path: 'test-results/folds-failed.png' });
});

test('folded lines read on a light scheme', async ({ page }) => {
  await fromMenu(page, 'Settings', 'Appearance');
  await page.getByRole('radio', { name: /^Paper/ }).click();
  await page.keyboard.press('Escape');
  const line = card(page, 'orders').locator('.fold .line').filter({ hasText: 'Databases' });
  await line.hover();
  await expect(line).toBeVisible();
  await page.screenshot({ path: 'test-results/folds-paper.png' });
});
