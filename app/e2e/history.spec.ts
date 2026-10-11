// The History says what happened, also when things were stopped outside a run.
import { spawnSync } from 'node:child_process';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { test, expect } from './canvas.ts';

const koppler = path.join(path.dirname(fileURLToPath(import.meta.url)), '..', 'dist', 'koppler.mjs');

test('apps stopped from the Stop menu show in the History', async ({ page, canvas }) => {
  const env = { ...process.env, KOPPLER_STATE: path.join(canvas.dir, 'state'), KOPPLER_TEMP: canvas.temp };
  const run = (...args: string[]) => spawnSync(process.execPath, [koppler, ...args], { env, encoding: 'utf8' });
  expect(run('run', 'orders', '--', 'sleep', '60').stdout).toContain('started orders');
  try {
    // The page learns what runs from its next status.
    await expect(page.getByRole('status').filter({ hasText: 'Orders API running' })).toBeVisible();
    await page.getByRole('button', { name: 'More stop options' }).click();
    const stopApps = page.getByRole('menuitem', { name: /Stop apps, keep changes/ });
    await expect(stopApps).not.toHaveAttribute('aria-disabled', 'true');
    await stopApps.click();
    await page
      .getByRole('dialog', { name: 'Stop apps, keep changes' })
      .getByRole('button', { name: 'Stop apps' })
      .click();
    await expect(page.getByText('Stopped 1 process.')).toBeVisible();

    await page.getByRole('button', { name: 'History' }).click();
    const history = page.getByRole('dialog', { name: 'History' });
    await expect(history).toContainText('Apps stopped, changes kept');
    await expect(history).toContainText('Orders API');
    expect(run('history').stdout).toMatch(/apps stopped, changes kept: orders/);
  } finally {
    run('stop', '--all', '--yes');
  }
});
