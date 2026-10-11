// The new canvas (canvas/, on Svelte Flow), driven the way a person does: sockets, cables and the keyboard.
import { test, expect, type Locator, type Page } from '@playwright/test';

const card = (page: Page, id: string) => page.locator(`.svelte-flow__node[data-id="${id}"]`);
const cable = (page: Page, id: string) => page.locator(`.svelte-flow__edge[data-id="${id}"]`);
const socket = (page: Page, id: string) => page.locator(`.ends .socket[data-cable="${id}"]`);
const middle = async (of: Locator) => {
  const box = await of.boundingBox();
  if (!box) throw new Error('not on the page');
  return { x: box.x + box.width / 2, y: box.y + box.height / 2, box };
};

test.beforeEach(async ({ page }) => {
  const errors: string[] = [];
  page.on('pageerror', error => errors.push(String(error)));
  await page.goto('http://localhost:4799/');
  await expect(page.locator('.ends .socket')).toHaveCount(5);
  expect(errors).toEqual([]);
});

test('cables entering one side fan out, and sliding a socket past its neighbour swaps them', async ({ page }) => {
  const mine = await middle(socket(page, 'mobile>orders'));
  const other = await middle(socket(page, 'web>orders'));
  expect(mine.y).toBe(other.y);
  expect(mine.x).toBeLessThan(other.x);
  await page.mouse.move(mine.x, mine.y);
  await page.mouse.down();
  await page.mouse.move(mine.x + 12, mine.y, { steps: 3 });
  await page.mouse.move(other.x + 20, other.y, { steps: 6 });
  await page.mouse.up();
  expect((await middle(socket(page, 'mobile>orders'))).x).toBeGreaterThan((await middle(socket(page, 'web>orders'))).x);
  await expect(page.locator('.svelte-flow__edge')).toHaveCount(5);
});

test('pulling an occupied socket away from its side starts a new cable from that port', async ({ page }) => {
  const from = await middle(socket(page, 'web>orders'));
  const onto = await middle(card(page, 'web'));
  await page.mouse.move(from.x, from.y);
  await page.mouse.down();
  await page.mouse.move(from.x, from.y - 30, { steps: 4 });
  await page.mouse.move(onto.x, onto.y, { steps: 8 });
  await page.mouse.up();
  await expect(cable(page, 'orders>web')).toHaveCount(1);
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
  await expect(page.locator('.svelte-flow__edge')).toHaveCount(6);
});

test('the keyboard moves a picked card and removes a picked cable', async ({ page }) => {
  const before = await middle(card(page, 'mobile'));
  await card(page, 'mobile').focus();
  await page.keyboard.press('Enter');
  await page.keyboard.press('ArrowLeft');
  await page.keyboard.press('ArrowLeft');
  expect((await middle(card(page, 'mobile'))).x).toBeLessThan(before.x);
  await cable(page, 'web>catalog').focus();
  await page.keyboard.press('Enter');
  await page.keyboard.press('Backspace');
  await expect(page.locator('.svelte-flow__edge')).toHaveCount(4);
});

test('Arrange places every card, and zoomed out a card shows its short form', async ({ page }) => {
  const before = await middle(card(page, 'orders'));
  await page.getByRole('button', { name: 'Arrange' }).click();
  await expect.poll(async () => (await middle(card(page, 'orders'))).y).not.toBe(before.y);
  await expect(card(page, 'orders').locator('dl')).toBeVisible();
  for (let step = 0; step < 4; step++) await page.locator('.svelte-flow__controls-zoomout').click();
  await expect(card(page, 'orders').locator('.glance')).toBeVisible();
  await expect(card(page, 'orders').locator('dl')).toHaveCount(0);
});
