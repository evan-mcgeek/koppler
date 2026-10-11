// The new canvas (canvas/, on Svelte Flow), served beside today's and driven the way a person does.
import type { Locator, Page } from '@playwright/test';
import { test, expect } from '../canvas.ts';

const card = (page: Page, id: string) => page.locator(`.svelte-flow__node[data-id="${id}"]`);
const cable = (page: Page, id: string) => page.locator(`.svelte-flow__edge[data-id="${id}"]`);
const socket = (page: Page, id: string) => page.locator(`.ends .socket[data-cable="${id}"]`);
const middle = async (of: Locator) => {
  const box = await of.boundingBox();
  if (!box) throw new Error('not on the page');
  return { x: box.x + box.width / 2, y: box.y + box.height / 2, box };
};

const at = (x: number, y: number) => ({ x, y, run: 'cli', branch: 'main' });
test.use({
  start: 'next/',
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
  await expect(card(page, 'orders').getByLabel('Branch').locator('option:checked')).toHaveText('main');
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
  const onto = await middle(card(page, 'web'));
  await page.mouse.move(from.x, from.y);
  await page.mouse.down();
  await page.mouse.move(from.x, from.y - 30, { steps: 4 });
  await page.mouse.move(onto.x, onto.y, { steps: 8 });
  await page.mouse.up();
  await expect(cable(page, 'catalog>web')).toHaveCount(1);
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

test('a cable shows a mark to unplug it under the pointer, and a click unplugs it', async ({ page }) => {
  const mark = cable(page, 'web>orders').locator('.cut');
  await expect(mark).toBeHidden();
  // This cable runs straight across: the middle of its box is on it.
  const at = await cable(page, 'web>orders')
    .locator('.wire')
    .evaluate(el => {
      const box = el.getBoundingClientRect();
      return { x: box.x + box.width / 2, y: box.y + box.height / 2 };
    });
  await page.mouse.move(at.x, at.y);
  await expect(mark).toBeVisible();
  await expect(cable(page, 'web>orders').locator('title')).toHaveText(
    'Web Shop calls local Orders API. Click to unplug.',
  );
  await page.screenshot({ path: 'test-results/next-cut.png' });
  await page.mouse.click(at.x, at.y);
  await expect(cable(page, 'web>orders')).toHaveCount(0);
  await expect(page.locator('.svelte-flow__edge')).toHaveCount(3);
});

test('the keyboard moves a picked card and removes a picked cable', async ({ page }) => {
  const before = await middle(card(page, 'web'));
  await card(page, 'web').focus();
  await page.keyboard.press('Enter');
  await page.keyboard.press('ArrowLeft');
  await page.keyboard.press('ArrowLeft');
  expect((await middle(card(page, 'web'))).x).toBeLessThan(before.x);
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
  // Arrange is still moving the view when the first click lands: zoom out until the short form shows.
  await expect(async () => {
    await page.getByRole('button', { name: 'Zoom out' }).click({ timeout: 500 });
    await expect(card(page, 'orders').locator('.glance')).toBeVisible({ timeout: 300 });
  }).toPass();
  await expect(card(page, 'orders').locator('.body')).toHaveCount(0);
});

const view = (page: Page) => page.locator('.svelte-flow__viewport').evaluate(el => getComputedStyle(el).transform);
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

test('the Select tool picks the cards in a dragged area, and the Hand tool moves the board', async ({ page }) => {
  await expect(page.getByRole('radio', { name: /^Select/ })).toBeChecked();
  const web = await middle(card(page, 'web'));
  const orders = await middle(card(page, 'orders'));
  await page.mouse.move(web.box.x - 30, web.box.y - 30);
  await page.mouse.down();
  await page.mouse.move(orders.box.x + 40, orders.box.y + 60, { steps: 6 });
  await page.mouse.up();
  await expect(page.locator('.svelte-flow__node.selected')).toHaveCount(2);

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
