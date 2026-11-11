// Areas: one person's choice of the stack's parts, shared by the Apps list and the board menu, and kept on this Mac.
import type { Page } from '@playwright/test';
import { card, expect, overlapping, STACK, test } from './canvas.ts';

const apps = STACK.apps as Record<string, object>;
test.use({
  stack: {
    ...STACK,
    areas: { payments: { name: 'Payments' }, shipping: { name: 'Shipping' } },
    apps: {
      ...apps,
      orders: { ...apps['orders'], areas: ['payments', 'shipping'] },
      payments: { ...apps['payments'], areas: ['payments'] },
      catalog: { ...apps['catalog'], areas: ['shipping'] },
    },
    presets: [...(STACK.presets ?? []), { name: 'Smoke test', version: 1, nodes: { web: { run: 'cli' } }, edges: [] }],
  } as typeof STACK,
  board: {
    env: 'qa',
    mode: 'auto',
    nodes: { web: { x: 0, y: 0, run: 'cli' } },
    edges: [],
  },
});

const panel = (page: Page) => page.getByRole('complementary');
/** Opens the Areas checklist under `where` and picks only one area. */
const only = async (page: Page, where: ReturnType<Page['locator']>, name: string) => {
  await where.getByRole('button', { name: /^Areas:/ }).click();
  const list = page.getByRole('dialog', { name: 'Areas to see' });
  await list.locator('[data-area]').filter({ hasText: name }).hover();
  await list.getByRole('button', { name: 'Only' }).filter({ visible: true }).click();
  await page.keyboard.press('Escape');
};

test('the Apps list shows the chosen areas, then apps in none; an app in two lists once', async ({ page }) => {
  await expect(panel(page).getByRole('button', { name: 'Areas: All' })).toBeVisible();
  await only(page, panel(page), 'Payments');
  await expect(panel(page).getByRole('button', { name: 'Areas: Payments' })).toBeVisible();
  await expect(panel(page).getByRole('heading', { level: 3 })).toHaveText(['Payments', 'No area']);
  const payments = panel(page).getByRole('list', { name: 'Payments' });
  await expect(payments.getByRole('listitem')).toHaveText([/Orders API\s*also Shipping/, /Payments API/]);
  await expect(panel(page)).toContainText('1 app in other areas');
  await expect(panel(page)).toContainText('3 of 4');
  await page.screenshot({ path: 'test-results/areas-apps.png' });
  // Kept on this Mac, and the board menu shows the same choice.
  await page.reload();
  await expect(panel(page).getByRole('button', { name: 'Areas: Payments' })).toBeVisible();
  await page
    .getByRole('banner')
    .getByRole('button', { name: /^Board:/ })
    .click();
  const menu = page.getByRole('dialog', { name: 'Boards' });
  await expect(menu.getByRole('button', { name: 'Areas: Payments' })).toBeVisible();
  await page.keyboard.press('Escape');
  await panel(page).getByRole('button', { name: 'Show all' }).click();
  await expect(panel(page).getByRole('button', { name: 'Areas: All' })).toBeVisible();
  await expect(panel(page)).toContainText('1 of 4 on the board');
});

test('the board menu groups team boards by area, hides the others with a line, and finds a hidden one', async ({
  page,
}) => {
  const bar = page.getByRole('banner');
  await bar.getByRole('button', { name: /^Board:/ }).click();
  const menu = page.getByRole('dialog', { name: 'Boards' });
  await expect(menu.locator('p.sub')).toHaveText(['Team boards · Payments', 'Shipping', 'No area']);
  // Picked in the menu, the menu stays open and regroups at once.
  await only(page, menu, 'Payments');
  await expect(menu.locator('p.sub')).toHaveText(['Team boards · Payments', 'No area']);
  await expect(menu).toContainText('1 team board in Shipping');
  await page.screenshot({ path: 'test-results/areas-menu.png' });
  await menu.getByRole('searchbox', { name: 'Find a board' }).fill('bro');
  await expect(menu.getByText('Hidden by your areas')).toBeVisible();
  await expect(menu).toContainText('Opening it shows it; your areas stay as they are');
  await menu.getByRole('button', { name: /^Browse/ }).click();
  // Opening it leaves the choice alone; the bar says it is outside it.
  await expect(bar.getByRole('button', { name: /^Board: Browse/ })).toContainText('Shipping');
  await expect(panel(page).getByRole('button', { name: 'Areas: Payments' })).toBeVisible();
  await page.screenshot({ path: 'test-results/areas-outside.png' });
});

test('with every area on, unticking one hides only that one', async ({ page }) => {
  await panel(page).getByRole('button', { name: 'Areas: All' }).click();
  const list = page.getByRole('dialog', { name: 'Areas to see' });
  await expect(list.getByRole('checkbox', { name: 'Payments' })).toBeChecked();
  await list.getByRole('checkbox', { name: 'Shipping' }).uncheck();
  await page.keyboard.press('Escape');
  await expect(panel(page).getByRole('button', { name: 'Areas: Payments' })).toBeVisible();
  // Searching within the areas says so.
  await panel(page).getByRole('searchbox').fill('pay');
  await expect(panel(page)).toContainText('Searched within Payments and apps with no area.');
});

/** Every cable on the Discover map that runs through a card other than its two ends. */
const throughCards = (page: Page) =>
  page.evaluate(() => {
    const boxes = [...document.querySelectorAll<HTMLElement>('.svelte-flow__node')].map(node => ({
      id: node.dataset['id'] ?? '',
      box: node.getBoundingClientRect(),
    }));
    return [...document.querySelectorAll<SVGPathElement>('[data-link] .wire')].flatMap(wire => {
      const key = wire.parentElement?.getAttribute('data-link') ?? '';
      const [from, to] = key.split('>');
      const length = wire.getTotalLength();
      const matrix = wire.getScreenCTM() ?? new DOMMatrix();
      for (let at = 0; at <= length; at += 4) {
        const { x, y } = wire.getPointAtLength(at).matrixTransform(matrix);
        const hit = boxes.find(
          ({ id, box }) =>
            id !== from && id !== to && x > box.left + 2 && x < box.right - 2 && y > box.top + 2 && y < box.bottom - 2,
        );
        if (hit) return [`${key} through ${hit.id}`];
      }
      return [];
    });
  });
/** Discover, every card placed and the view still. */
const discover = async (page: Page) => {
  await expect(card(page, 'web')).toBeVisible();
  await page.keyboard.press('d');
  await expect(page.locator('.svelte-flow__node-lean').first()).toBeVisible();
  await expect(page.locator('.svelte-flow__node.unplaced')).toHaveCount(0);
  await expect(page.locator('.map[data-moving]')).toHaveCount(0);
};

test('Discover leaves out the apps outside the areas, and says so on the cards that link to them and under the map', async ({
  page,
}) => {
  await only(page, panel(page), 'Payments');
  await discover(page);
  await expect(card(page, 'orders')).toBeVisible();
  await expect(card(page, 'catalog')).toHaveCount(0);
  await expect(page.locator('[data-link*="catalog"]')).toHaveCount(0);
  // A card does not say its areas: the choice above says which are shown.
  await expect(card(page, 'orders').locator('.areas')).toHaveCount(0);
  // A dashed +N hidden names the links the areas leave out.
  const chip = card(page, 'web').getByRole('button', { name: '1 link of Web Shop hidden by your areas' });
  await expect(chip).toHaveText('+1 hidden');
  await expect(chip).toHaveAttribute('title', 'Not in your areas: Catalog API (Shipping)');
  const strip = page.getByRole('region', { name: 'Hidden by your areas' });
  await expect(strip.locator('.said')).toHaveText(
    'Showing Payments and apps with no area. 1 app in Shipping is hidden.',
  );
  expect(await throughCards(page)).toEqual([]);
  await page.screenshot({ path: 'test-results/areas-discover.png' });
  // The chip opens the Areas checklist.
  await chip.click();
  await expect(page.getByRole('dialog', { name: 'Areas to see' })).toBeVisible();
  await page.keyboard.press('Escape');
  // A picked card's panel still lists its hidden links, muted, with their area.
  await card(page, 'orders').click();
  const side = page.getByRole('complementary', { name: 'Orders API' });
  await expect(side.locator('.item.out')).toHaveText(/Catalog API\s*Shipping/);
  await expect(side.getByRole('button', { name: 'Catalog API' })).toHaveCount(0);
  await side.screenshot({ path: 'test-results/areas-discover-panel.png' });
  // Show all brings them back.
  await strip.getByRole('button', { name: 'Show all' }).click();
  await expect(card(page, 'catalog')).toBeVisible();
  await expect(strip).toHaveCount(0);
  await expect(chip).toHaveCount(0);
  await expect(page.locator('.svelte-flow__node.unplaced')).toHaveCount(0);
  await expect(page.locator('.map[data-moving]')).toHaveCount(0);
  await expect.poll(() => throughCards(page)).toEqual([]);
});

/** Where a card sits on the map itself, whatever the view. */
const onMap = async (page: Page, id: string) => {
  const [, x, y] =
    /translate\((-?[\d.]+)px,\s*(-?[\d.]+)px/.exec((await card(page, id).getAttribute('style')) ?? '') ?? [];
  return { x: Number(x), y: Number(y) };
};

/** Picks only one area in the board menu, as a person in Discover would. */
const onlyInMenu = async (page: Page, name: string) => {
  await page
    .getByRole('banner')
    .getByRole('button', { name: /^Board:/ })
    .click();
  await only(page, page.getByRole('dialog', { name: 'Boards' }), name);
  await page.keyboard.press('Escape');
};

test('an app Show all brings back never lands on a card moved by hand', async ({ page }) => {
  await discover(page);
  const spot = await onMap(page, 'catalog');
  await onlyInMenu(page, 'Payments');
  await expect(card(page, 'catalog')).toHaveCount(0);
  await expect(page.locator('.map[data-moving]')).toHaveCount(0);
  // Orders API, moved by hand to where the layout of every app puts Catalog API.
  const from = await card(page, 'orders').boundingBox();
  const scale = Number(
    /scale\(([\d.]+)\)/.exec((await page.locator('.svelte-flow__viewport').getAttribute('style')) ?? '')?.[1] ?? 1,
  );
  const was = await onMap(page, 'orders');
  if (!from) throw new Error('no Orders API card');
  await page.mouse.move(from.x + 40, from.y + 20);
  await page.mouse.down();
  await page.mouse.move(from.x + 40 + (spot.x - was.x) * scale, from.y + 20 + (spot.y - was.y) * scale, {
    steps: 8,
  });
  await page.mouse.up();
  await expect.poll(async () => Math.abs((await onMap(page, 'orders')).y - spot.y)).toBeLessThan(20);
  await page.getByRole('region', { name: 'Hidden by your areas' }).getByRole('button', { name: 'Show all' }).click();
  await expect(card(page, 'catalog')).toBeVisible();
  await expect(page.locator('.svelte-flow__node.unplaced')).toHaveCount(0);
  await expect(page.locator('.map[data-moving]')).toHaveCount(0);
  expect(await overlapping(page)).toEqual([]);
  await page.screenshot({ path: 'test-results/areas-back-beside.png' });
});

test('Find a card says an app is hidden by your areas, and picking it shows its area too', async ({ page }) => {
  await only(page, panel(page), 'Payments');
  await discover(page);
  await page.keyboard.press('/');
  const finder = page.getByRole('dialog', { name: 'Find a card' });
  await finder.getByRole('searchbox').fill('catalog');
  const option = finder.getByRole('option', { name: /Catalog API/ });
  await expect(option).toContainText('Hidden by your areas · Shipping');
  await option.click();
  await expect(card(page, 'catalog')).toBeVisible();
  await expect(card(page, 'catalog').locator('.lean')).toHaveClass(/picked/);
  await expect(page.getByRole('button', { name: 'Areas: All' })).toHaveCount(0);
  await expect(page.getByRole('region', { name: 'Hidden by your areas' })).toHaveCount(0);
});

test('a picked card the areas hide is picked no more', async ({ page }) => {
  await discover(page);
  await card(page, 'catalog').click();
  await expect(page.getByRole('complementary', { name: 'Catalog API' })).toBeVisible();
  // Narrowed in Plan's Apps list, away from the map.
  await page.keyboard.press('e');
  await only(page, panel(page), 'Payments');
  await page.keyboard.press('d');
  await expect(card(page, 'orders')).toBeVisible();
  await expect(card(page, 'catalog')).toHaveCount(0);
  await expect(page.getByRole('complementary', { name: 'Catalog API' })).toHaveCount(0);
  await expect(page.getByRole('status').filter({ hasText: '1 picked' })).toHaveCount(0);
  await expect(page.locator('.svelte-flow__node.dimmed')).toHaveCount(0);
});

test('a picked card the areas hide on a map laid out down is picked no more', async ({ page }) => {
  await discover(page);
  const layout = () =>
    page.locator('.svelte-flow__node').evaluateAll(all => all.map(one => one.style.transform).join());
  const was = await layout();
  await page.getByRole('button', { name: 'Arrange', exact: true }).click();
  await expect.poll(layout).not.toBe(was);
  await expect(page.locator('.map[data-moving]')).toHaveCount(0);
  // Laid out down: Orders API under Web Shop.
  expect((await onMap(page, 'orders')).y).toBeGreaterThan((await onMap(page, 'web')).y + 64);
  await card(page, 'catalog').click();
  await expect(page.getByRole('complementary', { name: 'Catalog API' })).toBeVisible();
  await onlyInMenu(page, 'Payments');
  await expect(card(page, 'catalog')).toHaveCount(0);
  await expect(page.getByRole('complementary', { name: 'Catalog API' })).toHaveCount(0);
  await expect(page.getByRole('status').filter({ hasText: '1 picked' })).toHaveCount(0);
  await expect(page.locator('.svelte-flow__node.dimmed')).toHaveCount(0);
});

test.describe('a feature board whose steps reach outside the areas', () => {
  test.use({
    board: {
      env: 'qa',
      mode: 'auto',
      nodes: { web: { x: 0, y: 0, run: 'cli' } },
      edges: [],
      feature: {
        request: 'Browse the catalog',
        cards: [],
        phases: [{ name: 'Browse', steps: [{ from: 'web', to: 'catalog', kind: 'call' }] }],
      },
    },
  });

  test("counts no step's app as hidden", async ({ page }) => {
    await only(page, panel(page), 'Payments');
    await discover(page);
    await expect(card(page, 'catalog')).toBeVisible();
    await expect(page.getByRole('region', { name: 'Hidden by your areas' })).toHaveCount(0);
  });
});

test.describe('a board with an app in two areas', () => {
  test.use({
    board: {
      env: 'qa',
      mode: 'auto',
      nodes: { web: { x: 0, y: 0, run: 'cli' }, orders: { x: 420, y: 0, run: 'cli' } },
      edges: [],
    },
  });

  test('a card says its areas in Plan only while the choice narrows', async ({ page }) => {
    await expect(card(page, 'orders')).toBeVisible();
    await expect(card(page, 'orders').locator('.areas')).toHaveCount(0);
    await only(page, panel(page), 'Payments');
    await expect(card(page, 'orders').locator('.areas')).toHaveText('Payments · Shipping');
    await expect(card(page, 'web').locator('.areas')).toHaveCount(0);
    await card(page, 'orders').screenshot({ path: 'test-results/areas-card.png' });
  });
});
