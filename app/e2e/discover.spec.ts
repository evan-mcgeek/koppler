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
  // Settled: every card placed, and the view no longer moving to fit them.
  await expect(page.locator('.svelte-flow__node.unplaced')).toHaveCount(0);
  const view = () => page.locator('.svelte-flow__viewport').getAttribute('style');
  await expect
    .poll(async () => {
      const was = await view();
      await page.waitForTimeout(120);
      return was === (await view());
    })
    .toBe(true);
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
    await page.getByRole('button', { name: 'Fit', exact: true }).click();
    const web = card(page, 'web');
    const from = await web.boundingBox();
    if (!from) throw new Error('no Web Shop card');
    await page.mouse.move(from.x + 40, from.y + 20);
    await page.mouse.down();
    await page.mouse.move(from.x + 40, from.y + 140, { steps: 8 });
    await page.mouse.up();
    await expect.poll(async () => Math.round((await web.boundingBox())?.y ?? 0)).toBeGreaterThan(from.y + 60);
    const placed = (style: string | null) => style?.match(/transform: [^;]+/)?.[0];
    const moved = placed(await page.locator('.svelte-flow__node[data-id="web"]').getAttribute('style'));
    await saveSettles(page);
    await page.reload();
    await discover(page);
    await expect
      .poll(async () => placed(await page.locator('.svelte-flow__node[data-id="web"]').getAttribute('style')))
      .toBe(moved);
    await page.screenshot({ path: 'test-results/discover.png' });
  });

  test('a card being dragged keeps its links on it, before it is let go', async ({ page }) => {
    await discover(page);
    await page.getByRole('button', { name: 'Fit', exact: true }).click();
    const web = card(page, 'web');
    const from = await web.boundingBox();
    if (!from) throw new Error('no Web Shop card');
    await page.mouse.move(from.x + 40, from.y + 20);
    await page.mouse.down();
    await page.mouse.move(from.x + 40, from.y + 160, { steps: 8 });
    const now = await web.boundingBox();
    if (!now) throw new Error('no Web Shop card');
    expect(now.y).toBeGreaterThan(from.y + 100);
    // Where its link leaves it, on the page: on the card's edge as it is now.
    const start = await page
      .locator('.links .link[data-link^="web>"] .wire')
      .first()
      .evaluate(el => {
        const wire = el as SVGPathElement;
        const p = wire.getPointAtLength(0).matrixTransform(wire.getScreenCTM() ?? new DOMMatrix());
        return { x: p.x, y: p.y };
      });
    expect(start.y).toBeGreaterThanOrEqual(now.y - 2);
    expect(start.y).toBeLessThanOrEqual(now.y + now.height + 2);
    await page.mouse.up();
  });

  test('a link lands in a ring drawn whole over the card it reaches', async ({ page }) => {
    await discover(page);
    const rings = page.locator('.svelte-flow circle.ring');
    await expect(rings.first()).toBeVisible();
    // The topmost thing at each ring's centre is the ring, never the card under it.
    const covered = await rings.evaluateAll(all => {
      for (const layer of new Set(all.map(ring => ring.closest('svg')))) if (layer) layer.style.pointerEvents = 'auto';
      return all.filter(ring => {
        const box = ring.getBoundingClientRect();
        const top = document.elementFromPoint(box.x + box.width / 2, box.y + box.height / 2);
        return top !== ring;
      }).length;
    });
    expect(covered).toBe(0);
  });

  test('dragging another card moves only that one, and a click on the map clears the pick', async ({ page }) => {
    await discover(page);
    await page.getByRole('button', { name: 'Fit', exact: true }).click();
    await card(page, 'orders').click();
    await expect(card(page, 'orders').locator('.lean')).toHaveClass(/picked/);
    const [web, orders] = [await card(page, 'web').boundingBox(), await card(page, 'orders').boundingBox()];
    if (!web || !orders) throw new Error('no cards');
    await page.mouse.move(web.x + 40, web.y + 20);
    await page.mouse.down();
    await page.mouse.move(web.x + 40, web.y + 140, { steps: 8 });
    await page.mouse.up();
    expect((await card(page, 'web').boundingBox())?.y).toBeGreaterThan(web.y + 60);
    expect(Math.abs(((await card(page, 'orders').boundingBox())?.y ?? 0) - orders.y)).toBeLessThan(3);
    const map = page.locator('.svelte-flow__pane');
    const box = await map.boundingBox();
    if (!box) throw new Error('no map');
    await page.mouse.click(box.x + box.width / 2, box.y + 20);
    await expect(page.locator('.lean.picked')).toHaveCount(0);
  });

  test('after a shortcut the system kept the key-up of (a screenshot), picking and dragging work as usual', async ({
    page,
  }) => {
    await discover(page);
    await page.getByRole('button', { name: 'Fit', exact: true }).click();
    // Cmd goes down and its key-up never comes, as when macOS takes Cmd+Shift+4 for a screenshot.
    await page.evaluate(() =>
      document.body.dispatchEvent(new KeyboardEvent('keydown', { key: 'Meta', metaKey: true, bubbles: true })),
    );
    await card(page, 'orders').click();
    const [web, orders] = [await card(page, 'web').boundingBox(), await card(page, 'orders').boundingBox()];
    if (!web || !orders) throw new Error('no cards');
    await page.mouse.move(web.x + 40, web.y + 20);
    await page.mouse.down();
    await page.mouse.move(web.x + 40, web.y + 140, { steps: 8 });
    await page.mouse.up();
    expect(Math.abs(((await card(page, 'orders').boundingBox())?.y ?? 0) - orders.y)).toBeLessThan(3);
    const box = await page.locator('.svelte-flow__pane').boundingBox();
    if (!box) throw new Error('no map');
    await page.mouse.click(box.x + box.width / 2, box.y + 20);
    await expect(page.locator('.lean.picked')).toHaveCount(0);
  });

  test('has the same tools as the board, and they work the same way', async ({ page }) => {
    const tools = () =>
      page
        .getByRole('toolbar')
        .getByRole('button')
        .evaluateAll(all => all.map(one => one.getAttribute('aria-label') ?? one.textContent.trim()));
    await expect(card(page, 'web')).toBeVisible();
    const onBoard = await tools();
    await discover(page);
    await expect(page.getByRole('toolbar', { name: 'Discover' })).toBeVisible();
    expect(await tools()).toEqual(onBoard.filter(one => one !== 'Clear'));
    await expect(
      page.getByRole('img', { name: 'Overview of the map' }).or(page.getByLabel('Overview of the map')),
    ).toHaveCount(1);
    await page.getByRole('button', { name: 'Fit', exact: true }).click();
    const lean = page.locator('.lean');
    // An area dragged over the map picks the cards in it.
    const pane = await page.locator('.svelte-flow__pane').boundingBox();
    if (!pane) throw new Error('no map');
    await page.mouse.move(pane.x + 4, pane.y + 4);
    await page.mouse.down();
    await page.mouse.move(pane.x + pane.width - 4, pane.y + pane.height - 4, { steps: 10 });
    await page.mouse.up();
    await expect(page.locator('.lean.picked')).toHaveCount(await lean.count());
    await page.mouse.click(pane.x + pane.width / 2, pane.y + 20);
    await expect(page.locator('.lean.picked')).toHaveCount(0);
    await page.keyboard.press('ControlOrMeta+a');
    await expect(page.locator('.lean.picked')).toHaveCount(await lean.count());
    await page.keyboard.press('Escape');
    // Arrange gives the next layout each time it is pressed; one the same as the last is skipped.
    const layout = () =>
      page.locator('.svelte-flow__node').evaluateAll(all => all.map(one => one.style.transform).join());
    for (let n = 0; n < 3; n++) {
      const was = await layout();
      await page.getByRole('button', { name: 'Arrange' }).click();
      await expect.poll(layout).not.toBe(was);
    }
    // Undo puts the map back as it was before; changes less than 0.7 seconds apart are one step, as on a board.
    await page.waitForTimeout(800);
    const before = await layout();
    await page.getByRole('button', { name: 'Arrange' }).click();
    await expect.poll(layout).not.toBe(before);
    await page.keyboard.press('ControlOrMeta+z');
    await expect.poll(layout).toBe(before);
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

test.describe('an outside system with a long description', () => {
  test.use({
    stack: {
      ...STACK,
      apps: {
        ...STACK.apps,
        web: { ...STACK.apps.web, consumes: { ...(STACK.apps.web?.['consumes'] as object | undefined), crm: {} } },
        crm: {
          name: 'CRM event handler',
          kind: 'other',
          outside:
            'Lambda crm-event-handler in acme/orders-api (Orders.Events/infra); CRM OrderChanged__e; deployed only',
        },
      },
    },
    board: { env: 'qa', mode: 'auto', zoom: 1, pan: { x: 60, y: 60 }, nodes: { web: at(0, 0) }, edges: [] },
  });

  test('keeps it inside its card, whole on hover', async ({ page }) => {
    await discover(page);
    const crm = card(page, 'crm');
    const row = crm.locator('.meta');
    expect(await row.evaluate(el => el.scrollWidth - el.clientWidth)).toBeLessThanOrEqual(0);
    await expect(crm.locator('[title$="deployed only"]')).toHaveCount(1);
  });
});
