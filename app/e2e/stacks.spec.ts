// Switching stacks: the page follows the stack in use, and only once that stack's own data is there.
import fs from 'node:fs';
import path from 'node:path';
import { test, expect } from './canvas.ts';

test('a stack switched to shows its own clones, not the ones of the stack before it', async ({ page, canvas }) => {
  await expect(page.getByRole('button', { name: /Acme Shop/ })).toBeVisible();
  const other = path.join(canvas.dir, 'other');
  const write = (file: string, value: unknown) => {
    fs.mkdirSync(path.dirname(file), { recursive: true });
    fs.writeFileSync(file, JSON.stringify(value));
  };
  const stack = {
    name: 'Other Stack',
    envs: ['qa'],
    apps: { reports: { name: 'Reports', kind: 'node', slug: 'acme/reports', url: 'http://localhost:7001' } },
    source: path.join(other, 'stack.json'),
  };
  const data = (name: string) => path.join(canvas.temp, `${name}.json`);
  const roots = [canvas.dir];
  // How a switch begins: the other stack is the one in use and its app list is there, the clones are still the last stack's.
  write(path.join(canvas.dir, 'config', 'config.json'), { stack: other, roots });
  write(data('registry'), stack);
  // The page asks what is in use every second and a half: several rounds pass while the clones are looked up.
  await page.waitForTimeout(4000);
  const clone = { path: path.join(canvas.dir, 'clones', 'reports'), branch: 'main', dirty: 0, branches: ['main'] };
  write(data('local'), { roots, at: new Date().toISOString(), apps: { reports: clone } });
  write(data('registry'), { ...stack, found: {} });

  await expect(page.getByRole('button', { name: /Other Stack/ })).toBeVisible({ timeout: 15000 });
  const row = page.getByRole('listitem').filter({ hasText: 'Reports' });
  await expect(row).toBeVisible();
  await expect(row).not.toContainText('not cloned');
  await expect(row.getByRole('button', { name: 'Add Reports to the board' })).toBeVisible();
});

test('a stack being loaded from elsewhere is named over the board, which waits', async ({ page, canvas }) => {
  const other = path.join(canvas.dir, 'config', 'stacks', 'other');
  fs.mkdirSync(other, { recursive: true });
  fs.writeFileSync(path.join(other, 'stack.json'), JSON.stringify({ name: 'Other Stack', envs: ['qa'], apps: {} }));
  const notice = page.getByRole('status').filter({ hasText: 'Loading' });
  await expect(page.getByRole('button', { name: /Acme Shop/ })).toBeVisible();
  await expect(notice).toBeHidden();
  // What `koppler sync` leaves while it runs: the stack it is loading and its own process.
  const marker = path.join(canvas.temp, 'loading.json');
  fs.writeFileSync(marker, JSON.stringify({ stack: other, pid: process.pid }));
  await expect(notice).toHaveText('Loading Other Stack...', { timeout: 15000 });
  await expect(page.locator('#side')).toHaveAttribute('inert', '');
  await expect(page.locator('.topbar .actions')).toHaveAttribute('inert', '');
  // The load ended without this stack coming into use: the board is back.
  fs.rmSync(marker);
  await expect(notice).toBeHidden({ timeout: 15000 });
  await expect(page.locator('#side')).not.toHaveAttribute('inert', '');
});
