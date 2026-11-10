// Scheduled jobs: always the deployed one. A card in Discover beside the API whose repo they ship from; on Plan and
// Live only a line on the app that shares data with them, and a folded group in the Apps list.
import type { Page } from '@playwright/test';
import { at, card, expect, fromList, STACK, test } from './canvas.ts';

const { orders } = STACK.apps;
const job = (name: string, schedule: Record<string, string>, extra: Record<string, unknown> = {}) => ({
  name,
  kind: 'dotnet',
  slug: orders.slug,
  schedule,
  uses: { 'orders-db': {} },
  ...extra,
});
test.use({
  stack: {
    ...STACK,
    databases: { 'orders-db': { name: 'Orders DB', kind: 'postgres', tunnel: 'aurora.qa.acme.example', port: 5432 } },
    apps: {
      ...STACK.apps,
      orders: { ...orders, prereqs: [], envs: {}, uses: { 'orders-db': {} } },
      nightly: job(
        'Nightly settlement',
        { qa: 'cron(0 0 * * ? *)', prod: 'cron(0 0 * * ? *)' },
        { consumes: { payments: {} } },
      ),
      fraud: job('Fraud check', { qa: 'rate(1 hour)', prod: 'rate(20 minutes)' }),
    },
  },
  board: { env: 'qa', mode: 'auto', zoom: 1, pan: { x: 60, y: 40 }, nodes: { orders: at(0, 0) }, edges: [] },
});
const lean = (page: Page, name: string) => page.locator('.lean').filter({ hasText: name });

test('a job has a card in Discover only, beside the API whose repo it ships from, with its schedule here', async ({
  page,
}) => {
  // Plan draws no job card.
  await expect(card(page, 'orders')).toBeVisible();
  await expect(card(page, 'nightly')).toHaveCount(0);
  await page.getByRole('radio', { name: 'Discover' }).check();
  const nightly = lean(page, 'Nightly settlement');
  await expect(nightly.locator('.when')).toHaveText('daily 00:00 UTC');
  await expect(nightly.locator('.from')).toHaveText('from Orders API');
  await expect(nightly.locator('.deployed')).toHaveText(/Deployed only\s*QA/);
  await expect(nightly.locator('.when')).toHaveAttribute('title', /cron\(0 0 \* \* \? \*\)\nSchedule on QA/);
  await expect(lean(page, 'Fraud check').locator('.when')).toHaveText('every hour');
  // Joined to Orders API by a line that is not a cable.
  await expect(page.locator('.repo-line[data-repo="orders~nightly"]')).toHaveCount(1);
  await expect(page.locator('.repo-line').first()).toContainText('same repo');
  await page.screenshot({ path: 'test-results/jobs-discover.png' });
  // The schedule follows the environment Discover reads.
  await page.getByRole('radio', { name: 'PROD' }).click();
  await expect(lean(page, 'Fraud check').locator('.when')).toHaveText('every 20 min');
});

test("a local app's card says which jobs share its deployed database, and opens them in Discover", async ({ page }) => {
  const line = card(page, 'orders').locator('.jobs');
  await expect(line).toHaveText('2 jobs use Orders DB: Nightly settlement daily 00:00 UTC, Fraud check every hour');
  await page.screenshot({ path: 'test-results/jobs-plan-line.png' });
  await line.click();
  await expect(page.getByRole('radio', { name: 'Discover' })).toBeChecked();
  await expect(lean(page, 'Fraud check')).toBeVisible();
  await expect(page.locator('.svelte-flow__node.selected .lean')).toHaveCount(2);
});

test('the Apps list keeps jobs folded at its foot, uncounted, and they never go on the board', async ({ page }) => {
  const side = page.getByRole('complementary', { name: 'Apps' });
  await expect(side.locator('.count')).toHaveText('1 of 4 on the board');
  const head = side.getByRole('button', { name: 'Scheduled jobs · 2' });
  await expect(head).toHaveAttribute('aria-expanded', 'false');
  await expect(side.getByRole('list', { name: 'Scheduled jobs' })).toHaveCount(0);
  await head.click();
  const jobs = side.getByRole('list', { name: 'Scheduled jobs' });
  await expect(jobs.locator('.name')).toHaveText(['Fraud check', 'Nightly settlement']);
  await expect(jobs.locator('.when').first()).toHaveText('every hour');
  const fraud = jobs.getByRole('listitem').filter({ hasText: 'Fraud check' });
  await fraud.hover();
  await expect(fraud.getByRole('button')).toHaveText(['Show in Discover', 'Settings']);
  await page.screenshot({ path: 'test-results/jobs-apps-list.png' });
  // "job" lists only jobs.
  await head.click();
  await side.getByRole('searchbox').fill('job');
  await expect(side.getByRole('list', { name: 'Scheduled jobs' }).locator('.name')).toHaveCount(2);
  await expect(side.getByRole('list', { name: 'Not on the board' })).toHaveCount(0);
  await side.getByRole('searchbox').fill('');
  await expect(await fromList(page, 'Payments API')).toBeVisible();
  await head.click();
  await fraud.hover();
  await fraud.getByRole('button', { name: 'Show in Discover' }).click();
  await expect(page.getByRole('radio', { name: 'Discover' })).toBeChecked();
});

test("a job's settings: Runs as, and its schedule per environment read back in words", async ({ page }) => {
  const side = page.getByRole('complementary', { name: 'Apps' });
  await side.getByRole('button', { name: 'Scheduled jobs · 2' }).click();
  const fraud = side.getByRole('list', { name: 'Scheduled jobs' }).getByRole('listitem').filter({ hasText: 'Fraud' });
  await fraud.hover();
  await fraud.getByRole('button', { name: 'Settings' }).click();
  const panel = page.getByRole('dialog', { name: 'Fraud check' });
  await expect(panel.getByRole('tab')).toHaveText([
    'Identity',
    'Schedule',
    'Calls',
    'Secrets',
    'Environments',
    'Other',
  ]);
  await panel.getByRole('tab', { name: 'Identity' }).click();
  await expect(panel.getByRole('radio', { name: 'On a schedule' })).toBeChecked();
  await panel.getByRole('tab', { name: 'Schedule' }).click();
  await expect(panel.getByLabel('Schedule on PROD')).toHaveValue('rate(20 minutes)');
  await expect(panel.locator('.read').nth(1)).toHaveText('every 20 min');
  await panel.getByLabel('Schedule on QA').fill('rate(20 minute)');
  await panel.getByLabel('Schedule on QA').blur();
  await expect(panel.locator('.read.bad')).toHaveText('Use "minutes" for more than 1');
  await expect(panel).toContainText('Not for a job: URL, Health check, Start command, Port, Branch to run.');
  await page.screenshot({ path: 'test-results/jobs-settings.png' });
});
