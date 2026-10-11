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
  await page.getByRole('button', { name: 'Stop' }).click();
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
