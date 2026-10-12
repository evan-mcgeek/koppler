// The new canvas's debug log: what happens on the page is kept for tracing a problem, never what is typed.
import fs from 'node:fs';
import path from 'node:path';
import { test, expect } from '../canvas.ts';

test.use({
  start: 'next/',
  board: { env: 'qa', mode: 'auto', nodes: { orders: { x: 0, y: 0, run: 'cli', branch: 'main' } }, edges: [] },
});

test('the log keeps clicks, choices and messages with the board, and no typed text', async ({ page, canvas }) => {
  const kept = () => {
    const file = path.join(canvas.temp, 'debug.jsonl');
    const lines = fs.existsSync(file) ? fs.readFileSync(file, 'utf8').split('\n').filter(Boolean) : [];
    return lines.map(line => JSON.parse(line) as { kind: string; what: string; detail?: string; board?: object });
  };
  const card = page.locator('.svelte-flow__node[data-id="orders"]');
  // The test server runs from the source folder, where the log is always on.
  await page.getByRole('button', { name: 'Settings' }).click();
  const log = page.getByRole('switch', { name: 'Debug log' });
  await expect(log).toBeChecked();
  await expect(log).toBeDisabled();
  await page.screenshot({ path: 'test-results/next-debug.png' });
  await page.keyboard.press('Escape');

  await card.getByRole('radio', { name: 'Me' }).check();
  await card.getByLabel('Branch').click();
  await card.getByLabel('Branch').fill('secret-branch-name');
  await card.getByLabel('Branch').blur();
  await expect
    .poll(() => kept().some(entry => entry.kind === 'change' && entry.what.includes('Branch')), { timeout: 10000 })
    .toBe(true);
  const entries = kept();
  expect(entries.find(entry => entry.kind === 'change' && entry.detail === 'ide')?.what).toContain('in orders');
  expect(entries.find(entry => entry.what.includes('Branch') && entry.kind === 'change')?.detail).toBe('(typed)');
  expect(JSON.stringify(entries)).not.toContain('secret-branch-name');
  expect(entries.at(-1)?.board).toMatchObject({ apps: 1, cables: 0, view: 'edit', env: 'qa' });

  // Clearing empties it, and says so.
  await page.getByRole('button', { name: 'Settings' }).click();
  await page.locator('#settings').getByRole('button', { name: 'Clear' }).click();
  await expect(page.getByRole('status')).toContainText('Debug log cleared');
});
