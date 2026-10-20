import fs from 'node:fs';
import path from 'node:path';
// Databases on the board: a card for each, hung from its tunnel, switched between the deployed one and the user's own.
import type { Locator, Page } from '@playwright/test';
import { at, card, expect, saved, sent, STACK, test } from './canvas.ts';

const database = (page: Page, name: string) => page.locator('.svelte-flow__node-database').filter({ hasText: name });
const tunnel = (page: Page) => page.locator('.svelte-flow__node-tunnel');
const { orders, payments } = STACK.apps;
const stack = {
  ...STACK,
  databases: {
    'orders-db': { name: 'Orders', kind: 'postgres', tunnel: 'aurora.qa.acme.example', port: 5432 },
    'payments-db': { name: 'Payments', kind: 'postgres', tunnel: 'aurora.qa.acme.example', port: 5432 },
  },
  apps: {
    ...STACK.apps,
    orders: { ...orders, prereqs: [], envs: {}, uses: { 'orders-db': {} } },
    payments: {
      ...payments,
      uses: {
        'payments-db': {
          change: { file: '.env.development', find: 'DB_HOST=db.qa.acme.example', replace: 'DB_HOST={local}' },
        },
      },
    },
  },
};
test.use({
  stack,
  board: {
    env: 'qa',
    mode: 'auto',
    zoom: 0.8,
    pan: { x: 60, y: 40 },
    nodes: { orders: at(0, 0), payments: at(700, 0) },
    edges: [],
  },
});

test('two apps on one tunnel: one tunnel card with a row per database, and a card for each database', async ({
  page,
}) => {
  await expect(tunnel(page)).toHaveCount(1);
  await expect(tunnel(page).getByRole('list', { name: 'Databases behind it' }).getByRole('listitem')).toHaveText([
    /Orders\s*Deployed/,
    /Payments\s*Deployed/,
  ]);
  await expect(database(page, 'Orders')).toContainText('POSTGRES');
  await expect(database(page, 'Orders')).toContainText('QA');
  await expect(database(page, 'Payments')).toContainText('localhost:5432');
  // Each app to the tunnel, and the tunnel to each database.
  await expect(page.locator('.links .link')).toHaveCount(2);
  await expect(page.locator('.links .flow.db')).toHaveCount(2);
  await page.screenshot({ path: 'test-results/databases.png' });
});

test('hiding the tunnel for one app draws its cable straight to the database, labelled with the tunnel', async ({
  page,
}) => {
  const kept = saved(page).then(r => r.request().postDataJSON() as Record<string, unknown>);
  await card(page, 'payments').getByRole('switch', { name: 'Show the tunnel to Payments' }).uncheck();
  await expect(tunnel(page).getByRole('listitem').filter({ hasText: 'Payments' })).toContainText('Cable hidden');
  await expect(page.locator('.links .flow.db .via')).toHaveText('Through tunnel · localhost:5432');
  await expect(page.locator('.links .link')).toHaveCount(1);
  expect(((await kept).nodes as Record<string, { shownTunnels?: unknown }>)['payments']?.shownTunnels).toEqual({
    'payments-db': false,
  });
});

test('switching a database to Local asks once where it runs, then the tunnel stays open for the other', async ({
  page,
  canvas,
}) => {
  await database(page, 'Payments').getByText('Local', { exact: true }).click();
  const form = page.getByRole('form', { name: 'Where your local Payments runs' });
  await expect(form).toBeVisible();
  await form.getByLabel('Port').fill('5433');
  await form.getByLabel('Database name').fill('payments_dev');
  // Asking, the switch stays on Deployed.
  await expect(database(page, 'Payments').getByRole('radio', { name: 'Deployed' })).toBeChecked();
  await page.screenshot({ path: 'test-results/databases-ask.png' });
  await form.getByRole('button', { name: 'Use local' }).click();
  await expect(form).toBeHidden();
  await expect(database(page, 'Payments')).toContainText('On this Mac');
  await expect(database(page, 'Payments')).toContainText('localhost:5433 · payments_dev');
  await expect(database(page, 'Payments')).toContainText('Local not answering');
  await expect(tunnel(page).getByRole('listitem').filter({ hasText: 'Payments' })).toContainText(
    'Local, skips the tunnel',
  );
  await expect(page.locator('.links .flow.db.local')).toHaveCount(1);
  await expect(card(page, 'payments')).toContainText('Payments · Local');
  await card(page, 'payments').getByRole('button', { name: 'Show change' }).click();
  await expect(card(page, 'payments')).toContainText('+ DB_HOST={local}');
  await expect
    .poll(
      () =>
        (JSON.parse(fs.readFileSync(path.join(canvas.temp, 'state.json'), 'utf8')) as Record<string, unknown>)[
          'databases'
        ],
    )
    .toEqual({ 'payments-db': 'local' });
  await page.screenshot({ path: 'test-results/databases-local.png' });
});

test('the Run review groups databases by where the data lives, and the run carries the Local choice', async ({
  page,
  canvas,
}) => {
  await database(page, 'Payments').getByText('Local', { exact: true }).click();
  const form = page.getByRole('form', { name: 'Where your local Payments runs' });
  await form.getByLabel('Port').fill('5433');
  await form.getByRole('button', { name: 'Use local' }).click();
  await page.getByRole('button', { name: 'Run', exact: true }).click();
  const lines = page.getByRole('dialog').locator('.lines li');
  const group = (label: string) => lines.filter({ has: page.locator('.verb').getByText(label, { exact: true }) });
  await expect(group('Opens first')).toContainText('localhost:5432');
  await expect(group('Deployed QA databases')).toContainText('Orders');
  await expect(group('On this Mac')).toContainText('Payments');
  await expect(group('On this Mac')).toContainText('localhost:5433');
  await expect(group('Starts')).toContainText('1 line changed for this run, undone on Stop');
  await page.screenshot({ path: 'test-results/databases-review.png' });
  await page.getByRole('dialog').getByRole('button', { name: 'Run', exact: true }).click();
  await expect.poll(() => sent(canvas.temp).at(-1)?.data['databases']).toEqual({ 'payments-db': 'local' });
  expect(sent(canvas.temp).at(-1)?.text).toContain("DATABASE Payments: local, the user's own on this Mac");
});

test("a database's gear opens its settings, kept under databases in the stack", async ({ page }) => {
  await database(page, 'Orders').getByRole('button', { name: 'Settings for Orders' }).click();
  const panel = page.getByRole('dialog');
  await expect(panel).toContainText('Orders');
  await expect(panel.getByRole('textbox').first()).toBeVisible();
  await page.screenshot({ path: 'test-results/databases-settings.png' });
});

test.describe('on PROD', () => {
  test.use({
    stack: {
      ...stack,
      protected: ['prod'],
      databases: {
        'orders-db': {
          ...stack.databases['orders-db'],
          envs: { prod: { tunnel: 'aurora.prod.acme.example', port: 5432 } },
        },
        'payments-db': stack.databases['payments-db'],
      },
    },
    board: {
      env: 'prod',
      mode: 'auto',
      zoom: 0.8,
      pan: { x: 60, y: 40 },
      nodes: { orders: at(0, 0) },
      edges: [],
      databases: { 'orders-db': 'local' },
    },
  });

  test('a deployed PROD database is marked, and switching to it asks first', async ({ page }) => {
    const orders = database(page, 'Orders');
    await expect(orders).toContainText('On this Mac');
    await orders.getByText('Deployed', { exact: true }).click();
    const guard = page.getByRole('alertdialog', { name: 'Use the PROD Orders database?' });
    await expect(guard).toContainText('Orders API will read and write real customer data.');
    await expect(orders.getByRole('radio', { name: 'Local' })).toBeChecked();
    await guard.getByRole('button', { name: 'Keep Local' }).click();
    await expect(orders).toContainText('On this Mac');
    await orders.getByText('Deployed', { exact: true }).click();
    await guard.getByRole('button', { name: 'Use PROD database' }).click();
    await expect(orders).toContainText('PROD DATABASE');
    await expect(orders).toContainText('Asks before each run');
    await page.screenshot({ path: 'test-results/databases-prod.png' });
  });
});

test('the cards read on a light scheme', async ({ page }) => {
  await page.getByRole('button', { name: 'Settings', exact: true }).click();
  await page.getByRole('radio', { name: /^Paper/ }).click();
  await page.keyboard.press('Escape');
  await expect(database(page, 'Orders')).toBeVisible();
  await page.screenshot({ path: 'test-results/databases-paper.png' });
});

/** Switches a database to Local, giving its address the first time. */
const goLocal = async (page: Page, name: string, port: string) => {
  await database(page, name).getByText('Local', { exact: true }).click();
  const form = page.getByRole('form', { name: `Where your local ${name} runs` });
  await form.getByLabel('Port').fill(port);
  await form.getByRole('button', { name: 'Use local' }).click();
  await expect(form).toBeHidden();
};

test("each database's line leaves the tunnel card from its own row", async ({ page }) => {
  const plugs = page.locator('.links .flow.db.row .plug');
  await expect(plugs).toHaveCount(2);
  const rows = tunnel(page).getByRole('listitem');
  for (const [at, row] of [0, 1].entries()) {
    const box = await rows.nth(row).boundingBox();
    const plug = await plugs.nth(at).boundingBox();
    if (!box || !plug) throw new Error('not drawn');
    expect(Math.abs(plug.y + plug.height / 2 - (box.y + box.height / 2))).toBeLessThan(2);
  }
});

/** Right-clicks the middle of a line on the board, as a person would. */
const rightClick = async (page: Page, line: Locator) => {
  const at = await line.evaluate(path => {
    const svg = path as SVGPathElement;
    const mid = svg.getPointAtLength(svg.getTotalLength() / 2);
    const screen = new DOMPoint(mid.x, mid.y).matrixTransform(svg.getScreenCTM() ?? undefined);
    return { x: screen.x, y: screen.y };
  });
  await page.mouse.click(at.x, at.y, { button: 'right' });
};

test('a right click on a line to the tunnel hides the tunnel for that app, and on its straight line shows it again', async ({
  page,
}) => {
  await rightClick(page, page.locator('.links path.hit').first());
  const menu = page.getByRole('menu', { name: 'Line' });
  await expect(menu.getByRole('menuitem')).toHaveText(/Hide tunnel for (Orders|Payments) API/);
  await menu.getByRole('menuitem').click();
  await expect(menu).toBeHidden();
  await expect(page.locator('.links .flow.db .via')).toHaveCount(1);
  await rightClick(page, page.locator('.links .flow.db path.hit'));
  await expect(menu.getByRole('menuitem')).toHaveText(/Show tunnel for/);
  await page.screenshot({ path: 'test-results/databases-menu.png' });
  await page.keyboard.press('Escape');
  await expect(menu).toBeHidden();
});

test('with every database behind it local, the tunnel card stays and says nothing needs it', async ({ page }) => {
  await goLocal(page, 'Orders', '5433');
  await goLocal(page, 'Payments', '5434');
  await expect(tunnel(page)).toContainText('Closed · nothing needs it');
  await expect(tunnel(page).getByRole('listitem')).toHaveText([/Local, skips the tunnel/, /Local, skips the tunnel/]);
  await expect(page.locator('.links .link')).toHaveCount(0);
});

test("the app card says the line it will change, and the database's settings show this Mac's address", async ({
  page,
}) => {
  await goLocal(page, 'Payments', '5433');
  await expect(card(page, 'payments')).toContainText('Will change 1 line');
  await database(page, 'Payments').getByRole('button', { name: 'Settings for Payments' }).click();
  const here = page.getByRole('region', { name: 'Local, this Mac' });
  await expect(here).toContainText('localhost:5433');
  await here.getByRole('button', { name: 'Change' }).click();
  await here.getByLabel('Port').fill('5440');
  await here.getByRole('button', { name: 'Keep' }).click();
  await expect(here).toContainText('localhost:5440');
  await page.screenshot({ path: 'test-results/databases-settings-local.png' });
  await here.getByRole('button', { name: 'Forget' }).click();
  await expect(here).toContainText('Not set');
});
