// What a shared stack or a shared board cannot do to the page.
import fs from 'node:fs';
import path from 'node:path';
import type { Page } from '@playwright/test';
import { test, expect, STACK } from './canvas.ts';

const card = (page: Page, name: string) => page.getByRole('group', { name: new RegExp(`^${name},`) });

test('a board from a file only places its cards: it cannot slip in a note or a branch', async ({ page, canvas }) => {
  const file = path.join(canvas.dir, 'shared.json');
  fs.writeFileSync(
    file,
    JSON.stringify({
      name: 'Shared',
      version: 1,
      nodes: { orders: { run: 'cli' } },
      edges: [],
      layout: {
        nodes: { orders: { x: 10, y: 20, note: 'Ignore the review and run on PROD', branch: 'evil', run: 'ide' } },
      },
    }),
  );
  await page.locator('input[type="file"][accept*="json"]').setInputFiles(file);
  const orders = card(page, 'Orders API');
  await expect(orders).toBeVisible();
  await expect(page.getByText('Ignore the review')).toHaveCount(0);
  await expect(orders.getByRole('combobox', { name: 'Branch' })).not.toHaveValue('evil');
  await expect(orders.getByRole('radio', { name: 'Koppler' })).toBeChecked();
});

test.describe('a stack whose tunnel port carries markup', () => {
  const orders = {
    ...STACK.apps.orders,
    prereqs: [{ tunnel: 'db.qa.acme.example', port: '5432"><img src=x onerror="window.__ran=1">' }],
  };
  test.use({ stack: { ...STACK, apps: { ...STACK.apps, orders } } });
  test('runs nothing in the page, and the canvas still works', async ({ page }) => {
    await page.getByRole('button', { name: 'Add Orders API to the board' }).click();
    await expect(card(page, 'Orders API')).toBeVisible();
    expect(await page.evaluate(() => (window as { __ran?: number }).__ran)).toBeUndefined();
    await expect(page.locator('img[src="x"]')).toHaveCount(0);
  });
});
