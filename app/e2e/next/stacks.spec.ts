// The new canvas's stack picker: every stack on this machine, switching to another, and the wait while one loads.
import fs from 'node:fs';
import path from 'node:path';
import type { Page } from '@playwright/test';
import { test, expect, STACK } from '../canvas.ts';

test.use({
  start: 'next/',
  board: { env: 'qa', mode: 'auto', nodes: { web: { x: 0, y: 0, run: 'cli', branch: 'main' } }, edges: [] },
});

const notice = (page: Page) => page.getByRole('status').filter({ hasText: 'Loading' });
const picker = (page: Page, name: string) => page.getByRole('button', { name, exact: true });
/** Two private stacks, the first in use and loaded, as `koppler use` and `koppler sync` leave them. */
const twoStacks = (canvas: { dir: string; temp: string }) => {
  const stacks = path.join(canvas.dir, 'config', 'stacks');
  const [acme, other] = [path.join(stacks, 'acme'), path.join(stacks, 'other')];
  const reports = { name: 'Reports', kind: 'node', slug: 'acme/reports', url: 'http://localhost:7001' };
  for (const [dir, stack] of [
    [acme, STACK],
    [other, { name: 'Other Stack', envs: ['qa'], apps: { reports } }],
  ] as const) {
    fs.mkdirSync(dir, { recursive: true });
    fs.writeFileSync(path.join(dir, 'stack.json'), JSON.stringify(stack));
  }
  fs.writeFileSync(
    path.join(canvas.dir, 'config', 'config.json'),
    JSON.stringify({ stack: acme, roots: [canvas.dir] }),
  );
  const registry = { ...STACK, source: path.join(acme, 'stack.json'), found: {} };
  fs.writeFileSync(path.join(canvas.temp, 'registry.json'), JSON.stringify(registry));
  return { acme, other };
};

test('the picker lists the stacks, and switching loads the other one behind a notice', async ({ page, canvas }) => {
  twoStacks(canvas);
  await page.reload();
  await picker(page, 'Acme Shop').click();
  const menu = page.getByRole('menu', { name: 'Stacks' });
  // The server looks the stacks up again at most every ten seconds.
  await expect(menu.getByRole('menuitemradio', { name: /Other Stack/ })).toContainText('private, 1 app', {
    timeout: 15000,
  });
  await expect(menu.getByRole('menuitemradio', { name: /Acme Shop/ })).toHaveAttribute('aria-checked', 'true');
  await expect(menu.getByRole('menuitemradio', { name: /Acme Shop/ })).toContainText('private, 4 apps');
  await page.screenshot({ path: 'test-results/next-stacks.png' });

  await menu.getByRole('menuitemradio', { name: /Other Stack/ }).click();
  await expect(notice(page)).toHaveText('Loading Other Stack...');
  await page.screenshot({ path: 'test-results/next-stack-loading.png' });
  // Koppler loads it and the page opens again with it.
  await expect(picker(page, 'Other Stack')).toBeVisible({ timeout: 20000 });
  await expect(page.getByRole('complementary')).toContainText('Reports');
  await expect(notice(page)).toHaveCount(0);
});

test('a stack loaded from elsewhere is named over the board, which waits', async ({ page, canvas }) => {
  const { other } = twoStacks(canvas);
  await page.reload();
  await expect(picker(page, 'Acme Shop')).toBeVisible();
  await expect(notice(page)).toHaveCount(0);
  // What `koppler sync` leaves while it runs: the stack it is loading and its own process.
  const marker = path.join(canvas.temp, 'loading.json');
  fs.writeFileSync(marker, JSON.stringify({ stack: other, pid: process.pid }));
  await expect(notice(page)).toHaveText('Loading Other Stack...', { timeout: 15000 });
  await expect(page.getByRole('main')).toHaveAttribute('inert', '');
  // The load ended without that stack coming into use: the board is back.
  fs.rmSync(marker);
  await expect(notice(page)).toHaveCount(0, { timeout: 15000 });
  await expect(page.getByRole('main')).not.toHaveAttribute('inert', '');
});

test('with something running, switching first shows what it stops', async ({ page, canvas }) => {
  const { acme, other } = twoStacks(canvas);
  const stacks = [
    { dir: acme, name: 'Acme Shop', path: acme, apps: 4, shared: false },
    { dir: other, name: 'Other Stack', path: other, apps: 1, shared: false },
  ];
  const live = { env: 'qa', nodes: { web: { run: 'cli' } }, edges: [] };
  await page.route('**/data/status.json', route =>
    route.fulfill({ json: { apps: {}, running: ['web'], live, stacks, stack: acme } }),
  );
  await page.reload();
  await picker(page, 'Acme Shop').click();
  await page.getByRole('menuitemradio', { name: /Other Stack/ }).click();
  const review = page.getByRole('dialog');
  await expect(review.getByRole('heading')).toHaveText('Switch to Other Stack');
  await expect(review).toContainText('Acme Shop still has something running.');
  await expect(review).toContainText('Web Shop');
  await expect(review.getByRole('button', { name: 'Stop, revert and switch' })).toBeVisible();
  await expect(notice(page)).toHaveCount(0);
});
