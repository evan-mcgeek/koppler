// Discover: the board's apps and what is one step from them, from the stack's facts; picking some plans a run.
import fs from 'node:fs';
import path from 'node:path';
import type { Page } from '@playwright/test';
import { at, card, expect, fromMenu, saveSettles, STACK, test } from './canvas.ts';

const stack = {
  ...STACK,
  apps: {
    ...STACK.apps,
    search: { ...STACK.apps.payments, name: 'Search API', slug: 'acme/search-api' },
  },
  found: { catalog: { search: 'src/search.ts:12' } },
};
/** The view no longer moving: it refits when the map or the panel beside it changes. */
const settled = async (page: Page) => {
  const view = () => page.locator('.svelte-flow__viewport').getAttribute('style');
  await expect
    .poll(async () => {
      const was = await view();
      await page.waitForTimeout(120);
      return was === (await view());
    })
    .toBe(true);
};
const discover = async (page: Page) => {
  await expect(card(page, 'web')).toBeVisible();
  await page.keyboard.press('d');
  await expect(page.getByRole('radio', { name: 'Discover' })).toBeChecked();
  // Every card placed, then the view still.
  await expect(page.locator('.svelte-flow__node.unplaced')).toHaveCount(0);
  await settled(page);
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
    await settled(page);
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

  test('the layout Arrange gave is kept, after a reload too', async ({ page }) => {
    await discover(page);
    const layout = () =>
      page.locator('.svelte-flow__node').evaluateAll(all => all.map(one => one.style.transform).join());
    const was = await layout();
    await page.getByRole('button', { name: 'Arrange', exact: true }).click();
    await expect.poll(layout).not.toBe(was);
    const arranged = await layout();
    await saveSettles(page);
    await page.reload();
    await discover(page);
    await expect.poll(layout).toBe(arranged);
  });

  test('a card being dragged keeps its links on it, before it is let go', async ({ page }) => {
    await discover(page);
    await page.getByRole('button', { name: 'Fit', exact: true }).click();
    await settled(page);
    const web = card(page, 'web');
    const from = await web.boundingBox();
    if (!from) throw new Error('no Web Shop card');
    await page.mouse.move(from.x + 40, from.y + 20);
    await page.mouse.down();
    await page.mouse.move(from.x + 40, from.y + 160, { steps: 8 });
    const now = await web.boundingBox();
    if (!now) throw new Error('no Web Shop card');
    expect(now.y).toBeGreaterThan(from.y + 100);
    // Where its link leaves it, on the page: on the card's edge as it is now, still held. On a slow machine the link
    // is drawn a frame after the card, so it is given those frames to catch up.
    const leaves = () =>
      page
        .locator('.links .link[data-link^="web>"] .wire')
        .first()
        .evaluate(el => {
          const wire = el as SVGPathElement;
          return wire.getPointAtLength(0).matrixTransform(wire.getScreenCTM() ?? new DOMMatrix()).y;
        });
    await expect
      .poll(async () => {
        const [y, box] = [await leaves(), await web.boundingBox()];
        return !!box && y >= box.y - 2 && y <= box.y + box.height + 2;
      })
      .toBe(true);
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
    await settled(page);
    await card(page, 'orders').click();
    await expect(card(page, 'orders').locator('.lean')).toHaveClass(/picked/);
    // Its panel opens and the map refits beside it.
    await settled(page);
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
    // Pointed at first, as a person does: the map takes the click once it has caught up with the pointer.
    await page.mouse.move(box.x + box.width / 2, box.y + 20, { steps: 4 });
    await page.waitForTimeout(100);
    await page.mouse.click(box.x + box.width / 2, box.y + 20);
    await expect(page.locator('.lean.picked')).toHaveCount(0);
  });

  test('after a shortcut the system kept the key-up of (a screenshot), picking and dragging work as usual', async ({
    page,
  }) => {
    await discover(page);
    await page.getByRole('button', { name: 'Fit', exact: true }).click();
    await settled(page);
    // Cmd goes down and its key-up never comes, as when macOS takes Cmd+Shift+4 for a screenshot.
    await page.evaluate(() =>
      document.body.dispatchEvent(new KeyboardEvent('keydown', { key: 'Meta', metaKey: true, bubbles: true })),
    );
    await card(page, 'orders').click();
    await settled(page);
    const [web, orders] = [await card(page, 'web').boundingBox(), await card(page, 'orders').boundingBox()];
    if (!web || !orders) throw new Error('no cards');
    await page.mouse.move(web.x + 40, web.y + 20);
    await page.mouse.down();
    await page.mouse.move(web.x + 40, web.y + 140, { steps: 8 });
    await page.mouse.up();
    expect(Math.abs(((await card(page, 'orders').boundingBox())?.y ?? 0) - orders.y)).toBeLessThan(3);
    const box = await page.locator('.svelte-flow__pane').boundingBox();
    if (!box) throw new Error('no map');
    // Pointed at first, as a person does: the map takes the click once it has caught up with the pointer.
    await page.mouse.move(box.x + box.width / 2, box.y + 20, { steps: 4 });
    await page.waitForTimeout(100);
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
    await settled(page);
    const lean = page.locator('.lean');
    // An area dragged over the map picks the cards in it, from beside the first card across the rest, as a hand drags it:
    // on its way it covers one card alone, and that opens no panel either.
    const pane = await page.locator('.svelte-flow__pane').boundingBox();
    const first = await lean.first().boundingBox();
    if (!pane || !first) throw new Error('no map');
    await page.mouse.move(first.x - 8, first.y - 8);
    await page.mouse.down();
    await page.mouse.move(pane.x + pane.width - 4, pane.y + pane.height - 4, { steps: 40 });
    await page.mouse.up();
    await expect(page.locator('.lean.picked')).toHaveCount(await lean.count());
    // An area picked opens no card's panel.
    await expect(page.locator('aside.panel')).toHaveCount(0);
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
    // Where it was found opens in the editor, in the caller's clone, at its line.
    await expect(calls.getByRole('link', { name: 'Open in editor' })).toHaveAttribute(
      'href',
      `vscode://file${encodeURI(path.join(canvas.dir, 'clones', 'catalog', 'src', 'search.ts'))}:12`,
    );
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

test.describe('Read again', () => {
  test.use({
    stack,
    uncloned: ['search'],
    board: { env: 'qa', mode: 'auto', zoom: 1, pan: { x: 60, y: 60 }, nodes: { web: at(0, 0) }, edges: [] },
  });

  test('reads the code again, from GitHub for a repo not cloned here, and says when it could not', async ({ page }) => {
    await expect(card(page, 'web')).toBeVisible();
    const button = page.getByRole('button', { name: 'Read again' });
    // Only Discover reads the code.
    await expect(button).toHaveCount(0);
    await page.keyboard.press('d');
    await expect(button).toBeVisible();
    // What the server says is what the page says: why it failed, as it is.
    await button.click();
    await expect(page.getByRole('alert').filter({ hasText: 'no stack set yet' })).toBeVisible({ timeout: 30_000 });
    await expect(button).toBeEnabled();
    // Read, but a repo GitHub would not give (koppler sync --github itself is tested in test/github-reads).
    let answer = () => {};
    await page.route('**/read-again?*', async route => {
      await new Promise<void>(done => (answer = done));
      await route.fulfill({ json: { ok: true, unread: 1 } });
    });
    await button.click();
    await expect(page.getByRole('button', { name: 'Reading…' })).toBeDisabled();
    answer();
    await expect(
      page.getByText('1 repo could not be read from GitHub: is gh signed in (gh auth status)?'),
    ).toBeVisible();
    await expect(button).toBeEnabled();
    await expect(card(page, 'web')).toBeVisible();
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

test.describe('a topic nothing reads', () => {
  test.use({
    stack: {
      ...STACK,
      apps: {
        ...STACK.apps,
        web: { ...STACK.apps.web, publishes: { status: {}, events: {} } },
        orders: { ...STACK.apps.orders, reads: { events: {} } },
      },
      queues: {
        status: { name: 'Status topic', type: 'sns' },
        events: { name: 'Order events', type: 'sqs' },
      },
    },
    board: { env: 'qa', mode: 'auto', zoom: 1, pan: { x: 60, y: 60 }, nodes: { web: at(0, 0) }, edges: [] },
  });

  test('is flagged as a dead end, its links stopping at a bar on the side they would leave by', async ({ page }) => {
    await discover(page);
    const status = card(page, 'queue:status');
    await expect(status.locator('.dead')).toHaveText('Dead end · no readers');
    await expect(card(page, 'queue:events').locator('.dead')).toHaveCount(0);
    const side = async () => {
      const [box, stub] = [await status.locator('.lean').boundingBox(), await status.locator('.stub').boundingBox()];
      if (!box || !stub) return '';
      return stub.x >= box.x + box.width - 1 ? 'right' : stub.y >= box.y + box.height - 1 ? 'bottom' : 'inside';
    };
    expect(await side()).toBe('right');
    await page.getByRole('button', { name: 'Arrange', exact: true }).click();
    await expect.poll(side).toBe('bottom');
    const clip = async () => {
      const b = (await status.boundingBox()) ?? { x: 0, y: 0, width: 0, height: 0 };
      return { x: b.x - 30, y: b.y - 30, width: b.width + 60, height: b.height + 60 };
    };
    await page.screenshot({ path: 'test-results/dead-end-down.png', clip: await clip() });
    await page.getByRole('button', { name: 'Arrange', exact: true }).click();
    await expect.poll(side).toBe('right');
    await page.screenshot({ path: 'test-results/dead-end-right.png', clip: await clip() });
    await fromMenu(page, 'Settings', 'Appearance');
    await page.getByRole('radio', { name: /^Paper/ }).click();
    await page.keyboard.press('Escape');
    await page.screenshot({ path: 'test-results/dead-end-paper.png', clip: await clip() });
  });
});

test.describe('a call recorded with nothing on where it comes from', () => {
  test.use({
    stack: {
      ...STACK,
      apps: {
        ...STACK.apps,
        web: { ...STACK.apps.web, consumes: { orders: { how: 'env', env: 'ORDERS_URL' }, catalog: {} } },
      },
    },
    board: { env: 'qa', mode: 'auto', zoom: 1, pan: { x: 60, y: 60 }, nodes: { web: at(0, 0) }, edges: [] },
  });

  test('shows a ? on its link, and the panel says it has no source yet', async ({ page }) => {
    await discover(page);
    await expect(page.locator('.mark.unsourced')).toHaveCount(1);
    // The ? sits on the link to Catalog, between the two cards.
    const [mark, web, catalog] = await Promise.all([
      page.locator('.mark.unsourced rect').boundingBox(),
      card(page, 'web').boundingBox(),
      card(page, 'catalog').boundingBox(),
    ]);
    const between = (v: number, a: number, b: number) => v >= Math.min(a, b) && v <= Math.max(a, b);
    expect(
      !!mark &&
        !!web &&
        !!catalog &&
        between(mark.x + 9, web.x + web.width, catalog.x) &&
        between(mark.y + 9, Math.min(web.y, catalog.y), Math.max(web.y + web.height, catalog.y + catalog.height)),
    ).toBe(true);
    await card(page, 'web').click();
    const panel = page.getByRole('complementary');
    await expect(panel.getByText('No source yet')).toHaveCount(1);
    await settled(page);
    await page.screenshot({ path: 'test-results/discover-no-source.png' });
  });
});

test.describe('an outside system whose links were read from its own repo', () => {
  const call = 'acme/crm-org force-app/main/default/classes/PaymentsService.cls:12';
  const event = 'acme/crm-org force-app/main/default/classes/OrderEvents.cls:30';
  test.use({
    stack: {
      ...STACK,
      apps: {
        ...STACK.apps,
        orders: { ...STACK.apps.orders, reads: { changes: {} } },
        crm: {
          name: 'CRM',
          kind: 'other',
          outside: 'Salesforce org',
          consumes: { payments: { how: 'unknown', found: call } },
          publishes: { changes: { via: event } },
        },
      },
      queues: { changes: { name: 'Order changed event', type: 'eventbridge' } },
    },
    board: {
      env: 'qa',
      mode: 'auto',
      zoom: 1,
      pan: { x: 60, y: 60 },
      nodes: { web: at(0, 0), orders: at(400, 0), payments: at(400, 300) },
      edges: [],
    },
  });

  test('draws its call and its event, each with where it was read', async ({ page }) => {
    await discover(page);
    await expect(page.locator('[data-link="crm>payments>call"]')).toHaveCount(1);
    await expect(page.locator('[data-link="crm>queue:changes>publish"]')).toHaveCount(1);
    await expect(page.locator('.mark.unsourced')).toHaveCount(0);
    await card(page, 'crm').click();
    const panel = page.getByRole('complementary');
    await expect(panel.getByText(call)).toHaveCount(1);
    await expect(panel.getByText(event)).toHaveCount(1);
  });
});

test.describe('a card opened on a busy map', () => {
  test.use({
    stack: {
      ...STACK,
      apps: {
        ...STACK.apps,
        web: {
          ...STACK.apps.web,
          publishes: { receipts: {} },
          consumes: {
            orders: { how: 'env', env: 'ORDERS_URL' },
            catalog: { how: 'env', env: 'CATALOG_URL' },
            refunds: {},
          },
        },
        refunds: { ...STACK.apps.payments, name: 'Refunds', slug: 'acme/refunds', consumes: { payments: {} } },
        mail: { ...STACK.apps.payments, name: 'Mail', slug: 'acme/mail', reads: { receipts: {} } },
      },
      queues: { receipts: { name: 'Receipts', type: 'sqs' } },
    },
    board: { env: 'qa', mode: 'auto', zoom: 1, pan: { x: 60, y: 60 }, nodes: { web: at(0, 0) }, edges: [] },
  });

  test('is laid out with the rest, so no link loops out past the cards', async ({ page }) => {
    await discover(page);
    await page.getByRole('button', { name: 'Show 1 more link of Receipts' }).click();
    await expect(card(page, 'mail')).toBeVisible();
    await settled(page);
    const outside = await page.evaluate(() => {
      const cards = [...document.querySelectorAll('.svelte-flow__node')].map(node => node.getBoundingClientRect());
      const [left, right] = [Math.min(...cards.map(box => box.left)), Math.max(...cards.map(box => box.right))];
      return [...document.querySelectorAll('[data-link] .wire')]
        .filter(wire => {
          const box = wire.getBoundingClientRect();
          return box.left < left - 2 || box.right > right + 2;
        })
        .map(wire => wire.parentElement?.getAttribute('data-link'));
    });
    expect(outside).toEqual([]);
    await page.screenshot({ path: 'test-results/discover-opened-busy.png' });
  });
});

test.describe('a bucket, an API Gateway and a Step Functions the apps use', () => {
  test.use({
    stack: {
      ...STACK,
      apps: {
        ...STACK.apps,
        web: { ...STACK.apps.web, buckets: { receipts: { access: 'write' } } },
        mail: { ...STACK.apps.payments, name: 'Mail', slug: 'acme/mail', buckets: { receipts: { access: 'read' } } },
      },
      resources: {
        receipts: { type: 's3', name: 'Receipts', bucket: 'acme-receipts-qa' },
        api: { type: 'apigw', name: 'Public API', routes: { 'POST /orders': 'web', 'GET /orders': 'web' } },
        refunds: {
          type: 'sfn',
          name: 'Refund flow',
          startedBy: ['web'],
          steps: [{ name: 'Check the refund' }, { name: 'Pay it back', calls: 'payments' }],
        },
      },
    },
    board: { env: 'qa', mode: 'auto', zoom: 1, pan: { x: 60, y: 60 }, nodes: { web: at(0, 0) }, edges: [] },
  });

  test('shows each as a card, says what a bucket link does, and lists routes and steps', async ({ page }) => {
    await discover(page);
    await expect(card(page, 'resource:receipts')).toContainText('Bucket');
    await expect(card(page, 'resource:api')).toContainText('2 routes');
    await expect(card(page, 'resource:refunds')).toContainText('2 steps');
    await expect(page.locator('.mark.label')).toHaveText(['writes']);
    await page.getByRole('button', { name: 'Show 1 more link of Receipts' }).click();
    await expect(page.locator('.mark.label')).toHaveText(['writes', 'reads']);
    await settled(page);
    await page.screenshot({ path: 'test-results/discover-resources.png' });

    const panel = page.getByRole('complementary');
    await card(page, 'resource:api').click();
    await expect(panel.getByRole('heading', { name: 'Routes' })).toBeVisible();
    await expect(panel.getByText('POST /orders, GET /orders')).toBeVisible();

    await card(page, 'resource:refunds').click();
    await expect(panel.getByRole('heading', { name: 'Started by' })).toBeVisible();
    await expect(panel.locator('.step')).toHaveText(['1 Check the refund', '2 Pay it backCalls Payments API']);
    await settled(page);
    await page.screenshot({ path: 'test-results/discover-sfn-panel.png' });
  });
});

test.describe('a Lambda in the repo of another app', () => {
  test.use({
    stack: {
      ...STACK,
      apps: {
        ...STACK.apps,
        orders: { ...STACK.apps.orders, consumes: { ...(STACK.apps.orders?.['consumes'] as object), changes: {} } },
        changes: { name: 'order-changes', kind: 'lambda', slug: 'acme/orders-api' },
      },
    },
    uncloned: ['changes'],
    board: { env: 'qa', mode: 'auto', zoom: 1, pan: { x: 60, y: 60 }, nodes: { orders: at(0, 0) }, edges: [] },
  });

  test('shows the repo above its name, as on every app from that repo, and not on the others', async ({ page }) => {
    await expect(card(page, 'orders')).toBeVisible();
    await page.keyboard.press('d');
    await expect(card(page, 'changes').locator('.repo')).toHaveText('orders-api /');
    await expect(card(page, 'orders').locator('.repo')).toHaveText('orders-api /');
    await expect(card(page, 'payments').locator('.repo')).toHaveCount(0);
    await card(page, 'changes').screenshot({ path: 'test-results/part-card.png' });
  });
});
