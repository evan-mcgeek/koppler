// Discover: the board's apps and what is one step from them, from the stack's facts; picking some plans a run.
import fs from 'node:fs';
import path from 'node:path';
import type { Page } from '@playwright/test';
import { at, card, expect, saveSettles, STACK, test } from './canvas.ts';

const stack = {
  ...STACK,
  apps: {
    ...STACK.apps,
    search: { ...STACK.apps.payments, name: 'Search API', slug: 'acme/search-api' },
  },
  found: { catalog: { search: 'src/search.ts:12' } },
};
const discover = async (page: Page) => {
  await expect(card(page, 'web')).toBeVisible();
  await page.keyboard.press('d');
  await expect(page.getByRole('radio', { name: 'Discover' })).toBeChecked();
};

test.describe('a board with an app', () => {
  test.use({
    stack,
    uncloned: ['search'],
    board: { env: 'qa', mode: 'auto', zoom: 1, pan: { x: 60, y: 60 }, nodes: { web: at(0, 0) }, edges: [] },
  });

  test('shows the board and one step from it; +N brings in what a card leaves out', async ({ page }) => {
    await discover(page);
    const lean = page.locator('.svelte-flow__node-lean');
    await expect(lean).toHaveCount(3);
    await expect(card(page, 'web').locator('.lean')).not.toHaveClass(/ring/);
    await expect(card(page, 'orders').locator('.lean')).toHaveClass(/ring/);
    await expect(page.locator('.links .link')).toHaveCount(3);
    await page.getByRole('button', { name: 'Show 1 more link of Orders API' }).click();
    await expect(card(page, 'payments')).toBeVisible();
    // Beside the card it came from, never on top of another.
    const [payments, catalog] = [await card(page, 'payments').boundingBox(), await card(page, 'catalog').boundingBox()];
    expect(
      !!payments &&
        !!catalog &&
        (payments.y >= catalog.y + catalog.height ||
          catalog.y >= payments.y + payments.height ||
          payments.x >= catalog.x + catalog.width ||
          catalog.x >= payments.x + payments.width),
    ).toBe(true);
    await expect(page.getByRole('button', { name: 'Show 1 more link of Orders API' })).toHaveCount(0);
    // A card moved by hand stays where it was put, after a reload too.
    await page.getByRole('button', { name: 'Fit the map in the window' }).click();
    const web = card(page, 'web');
    const from = await web.boundingBox();
    if (!from) throw new Error('no Web Shop card');
    await page.mouse.move(from.x + 40, from.y + 20);
    await page.mouse.down();
    await page.mouse.move(from.x + 40, from.y + 140, { steps: 8 });
    await page.mouse.up();
    await expect.poll(async () => Math.round((await web.boundingBox())?.y ?? 0)).toBeGreaterThan(from.y + 60);
    const moved = await page.locator('.svelte-flow__node[data-id="web"]').getAttribute('style');
    await saveSettles(page);
    await page.reload();
    await discover(page);
    await expect(page.locator('.svelte-flow__node[data-id="web"]')).toHaveAttribute('style', moved ?? '');
    await page.screenshot({ path: 'test-results/discover.png' });
  });

  test('a found call is dashed and listed with Confirm, which keeps it in the stack', async ({ page, canvas }) => {
    fs.mkdirSync(path.join(canvas.dir, 'stack'), { recursive: true });
    fs.mkdirSync(path.join(canvas.dir, 'config'), { recursive: true });
    const file = path.join(canvas.dir, 'stack', 'stack.json');
    const { found: _, ...facts } = stack;
    fs.writeFileSync(file, JSON.stringify(facts));
    fs.writeFileSync(
      path.join(canvas.dir, 'config', 'config.json'),
      JSON.stringify({ stack: path.join(canvas.dir, 'stack') }),
    );
    await discover(page);
    await page.getByRole('button', { name: 'Show 1 more link of Catalog API' }).click();
    await expect(page.locator('.links .link.found')).toHaveCount(1);
    await card(page, 'catalog').click();
    const panel = page.getByRole('complementary', { name: 'Catalog API' });
    const calls = panel.locator('section').filter({ has: page.getByRole('heading', { name: 'Calls' }) });
    await expect(calls).toContainText('Search API');
    await expect(calls).toContainText('Found in code, not confirmed');
    // The map makes room for the panel and keeps every card in view, none under the panel.
    const inMap = async (id: string) => {
      const [map, box] = [await page.locator('.map').boundingBox(), await card(page, id).boundingBox()];
      return !!map && !!box && box.x >= map.x && box.x + box.width <= map.x + map.width + 0.5;
    };
    await expect.poll(() => inMap('search')).toBe(true);
    await expect.poll(() => inMap('catalog')).toBe(true);
    await page.screenshot({ path: 'test-results/discover-panel.png' });
    await calls.getByRole('button', { name: 'Confirm' }).click();
    await expect
      .poll(() => (JSON.parse(fs.readFileSync(file, 'utf8')) as typeof STACK).apps['catalog']?.['consumes'])
      .toMatchObject({ search: { found: 'src/search.ts:12' } });
  });

  test('Plan a run with these puts the cloned apps on the board and lists the rest', async ({ page }) => {
    await discover(page);
    await page.getByRole('button', { name: 'Show 1 more link of Catalog API' }).click();
    await card(page, 'orders').click();
    await card(page, 'search').click({ modifiers: ['Shift'] });
    const bar = page.locator('.pickbar');
    await expect(bar).toContainText('2 picked: Orders API, Search API');
    await bar.getByRole('button', { name: 'Plan a run with these' }).click();
    await expect(page.getByRole('radio', { name: 'Plan' })).toBeChecked();
    await expect(card(page, 'orders')).toBeVisible();
    await expect(card(page, 'search')).toHaveCount(0);
    const left = page.getByRole('complementary', { name: 'Left out' });
    await expect(left).toContainText('From Discover: 2 picked.');
    await expect(left).toContainText('Search API');
    await expect(left.getByRole('button', { name: 'Clone it' })).toBeVisible();
    await page.screenshot({ path: 'test-results/discover-left-out.png' });
    await left.getByRole('button', { name: 'Back to Discover' }).click();
    await expect(page.getByRole('radio', { name: 'Discover' })).toBeChecked();
  });
});

test.describe('an empty board', () => {
  test.use({ board: { env: 'qa', mode: 'auto', zoom: 1, pan: { x: 60, y: 60 }, nodes: {}, edges: [] } });

  test('says where to start', async ({ page }) => {
    await page.getByRole('radio', { name: 'Discover' }).check();
    await expect(page.getByRole('status').filter({ hasText: 'No apps on this board' })).toBeVisible();
    await page.getByRole('button', { name: 'Add apps' }).click();
    await expect(page.getByRole('radio', { name: 'Plan' })).toBeChecked();
  });
});
