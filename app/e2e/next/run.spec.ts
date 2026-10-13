// The new canvas's Run and Stop: the review of what changes, and what is sent once it is confirmed.
import fs from 'node:fs';
import path from 'node:path';
import type { Page } from '@playwright/test';
import { test, expect, STACK } from '../canvas.ts';

const at = (x: number, y: number) => ({ x, y, run: 'cli', branch: 'main' });
const review = (page: Page) => page.getByRole('dialog');
/** What the server took from the page so far, one request a line. */
const sent = (temp: string) => {
  const file = path.join(temp, 'prompts.jsonl');
  const lines = fs.existsSync(file) ? fs.readFileSync(file, 'utf8').split('\n').filter(Boolean) : [];
  return lines.map(line => JSON.parse(line) as { tag: string; text: string; data: Record<string, unknown> });
};
test.use({
  start: 'next/',
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

test('Stop says what it leaves alone, and is carried out when confirmed', async ({ page, canvas }) => {
  await page.getByRole('button', { name: 'Stop', exact: true }).click();
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

test('Run is off on an empty board', async ({ page }) => {
  await page.getByRole('button', { name: 'Clear' }).click();
  await expect(page.getByRole('button', { name: 'Run', exact: true })).toBeDisabled();
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
  const card = page.locator('.svelte-flow__node-app[data-id="orders"]');
  // Running, as the server would report it: the card offers Stop, and only that app is stopped.
  await page.route('**/data/status.json', route =>
    route.fulfill({ json: { apps: { orders: { listening: true } }, running: ['orders', 'canvas'] } }),
  );
  const asked: unknown[] = [];
  await page.route('**/stop-apps?*', async route => {
    asked.push(route.request().postDataJSON());
    await route.fulfill({ json: { stopped: ['orders'] } });
  });
  await card.getByRole('button', { name: 'Stop Orders API' }).click();
  await expect(page.getByText('Stopped Orders API. Its changes stay until you revert.')).toBeVisible();
  expect(asked).toEqual([{ app: 'orders' }]);
  await page.screenshot({ path: 'test-results/next-card-icons.png' });

  // Not running: play goes straight to the review of that app alone.
  const web = page.locator('.svelte-flow__node-app[data-id="web"]');
  await web.getByRole('button', { name: 'Run Web Shop alone' }).click();
  await expect(page.getByRole('button', { name: 'Board: Web Shop alone' })).toBeVisible();
  await expect(review(page).getByRole('button', { name: /Back to/ })).toBeVisible();
});
