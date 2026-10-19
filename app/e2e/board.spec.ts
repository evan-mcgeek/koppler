// The new canvas (canvas/, on Svelte Flow), served beside today's and driven the way a person does.
import type { Locator, Page } from '@playwright/test';
import { at, card, expect, test } from './canvas.ts';

const cable = (page: Page, id: string) => page.locator(`.svelte-flow__edge[data-id="${id}"]`);
const socket = (page: Page, id: string) => page.locator(`.ends .socket[data-cable="${id}"]`);
const view = (page: Page) => page.locator('.svelte-flow__viewport').evaluate(el => getComputedStyle(el).transform);
const middle = async (of: Locator) => {
  const box = await of.boundingBox();
  if (!box) throw new Error('not on the page');
  return { x: box.x + box.width / 2, y: box.y + box.height / 2, box };
};

test.use({
  board: {
    env: 'qa',
    mode: 'auto',
    zoom: 1,
    pan: { x: 120, y: 80 },
    nodes: { web: at(0, 0), orders: at(420, 0), catalog: at(210, 280), payments: at(700, 300) },
    edges: [
      { from: 'web', to: 'catalog', fromSide: 'bottom', toSide: 'top' },
      { from: 'orders', to: 'catalog', fromSide: 'bottom', toSide: 'top' },
      { from: 'orders', to: 'payments', fromSide: 'right', toSide: 'top' },
      { from: 'web', to: 'orders', fromSide: 'right', toSide: 'left' },
    ],
  },
});
test.beforeEach(async ({ page }) => {
  await expect(page.locator('.ends .socket')).toHaveCount(4);
});

test('the page shows the stack, its environment and the board the server kept', async ({ page }) => {
  await expect(page.getByRole('banner')).toContainText('Acme Shop');
  await expect(page.getByRole('banner')).toContainText('QA');
  await expect(card(page, 'orders')).toContainText('Orders API');
  await expect(card(page, 'orders')).toContainText('.NET');
  await expect(card(page, 'orders').getByLabel('Branch')).toHaveValue('main');
  await expect(page.locator('.svelte-flow__edge')).toHaveCount(4);
});

test('cables entering one side fan out, and sliding a socket past its neighbour swaps them', async ({ page }) => {
  const mine = await middle(socket(page, 'web>catalog'));
  const other = await middle(socket(page, 'orders>catalog'));
  expect(mine.y).toBe(other.y);
  expect(mine.x).toBeLessThan(other.x);
  await page.mouse.move(mine.x, mine.y);
  await page.mouse.down();
  await page.mouse.move(mine.x + 12, mine.y, { steps: 3 });
  await page.mouse.move(other.x + 20, other.y, { steps: 6 });
  await page.mouse.up();
  expect((await middle(socket(page, 'web>catalog'))).x).toBeGreaterThan(
    (await middle(socket(page, 'orders>catalog'))).x,
  );
  await expect(page.locator('.svelte-flow__edge')).toHaveCount(4);
});

test('pulling an occupied socket away from its side starts a new cable from that port', async ({ page }) => {
  const from = await middle(socket(page, 'orders>catalog'));
  // Catalog API may call Payments API: nothing in the stack says otherwise.
  const onto = await middle(card(page, 'payments'));
  await page.mouse.move(from.x, from.y);
  await page.mouse.down();
  await page.mouse.move(from.x, from.y - 30, { steps: 4 });
  await page.mouse.move(onto.x, onto.y, { steps: 8 });
  await page.mouse.up();
  await expect(cable(page, 'catalog>payments')).toHaveCount(1);
});

test('a cable is drawn through waypoints dropped on the empty board, and Escape cancels one', async ({ page }) => {
  const from = await middle(card(page, 'payments'));
  const onto = await middle(card(page, 'catalog'));
  const below = from.box.y + from.box.height;
  await page.mouse.move(from.x, from.y);
  const port = await middle(card(page, 'payments').locator('.port.bottom'));
  await page.mouse.move(port.x, port.y);
  await page.mouse.down();
  await page.mouse.move(from.x + 60, below + 70, { steps: 5 });
  await page.mouse.up();
  await page.mouse.move(onto.x - 120, below + 90, { steps: 5 });
  await page.mouse.down();
  await page.mouse.up();
  await page.mouse.move(onto.x, onto.y, { steps: 5 });
  await page.mouse.down();
  await page.mouse.up();
  // One curve to each of the two waypoints and one to the socket.
  const drawn = await cable(page, 'payments>catalog').locator('.wire').getAttribute('d');
  expect(drawn?.match(/C/g)).toHaveLength(3);
  // Ending a cable on a card does not pick the card.
  await expect(page.locator('.svelte-flow__node.selected')).toHaveCount(0);

  await page.mouse.move(port.x, port.y);
  await page.mouse.down();
  await page.mouse.move(port.x + 40, port.y + 160, { steps: 4 });
  await page.mouse.up();
  await expect(page.locator('.ends .draft')).toHaveCount(1);
  await page.keyboard.press('Escape');
  await expect(page.locator('.ends .draft')).toHaveCount(0);
  await expect(page.locator('.svelte-flow__edge')).toHaveCount(5);
});

test('a click picks a cable and lights it; the mark in its middle unplugs it', async ({ page }) => {
  const mark = cable(page, 'web>orders').locator('.cut');
  await expect(mark).toBeHidden();
  // This cable runs straight across: the middle of its box is on it.
  const at = await cable(page, 'web>orders')
    .locator('.wire')
    .evaluate(el => {
      const box = el.getBoundingClientRect();
      return { x: box.x + box.width / 2, y: box.y + box.height / 2 };
    });
  await page.mouse.move(at.x, at.y - 60);
  await expect(mark).toBeHidden();
  await expect(cable(page, 'web>orders').locator('title')).toHaveText(
    'Web Shop calls local Orders API. Click to pick it; the × in its middle unplugs it.',
  );
  // A click on the cable away from its middle picks it: it stays, lit, and the cards it does not join fade.
  await page.mouse.click(at.x - 40, at.y);
  await expect(cable(page, 'web>orders')).toHaveClass(/selected/);
  await expect(cable(page, 'web>orders').locator('g').first()).toHaveClass(/\blit\b/);
  await expect(card(page, 'catalog').locator('.card')).toHaveClass(/dimmed/);
  await expect(mark).toBeVisible();
  await page.screenshot({ path: 'test-results/next-cut.png' });
  await mark.click();
  await expect(cable(page, 'web>orders')).toHaveCount(0);
  await expect(page.locator('.svelte-flow__edge')).toHaveCount(3);
});

test('the keyboard moves a picked card and removes a picked cable', async ({ page }) => {
  const before = await middle(card(page, 'web'));
  await card(page, 'web').focus();
  await page.keyboard.press('Enter');
  await page.keyboard.press('ArrowLeft');
  const stepped = await middle(card(page, 'web'));
  expect(stepped.x).toBeLessThan(before.x);
  // With Shift a step is four times as far.
  await page.keyboard.press('Shift+ArrowLeft');
  const far = await middle(card(page, 'web'));
  expect((stepped.x - far.x) / (before.x - stepped.x)).toBeCloseTo(4, 1);
  await cable(page, 'web>orders').focus();
  await page.keyboard.press('Enter');
  await page.keyboard.press('Backspace');
  await expect(page.locator('.svelte-flow__edge')).toHaveCount(3);
});

test('Arrange places every card, and zoomed out a card shows its short form', async ({ page }) => {
  const before = await middle(card(page, 'orders'));
  await page.getByRole('button', { name: 'Arrange' }).click();
  await expect.poll(async () => (await middle(card(page, 'orders'))).y).not.toBe(before.y);
  await expect(card(page, 'orders').locator('.body')).toBeVisible();
  // Arrange fits the view when it is done placing: zoom out only once the view has come to rest.
  await expect
    .poll(async () => {
      const before = await view(page);
      await page.waitForTimeout(150);
      return before === (await view(page));
    })
    .toBe(true);
  await expect(async () => {
    await page.getByRole('button', { name: 'Zoom out' }).click({ timeout: 500 });
    await expect(card(page, 'orders').locator('.glance')).toBeVisible({ timeout: 300 });
  }).toPass();
  await expect(card(page, 'orders').locator('.body')).toHaveCount(0);
});

const centre = (of: Locator) =>
  of.evaluate(el => {
    const box = el.getBoundingClientRect();
    return [box.x + box.width / 2, box.y + box.height / 2];
  });

test('scrolling moves the board, and only a pinch or Ctrl with the wheel zooms it', async ({ page }) => {
  const zoom = page.getByTitle('Reset to 100%');
  const before = { view: await view(page), zoom: await zoom.innerText(), card: await middle(card(page, 'web')) };
  await page.mouse.move(700, 700);
  await page.mouse.wheel(60, 90);
  await expect.poll(() => view(page)).not.toBe(before.view);
  expect(await zoom.innerText()).toBe(before.zoom);
  const moved = await middle(card(page, 'web'));
  expect([Math.round(before.card.x - moved.x), Math.round(before.card.y - moved.y)]).toEqual([60, 90]);
  await page.keyboard.down('Control');
  await page.mouse.wheel(0, 200);
  await page.keyboard.up('Control');
  await expect(zoom).not.toHaveText(before.zoom);
});

test('a pinch over a panel zooms neither the board nor the page', async ({ page }) => {
  const zoom = page.getByTitle('Reset to 100%');
  const before = await zoom.innerText();
  // A trackpad pinch reaches the page as a wheel with Ctrl held; left alone, the browser zooms the whole page.
  await card(page, 'web').hover();
  await expect(page.locator('.svelte-flow__node-toolbar')).toBeVisible();
  for (const where of [
    'aside',
    'header',
    '.svelte-flow__node-toolbar',
    '[aria-label="Board"]',
    '.svelte-flow__minimap',
  ]) {
    const kept = await page
      .locator(where)
      .first()
      .evaluate(el => {
        const pinch = new WheelEvent('wheel', { deltaY: -40, ctrlKey: true, bubbles: true, cancelable: true });
        return el.dispatchEvent(pinch);
      });
    expect(kept, `a pinch over ${where} is the page's to handle`).toBe(false);
  }
  await expect(zoom).toHaveText(before);
});

test('Ctrl held with the wheel over a panel still zooms the page, as the browser does', async ({ page }) => {
  await page.keyboard.down('Control');
  const kept = await page
    .locator('aside')
    .first()
    .evaluate(el =>
      el.dispatchEvent(new WheelEvent('wheel', { deltaY: -40, ctrlKey: true, bubbles: true, cancelable: true })),
    );
  await page.keyboard.up('Control');
  expect(kept, 'the browser zooms the page').toBe(true);
});

test('the Select tool picks the cards in a dragged area, and the Hand tool moves the board', async ({ page }) => {
  await expect(page.getByRole('radio', { name: /^Select/ })).toBeChecked();
  const web = await middle(card(page, 'web'));
  const orders = await middle(card(page, 'orders'));
  await page.mouse.move(web.box.x - 30, web.box.y - 30);
  await page.mouse.down();
  await page.mouse.move(orders.box.x + 40, orders.box.y + 60, { steps: 6 });
  await page.mouse.up();
  await expect(page.locator('.svelte-flow__node-app.selected')).toHaveCount(2);

  await page.keyboard.press('h');
  await expect(page.getByRole('radio', { name: /^Hand/ })).toBeChecked();
  const before = await view(page);
  await page.mouse.move(web.box.x - 30, web.box.y - 30);
  await page.mouse.down();
  await page.mouse.move(web.box.x + 50, web.box.y + 20, { steps: 6 });
  await page.mouse.up();
  expect(await view(page)).not.toBe(before);
  await page.keyboard.press('v');
  await expect(page.getByRole('radio', { name: /^Select/ })).toBeChecked();
});

test("a lone cable's plug sits in the middle of its port's ring", async ({ page }) => {
  const plug = await centre(page.locator('.ends .plug[data-cable="web>orders"]'));
  const ring = await centre(card(page, 'web').locator('.port.right'));
  expect(Math.abs((plug[0] ?? 0) - (ring[0] ?? 9))).toBeLessThan(0.6);
  expect(Math.abs((plug[1] ?? 0) - (ring[1] ?? 9))).toBeLessThan(0.6);
});

for (const old of ['next', 'next/'])
  test.describe(`asked for at ${old}, where it was while it was built`, () => {
    test.use({ start: old });

    test('the canvas opens at its own address', async ({ page }) => {
      await expect(card(page, 'web')).toBeVisible();
      expect(new URL(page.url()).pathname).not.toContain('next');
    });
  });

test.describe('a board taller than the window', () => {
  // Five apps in a chain: fitted to the window, the cards are small enough to switch to their short form.
  const ids = ['one', 'two', 'three', 'four', 'five'];
  const chain = Object.fromEntries(
    ids.map((id, index) => [
      id,
      {
        name: `App ${id}`,
        kind: 'node',
        slug: `acme/${id}`,
        url: `http://localhost:${String(6000 + index)}`,
        ...(ids[index + 1] && { consumes: { [ids[index + 1] ?? '']: { how: 'env', env: 'NEXT_URL' } } }),
      },
    ]),
  );
  test.use({
    stack: { name: 'Tall', envs: ['qa'], apps: chain },
    board: {
      env: 'qa',
      mode: 'auto',
      zoom: 1,
      pan: { x: 0, y: 0 },
      nodes: Object.fromEntries(ids.map((id, index) => [id, at(index * 40, index * 40)])),
      edges: ids.slice(1).map((id, index) => ({ from: ids[index], to: id, fromSide: 'bottom', toSide: 'top' })),
    },
  });

  test('Arrange steps through its layouts when pressed again, and comes back to the first with the same view', async ({
    page,
  }) => {
    const places = () =>
      page
        .locator('.svelte-flow__node-app')
        .evaluateAll(cards =>
          cards.map(card => `${card.getAttribute('data-id') ?? ''} ${(card as HTMLElement).style.transform}`).sort(),
        );
    const settled = async () => {
      await page.getByRole('button', { name: 'Arrange' }).click();
      let last = '';
      await expect
        .poll(async () => {
          const now = (await page.locator('.svelte-flow__viewport').getAttribute('style')) ?? '';
          const same = now === last;
          last = now;
          return same;
        })
        .toBe(true);
      return [last, ...(await places())];
    };
    const first = await settled();
    // Fitted, the cards are in their short form now.
    await expect(page.locator('.card.far').first()).toBeVisible();
    // A chain has two layouts: callers on top, and callers on the left. The button keeps its name.
    const second = await settled();
    expect(second).not.toEqual(first);
    await expect(page.getByRole('button', { name: 'Arrange', exact: true })).toBeVisible();
    expect(await settled()).toEqual(first);
    expect(await settled()).toEqual(second);
    await page.screenshot({ path: 'test-results/next-arrange-right.png' });
  });

  test('the zoom percentage keeps its width, so the toolbar does not shift while zooming', async ({ page }) => {
    const percent = page.getByTitle('Reset to 100%');
    const width = async () => (await percent.boundingBox())?.width;
    await percent.click();
    await expect(percent).toHaveText('100%');
    const wide = await width();
    await page.getByRole('button', { name: 'Zoom out' }).click();
    await expect(percent).toHaveText('83%');
    expect(await width()).toBe(wide);
  });
});

test('cards still move after a system shortcut swallowed the key-ups of Cmd and Shift', async ({ page }) => {
  for (const keys of [['Meta', 'Shift'], ['Shift'], ['Meta']]) {
    // The keys go down, the system takes over (a screenshot), and the page never hears them come up.
    await page.evaluate(down => {
      for (const key of down)
        document.body.dispatchEvent(
          new KeyboardEvent('keydown', {
            key,
            metaKey: down.includes('Meta'),
            shiftKey: key === 'Shift',
            bubbles: true,
          }),
        );
    }, keys);
    for (const id of ['web', 'orders', 'web']) {
      const from = (await middle(card(page, id))).box;
      await page.mouse.move(from.x + 100, from.y + 20);
      await page.mouse.down();
      await page.mouse.move(from.x + 100, from.y + 60, { steps: 6 });
      await page.mouse.up();
      await expect
        .poll(async () => (await middle(card(page, id))).box.y, { message: `${keys.join('+')}: ${id}` })
        .toBeGreaterThan(from.y + 30);
    }
  }
});

test('Cmd or Ctrl and A selects every card, tunnels included, and not while typing', async ({ page }) => {
  await expect(card(page, 'web')).toBeVisible();
  await page.locator('.svelte-flow__pane').click({ position: { x: 20, y: 600 } });
  await page.keyboard.press('ControlOrMeta+a');
  const nodes = page.locator('.svelte-flow__node');
  const count = await nodes.count();
  expect(count).toBeGreaterThan(3);
  await expect(page.locator('.svelte-flow__node.selected')).toHaveCount(count);
  // In a field it selects the field's text, as anywhere else.
  await page.locator('.svelte-flow__pane').click({ position: { x: 20, y: 600 } });
  await expect(page.locator('.svelte-flow__node.selected')).toHaveCount(0);
  await page.getByRole('searchbox', { name: 'Find an app by name or kind' }).fill('web');
  await page.getByRole('searchbox', { name: 'Find an app by name or kind' }).press('ControlOrMeta+a');
  await expect(page.locator('.svelte-flow__node.selected')).toHaveCount(0);
});
