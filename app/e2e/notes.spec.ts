// The new canvas's side notes: what is worth knowing about the board, and what the stack needs on this machine.
import fs from 'node:fs';
import path from 'node:path';
import type { Page } from '@playwright/test';
import { test, expect, nextEdit } from './canvas.ts';

const at = (x: number, y: number) => ({ x, y, run: 'cli', branch: 'main' });
const sent = (temp: string) => {
  const file = path.join(temp, 'prompts.jsonl');
  const lines = fs.existsSync(file) ? fs.readFileSync(file, 'utf8').split('\n').filter(Boolean) : [];
  return lines.map(line => JSON.parse(line) as { tag: string; text: string; data: Record<string, unknown> });
};
const notes = (page: Page) => page.getByRole('group', { name: 'About this board' }).getByRole('note');
test.use({
  uncloned: ['catalog'],
  board: { env: 'qa', mode: 'auto', nodes: { web: at(0, 0), orders: at(420, 0), payments: at(840, 0) }, edges: [] },
});

test('an app on the board that is still called in the deployed environment is said, with the cable to draw', async ({
  page,
}) => {
  await expect(notes(page)).toHaveText([
    /Orders API is on your board, but Web Shop still calls the QA one\./,
    /Payments API is on your board, but Orders API still calls the QA one\./,
  ]);
  await page.screenshot({ path: 'test-results/next-notes.png' });
  await notes(page).first().getByRole('button', { name: 'Connect' }).click();
  await expect(page.locator('.svelte-flow__edge[data-id="web>orders"]')).toHaveCount(1);
  await expect(notes(page)).toHaveCount(1);
  // A dismissed note stays dismissed for this board.
  await notes(page).getByRole('button', { name: 'Dismiss this note' }).click();
  await expect(notes(page)).toHaveCount(0);
  await nextEdit(page);
  await page.reload();
  await expect(page.locator('.svelte-flow__edge[data-id="web>orders"]')).toHaveCount(1);
  await expect(notes(page)).toHaveCount(0);
});

test('an app that is not cloned is named, with its clone command to copy and a way to look again', async ({
  page,
  context,
}) => {
  await context.grantPermissions(['clipboard-read', 'clipboard-write']);
  const asked: string[] = [];
  await page.route('**/rescan?*', async route => {
    asked.push(route.request().url());
    await route.fulfill({ status: 500, json: { error: 'The scan did not finish.' } });
  });
  const note = page.getByRole('note', { name: 'Not cloned' });
  await expect(note).toContainText('Catalog API is not cloned on this Mac, so it cannot run here.');
  await note.getByRole('button', { name: 'Copy clone command' }).click();
  await expect(note.getByRole('button', { name: 'Copied' })).toBeVisible();
  expect(await page.evaluate(() => navigator.clipboard.readText())).toBe(
    'git clone git@github.com:acme/catalog-api.git',
  );
  await page.getByRole('complementary').screenshot({ path: 'test-results/next-not-cloned.png' });
  await note.getByRole('button', { name: 'Look again' }).click();
  await expect(page.getByRole('alert')).toContainText('The scan did not finish.');
  expect(asked).toHaveLength(1);
});

test('what the stack needs on this Mac is listed with its commands, and missing facts go to the agent', async ({
  page,
  canvas,
}) => {
  await expect(page.getByRole('button', { name: /missing on this Mac/ })).toHaveCount(0);
  const checks = [
    { name: 'dotnet', state: 'missing', detail: 'brew install dotnet', for: ['Orders API'] },
    { name: 'Docker is running', state: 'pending', detail: '' },
    { name: 'node', state: 'ok', detail: 'v22' },
    {
      name: 'orders prod tunnel',
      state: 'gap',
      detail: 'No PROD tunnel for Orders API',
      app: 'orders',
      env: 'prod',
      kind: 'tunnel',
    },
  ];
  await page.route('**/data/status.json', route =>
    route.fulfill({ json: { apps: {}, checks, restart: 'koppler canvas stop && koppler canvas start' } }),
  );
  const open = page.getByRole('button', {
    name: '1 missing on this Mac, 1 check waits for your approval, 1 PROD fact missing from the stack',
  });
  await open.click();
  const needs = page.getByRole('dialog', { name: 'What this stack needs on this Mac' });
  await expect(needs.locator('code')).toHaveText(['brew install dotnet', 'koppler doctor --approve']);
  await expect(needs).toContainText('Missing, needed by Orders API. Install it with:');
  await expect(needs).toContainText('Missing from the stack for PROD');
  await expect(needs).toContainText('No PROD tunnel');
  await page.screenshot({ path: 'test-results/next-needs.png' });
  await needs.getByRole('button', { name: 'Ask the agent to find it' }).click();
  await expect(needs.getByRole('button', { name: 'Sent to the agent' })).toBeDisabled();
  await expect.poll(() => sent(canvas.temp).length).toBe(1);
  expect(sent(canvas.temp)[0]?.tag).toBe('koppler-facts');
  expect(sent(canvas.temp)[0]?.data).toEqual({ env: 'prod', gaps: ['No PROD tunnel for Orders API'] });
  await page.keyboard.press('Escape');
  // Folded, the pane keeps a mark that something is needed; it opens the pane again.
  await page.getByRole('button', { name: 'Hide the side pane' }).click();
  await page.getByRole('button', { name: 'This stack needs something on this Mac' }).click();
  await expect(open).toBeVisible();
  // A server running older code than is on disk says how to restart it.
  await expect(page.getByRole('complementary')).toContainText('The canvas server runs older code');
  await expect(page.getByRole('complementary').locator('.warn code')).toHaveText(/koppler/);
  await expect(page.getByRole('button', { name: 'Copy restart command' })).toBeVisible();
  await page.getByRole('complementary').locator('.warn').first().screenshot({ path: 'test-results/next-restart.png' });
});
