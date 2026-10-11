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
    pan: { x: 0, y: 0 },
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
