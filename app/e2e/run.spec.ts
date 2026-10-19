// The new canvas's Run and Stop: the review of what changes, and what is sent once it is confirmed.
import type { Page } from '@playwright/test';
import { actions, at, card, expect, nextEdit, sent, STACK, test } from './canvas.ts';

const review = (page: Page) => page.getByRole('dialog');
/** What the server took from the page so far, one request a line. */
test.use({
  stack: { ...STACK, protected: ['prod'] },
  board: {
    env: 'qa',
    mode: 'auto',
    zoom: 0.8,
    pan: { x: 80, y: 60 },
    nodes: { web: at(0, 0), orders: { ...at(420, 0), note: 'use the test account' } },
    edges: [{ from: 'web', to: 'orders', fromSide: 'right', toSide: 'left' }],
  },
});

test('Run shows what will start, with its tunnels and what stays deployed, and sends it when confirmed', async ({
  page,
  canvas,
}) => {
  await page.getByRole('button', { name: 'Run', exact: true }).click();
  await expect(review(page).getByRole('heading')).toHaveText('Run on QA');
  await expect(review(page)).toContainText('The agent does exactly this, with your note');
  const lines = review(page).locator('.lines li');
  await expect(lines.filter({ hasText: 'Starts' })).toContainText('Web Shop');
  await expect(lines.filter({ hasText: 'Starts' })).toContainText('Orders API');
  await expect(lines.filter({ hasText: 'Starts' })).toContainText('Note: use the test account');
  await expect(lines.filter({ hasText: 'Calls deployed QA' })).toContainText('Payments API');
  await expect(lines.filter({ hasText: 'Opens tunnels' })).toContainText('Database (Postgres) on localhost:5432');
  await page.screenshot({ path: 'test-results/next-review.png' });

  await review(page).getByRole('button', { name: 'Cancel' }).click();
  await expect(review(page)).toBeHidden();
  expect(sent(canvas.temp)).toEqual([]);

  await page.keyboard.press('ControlOrMeta+Enter');
  await review(page).getByRole('button', { name: 'Run', exact: true }).click();
  await expect(page.getByRole('status').filter({ hasText: 'Sent. Waiting for the agent' })).toBeVisible();
  await expect.poll(() => sent(canvas.temp).length).toBe(1);
  const [run] = sent(canvas.temp);
  expect(run?.tag).toBe('koppler');
  expect(run?.text).toContain('ENV QA');
  expect(run?.text).toContain('LOCAL Orders API [CLI] on main');
  expect(run?.text).toContain('  note: use the test account');
  expect(run?.text).toContain('  Web Shop → local Orders API');
  expect(run?.text).toContain('  Orders API → QA Payments API');
  expect(run?.text).toContain('PLAN the user confirmed on the canvas');
  expect(run?.data['nodes']).toEqual([
    { id: 'web', branch: 'main', run: 'cli' },
    { id: 'orders', branch: 'main', run: 'cli', note: 'use the test account' },
  ]);
  expect(run?.data['edges']).toEqual([{ from: 'web', to: 'orders' }]);
});

test('on a protected environment the review says so, in red', async ({ page }) => {
  await page.getByRole('radio', { name: 'PROD' }).check();
  await page.getByRole('button', { name: 'Run', exact: true }).click();
  await expect(review(page).getByRole('heading')).toHaveText('Run on PROD');
  await expect(review(page)).toContainText('PROD: your local code reads and writes real PROD data.');
  await expect(review(page)).toContainText('db.prod.acme.example');
  await expect(review(page).getByRole('button', { name: 'Run on PROD' })).toHaveClass(/prod/);
});

test('with nothing running Stop is off, and what the last run left is reverted from its menu', async ({
  page,
  canvas,
}) => {
  await expect(page.getByRole('button', { name: 'Stop', exact: true })).toBeDisabled();
  const menu = page.getByRole('button', { name: 'More ways to stop' });
  await menu.click();
  await expect(page.getByRole('menuitem', { name: /Stop apps, keep changes/ })).toBeDisabled();
  await expect(page.getByRole('menuitem', { name: /Revert temporary changes/ })).toBeDisabled();
  await page.keyboard.press('Escape');
  const changes = [{ app: 'orders', kind: 'checkout', file: '', title: 'Branch switched' }];
  await page.route('**/data/status.json', async route => {
    const real = (await (await route.fetch()).json()) as { runs?: object[] };
    await route.fulfill({ json: { ...real, runs: [{ id: 'r1', kind: 'run', state: 'done', changes }] } });
  });
  await menu.click();
  await page.getByRole('menuitem', { name: /Revert temporary changes/ }).click();
  await expect(review(page).getByRole('heading')).toHaveText('Revert temporary changes');
  await expect(review(page)).toContainText('Left alone: anything you started yourself');
  await review(page).getByRole('button', { name: 'Revert' }).click();
  // Koppler stops and reverts by itself: the stop shows as the last run.
  const lastRun = async () => {
    const status = (await (await page.request.get(`${canvas.url}data/status.json`)).json()) as {
      runs?: { kind: string }[];
    };
    return status.runs?.at(-1)?.kind;
  };
  await expect.poll(lastRun).toBe('stop');
});

test('Stop lists every change the last run left, two on one app on its one line', async ({ page }) => {
  const changes = [
    { app: 'orders', kind: 'checkout', file: '', title: 'Branch switched' },
    { app: 'orders', kind: 'edit', file: 'appsettings.json', title: 'Temporary edit' },
    { app: 'web', kind: 'checkout', file: '', title: 'Branch switched' },
  ];
  await page.route('**/data/status.json', route =>
    route.fulfill({ json: { apps: {}, runs: [{ id: 'r1', kind: 'run', state: 'done', changes }] } }),
  );
  await page.reload();
  await page.getByRole('button', { name: 'More ways to stop' }).click();
  await page.getByRole('menuitem', { name: /Revert temporary changes/ }).click();
  const lines = review(page).locator('.apps > span');
  await expect(lines).toHaveCount(2);
  await expect(lines.first()).toContainText('Orders API');
  await expect(lines.first()).toContainText('Branch switched');
  await expect(lines.first()).toContainText('Temporary edit (appsettings.json)');
});

test('Clear asks first, and Run is off on an empty board', async ({ page }) => {
  const cards = page.locator('.svelte-flow__node-app');
  await page.getByRole('button', { name: 'Clear' }).click();
  const ask = page.getByRole('dialog').filter({ hasText: 'Undo brings them back.' });
  await expect(ask).toContainText('all 2 apps');
  await ask.getByRole('button', { name: 'Cancel' }).click();
  await expect(cards).toHaveCount(2);
  await page.getByRole('button', { name: 'Clear' }).click();
  await page.getByRole('button', { name: 'Clear board' }).click();
  await expect(page.getByRole('button', { name: 'Run', exact: true })).toBeDisabled();
  await expect(page.getByRole('button', { name: 'Clear' })).toBeDisabled();
});

test('Run has a menu: with a note for this run, or as a checklist', async ({ page, canvas }) => {
  const menu = page.getByRole('menu', { name: 'More ways to run' });
  await page.getByRole('button', { name: 'More ways to run' }).click();
  await page.screenshot({ path: 'test-results/next-run-menu.png' });
  await menu.getByRole('menuitem', { name: /Run with a note/ }).click();
  await page
    .getByRole('dialog', { name: 'Note for the agent' })
    .getByRole('textbox')
    .fill('log in as the test account');
  await page.screenshot({ path: 'test-results/next-run-note.png' });
  await page.getByRole('button', { name: 'Review and send' }).click();
  await expect(review(page).getByRole('heading')).toHaveText('Run on QA');
  await expect(review(page)).toContainText('The agent does exactly this, with your note');
  await expect(review(page)).toContainText('Your note: log in as the test account');
  await review(page).getByRole('button', { name: 'Run', exact: true }).click();
  await expect.poll(() => sent(canvas.temp).length).toBe(1);
  expect(sent(canvas.temp)[0]?.data['note']).toBe('log in as the test account');
  expect(sent(canvas.temp)[0]?.text).toContain('NOTE log in as the test account');

  // The keyboard reaches the second way: the arrow opens the menu on its first item.
  await page.getByRole('button', { name: 'More ways to run' }).focus();
  await page.keyboard.press('Enter');
  await expect(menu.getByRole('menuitem', { name: /Run with a note/ })).toBeFocused();
  await page.keyboard.press('ArrowDown');
  await page.keyboard.press('Enter');
  await expect(review(page).getByRole('heading')).toHaveText('Checklist for QA');
  await expect(review(page)).toContainText('The agent changes nothing.');
  await review(page).getByRole('button', { name: 'Get the checklist' }).click();
  await expect.poll(() => sent(canvas.temp).length).toBe(2);
  expect(sent(canvas.temp)[1]?.data['mode']).toBe('manual');
  expect(sent(canvas.temp)[1]?.text).toContain('MODE manual: give me a checklist, change nothing');
});

test('Stop has a menu: stop the apps and keep the changes, or shut Koppler down', async ({ page }) => {
  const menu = page.getByRole('menu', { name: 'More ways to stop' });
  await page.getByRole('button', { name: 'More ways to stop' }).click();
  // Nothing runs: there is nothing to stop, and the item says so.
  await expect(menu.getByRole('menuitem', { name: /Stop apps, keep changes/ })).toBeDisabled();
  await expect(menu).toContainText('Nothing is running');
  await page.keyboard.press('Escape');
  await expect(menu).toBeHidden();

  // Two things run, as the server would report them.
  await page.route('**/data/status.json', route =>
    route.fulfill({ json: { apps: {}, running: ['orders', 'tunnel-db', 'canvas'] } }),
  );
  await page.route('**/stop-apps?*', route => route.fulfill({ json: { stopped: ['orders', 'tunnel-db'] } }));
  await expect(async () => {
    await page.getByRole('button', { name: 'More ways to stop' }).click();
    await expect(menu.getByRole('menuitem', { name: /Stop apps, keep changes/ })).toBeEnabled({ timeout: 500 });
  }).toPass();
  await page.screenshot({ path: 'test-results/next-stop-menu.png' });
  await menu.getByRole('menuitem', { name: /Stop apps, keep changes/ }).click();
  await expect(review(page).getByRole('heading')).toHaveText('Stop apps, keep changes');
  await expect(review(page)).toContainText('Orders API');
  await expect(review(page)).toContainText('Tunnel db');
  await review(page).getByRole('button', { name: 'Stop apps' }).click();
  await expect(page.getByRole('status')).toContainText('Stopped 2 processes. Your changes stay until you revert.');

  await page.getByRole('button', { name: 'More ways to stop' }).click();
  await menu.getByRole('menuitem', { name: /Shut down Koppler/ }).click();
  await expect(review(page).getByRole('heading')).toHaveText('Shut down Koppler');
  await expect(review(page)).toContainText('The canvas server');
  await expect(review(page)).toContainText('Keeps running: orders, tunnel-db.');
  await review(page).getByRole('button', { name: 'Shut down' }).click();
  await expect(page.getByRole('status')).toContainText('Koppler is shut down. Start it again with koppler canvas.');
});

test('a card has a play icon to run its app alone, and a stop icon while it runs', async ({ page }) => {
  // Running, as the server would report it: the card offers Stop, and only that app is stopped.
  await page.route('**/data/status.json', route =>
    route.fulfill({ json: { apps: { orders: { listening: true } }, running: ['orders', 'canvas'] } }),
  );
  const asked: unknown[] = [];
  await page.route('**/stop-apps?*', async route => {
    asked.push(route.request().postDataJSON());
    await route.fulfill({ json: { stopped: ['orders'] } });
  });
  await (await actions(page, 'orders')).getByRole('button', { name: 'Stop Orders API' }).click();
  await expect(page.getByText('Stopped Orders API. Its changes stay until you revert.')).toBeVisible();
  expect(asked).toEqual([{ app: 'orders' }]);
  await page.screenshot({ path: 'test-results/next-card-icons.png' });

  // Not running: play goes straight to the review of that app alone.
  await (await actions(page, 'web')).getByRole('button', { name: 'Run Web Shop alone' }).click();
  await expect(page.getByRole('button', { name: 'Board: Web Shop alone' })).toBeVisible();
  await expect(review(page).getByRole('button', { name: /Back to/ })).toBeVisible();
});

test('a running card has a restart icon: only that app restarts, shown in the review first', async ({ page }) => {
  const node = { branch: 'main', run: 'cli', note: 'use the test account' };
  const live = {
    env: 'qa',
    nodes: { web: { branch: 'main', run: 'cli' }, orders: node },
    edges: [{ from: 'web', to: 'orders' }],
  };
  await page.route('**/data/status.json', route =>
    route.fulfill({ json: { apps: {}, live, running: ['orders', 'web', 'canvas'] } }),
  );
  await (await actions(page, 'orders')).getByRole('button', { name: 'Restart Orders API' }).click();
  await expect(review(page)).toContainText('you asked to restart it');
  const restarts = review(page).locator('li', { has: page.locator('[data-verb="restarts"]') });
  await expect(restarts).toContainText('Orders API');
  await expect(restarts).not.toContainText('Web Shop');
  await page.screenshot({ path: 'test-results/next-card-restart.png' });
});

test('restarting a card leaves the cards that were never started alone', async ({ page, canvas }) => {
  const live = {
    env: 'qa',
    nodes: { orders: { branch: 'main', run: 'cli', note: 'use the test account' } },
    edges: [],
  };
  await page.route('**/data/status.json', route =>
    route.fulfill({ json: { apps: {}, live, running: ['orders', 'canvas'] } }),
  );
  await (await actions(page, 'orders')).getByRole('button', { name: 'Restart Orders API' }).click();
  await expect(review(page)).toContainText('you asked to restart it');
  await expect(review(page)).not.toContainText('Web Shop');
  await review(page).getByRole('button', { name: 'Run', exact: true }).click();
  await expect.poll(() => sent(canvas.temp).length).toBe(1);
  const [run] = sent(canvas.temp);
  expect(run?.data).toMatchObject({ nodes: [{ id: 'orders', restart: true }], edges: [] });
});

test('the review lists remembered changes, and a card is changed or a call run locally from inside it', async ({
  page,
}) => {
  const recipes = {
    orders: [{ why: 'point it at the test tenant', file: 'appsettings.json', when: { always: true }, here: null }],
  };
  await page.route('**/data/status.json', route => route.fulfill({ json: { apps: {}, recipes } }));
  const starts = review(page).locator('li', { has: page.locator('[data-verb="starts"]') });
  // The review is read from the status as it is when Run is pressed.
  await expect(async () => {
    await page.keyboard.press('Escape');
    await page.getByRole('button', { name: 'Run', exact: true }).click();
    await expect(starts).toContainText('Remembered change: point it at the test tenant (not run here yet)', {
      timeout: 500,
    });
  }).toPass();

  // Its tunnels are switched off here, as on the card; the review says what that means.
  await starts.getByRole('switch', { name: 'Tunnels' }).uncheck();
  await expect(review(page)).toContainText('Only its API runs; calls through its tunnels fail');
  await expect(page.getByRole('switch', { name: "Open Orders API's tunnels" })).not.toBeChecked();

  // A deployed app that is cloned here can run locally too: it joins the board, cabled from its caller.
  const calls = review(page)
    .locator('li', { has: page.locator('[data-verb="deployed"]') })
    .first();
  await calls.getByRole('button', { name: 'Run locally' }).first().click();
  await expect(page.locator('.svelte-flow__node-app')).toHaveCount(3);
  await expect(starts.locator('.apps > span')).toHaveCount(3);
  // Every caller on the board is pointed at it, so it is no longer a deployed call.
  await expect(review(page).getByRole('button', { name: 'Run locally' })).toHaveCount(1);
  await page.screenshot({ path: 'test-results/next-review-controls.png' });
});

test('what stands in the way of a protected run opens a checklist of what to do first', async ({ page }) => {
  const steps = [
    {
      title: 'Sign in to AWS (acme-prod)',
      why: 'Orders API reads its settings from AWS.',
      command: 'aws sso login --profile acme-prod',
      where: 'anywhere',
      apps: ['Orders API'],
      done: false,
    },
    { title: 'A PROD tunnel for Orders API', gap: true, done: false },
    { title: 'Trust the HTTPS certificate', done: true },
  ];
  const asked: unknown[] = [];
  await page.route('**/needs?*', async route => {
    asked.push(route.request().postDataJSON());
    await route.fulfill({ json: { steps } });
  });
  // A credential the app always needs is not stored for PROD: the run is held back.
  const needs = [
    { name: 'ConnectionStrings__Orders', stored: false, when: 'Always. The app does not start without it.' },
  ];
  await page.route('**/data/status.json', route =>
    route.fulfill({ json: { apps: {}, secrets: { orders: { prod: needs } } } }),
  );
  await page.getByRole('radio', { name: 'PROD' }).check();
  await expect(async () => {
    await page.keyboard.press('Escape');
    await page.getByRole('button', { name: 'Run', exact: true }).click();
    await expect(review(page)).toContainText('Store first, then send', { timeout: 500 });
  }).toPass();
  await review(page).getByRole('button', { name: 'What to do' }).first().click();
  const list = page.getByRole('dialog', { name: 'Before this runs on PROD' });
  await expect(list.getByRole('listitem')).toHaveCount(3);
  await expect(list).toContainText('aws sso login --profile acme-prod');
  await expect(list.getByRole('button', { name: 'Copy' })).toBeVisible();
  await expect(list.getByRole('button', { name: 'Ask the agent to find them' })).toBeVisible();
  expect(asked[0]).toMatchObject({ env: 'prod', apps: ['web', 'orders'] });
  await page.screenshot({ path: 'test-results/next-checklist.png' });
  await list.getByRole('button', { name: 'Done' }).click();
  await expect(list).toBeHidden();
});

test('shortcuts leave the board alone while the review is open', async ({ page }) => {
  const cards = page.locator('.svelte-flow__node-app');
  await nextEdit(page);
  await (await actions(page, 'web')).getByRole('button', { name: 'Remove Web Shop' }).click();
  await expect(cards).toHaveCount(1);
  await page.getByRole('button', { name: 'Run', exact: true }).click();
  await expect(review(page)).toBeVisible();
  await page.keyboard.press('ControlOrMeta+z');
  await page.keyboard.press('l');
  await review(page).getByRole('button', { name: 'Cancel' }).click();
  await expect(cards).toHaveCount(1);
  await expect(page.getByRole('radio', { name: 'Edit' })).toBeChecked();
  // Once it is closed, undo works again.
  await expect(review(page)).toBeHidden();
  await page.keyboard.press('ControlOrMeta+z');
  await expect(cards).toHaveCount(2);
});

test('an app cabled to nothing on the board is flagged in the review, and cabled or kept on its own from there', async ({
  page,
}) => {
  await page.getByRole('complementary').getByRole('button', { name: 'Catalog API', exact: true }).click();
  await page.getByRole('button', { name: 'Run', exact: true }).click();
  const alone = review(page).getByRole('group', { name: 'Catalog API is not cabled' });
  await expect(alone).toContainText('Not cabled to any app here');
  await expect(alone.getByRole('button')).toHaveText([
    'Web Shop calls it',
    'Orders API calls it',
    'Run it on its own',
    "Don't run it",
  ]);
  await page.screenshot({ path: 'test-results/next-review-alone.png' });
  await alone.getByRole('button', { name: 'Web Shop calls it' }).click();
  await expect(page.locator('.svelte-flow__edge[data-id="web>catalog"]')).toHaveCount(1);
  await expect(alone).toHaveCount(0);

  await review(page).getByRole('button', { name: 'Cancel' }).click();
  const cut = page.locator('.svelte-flow__edge[data-id="web>catalog"]');
  await cut.hover();
  await cut.locator('.cut').click();
  await page.getByRole('button', { name: 'Run', exact: true }).click();
  await alone.getByRole('button', { name: 'Run it on its own' }).click();
  await expect(alone).toHaveCount(0);
  await expect(page.locator('.svelte-flow__edge[data-id="web>catalog"]')).toHaveCount(0);
});

test('an app cabled to nothing can be left out of the run from the review; its card stays on the board', async ({
  page,
}) => {
  await page.getByRole('complementary').getByRole('button', { name: 'Catalog API', exact: true }).click();
  await page.getByRole('button', { name: 'Run', exact: true }).click();
  const alone = review(page).getByRole('group', { name: 'Catalog API is not cabled' });
  const starts = review(page).locator('li', { has: page.locator('[data-verb="starts"]') });
  await expect(starts).toContainText('Catalog API');
  await alone.getByRole('button', { name: "Don't run it" }).click();
  await expect(alone).toHaveCount(0);
  await expect(starts).not.toContainText('Catalog API');
  await expect(card(page, 'catalog')).toBeVisible();
  // The next review starts with every app on the board again.
  await review(page).getByRole('button', { name: 'Cancel' }).click();
  await page.getByRole('button', { name: 'Run', exact: true }).click();
  await expect(starts).toContainText('Catalog API');
});
