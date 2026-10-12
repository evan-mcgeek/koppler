// The new canvas's app card: what the user chooses on it.
import type { Page } from '@playwright/test';
import { test, expect, nextEdit, STACK } from '../canvas.ts';

const card = (page: Page, id: string) => page.locator(`.svelte-flow__node[data-id="${id}"]`);
const at = (x: number, y: number) => ({ x, y, run: 'cli', branch: 'main' });
const mobile = {
  name: 'Mobile App',
  kind: 'flutter',
  slug: 'acme/mobile-app',
  consumes: { orders: { how: 'env', env: 'ORDERS_URL' } },
};
test.use({
  start: 'next/',
  stack: { ...STACK, apps: { ...STACK.apps, mobile } },
  board: {
    env: 'qa',
    mode: 'auto',
    zoom: 1,
    pan: { x: 0, y: 0 },
    nodes: { mobile: at(0, 0), orders: at(420, 0), payments: at(420, 320), catalog: at(0, 320) },
    edges: [{ from: 'orders', to: 'payments', fromSide: 'bottom', toSide: 'top' }],
  },
});

test("a card offers the clone's branches, who starts it, and for a mobile app its platform", async ({ page }) => {
  const branch = card(page, 'orders').getByLabel('Branch');
  await expect(card(page, 'orders').locator('datalist option')).toHaveCount(2);
  await branch.fill('feature/checkout');
  await branch.blur();
  await expect(branch).toHaveValue('feature/checkout');

  await expect(card(page, 'mobile').getByLabel('Platform')).toHaveValue('ios');
  await card(page, 'mobile').getByLabel('Platform').selectOption('android');
  await card(page, 'mobile').getByRole('radio', { name: 'Me' }).check();
  // Started by the user, the device is theirs to pick.
  await expect(card(page, 'mobile').getByLabel('Platform')).toHaveCount(0);
  await expect(card(page, 'orders').getByRole('radio', { name: 'Koppler' })).toBeChecked();
  await page.screenshot({ path: 'test-results/next-card.png' });
});

test('the cables menu adds a cable to an app this one calls, and removes one', async ({ page }) => {
  const menu = card(page, 'orders').getByLabel('Add or remove a cable from Orders API');
  await menu.focus();
  // Orders API calls Payments API (cabled already) and Catalog API.
  await expect(menu.locator('optgroup[label="Call a local app"] option')).toHaveText(['Catalog API']);
  await expect(menu.locator('optgroup[label="Remove the cable to"] option')).toHaveText(['Payments API']);
  await menu.selectOption({ label: 'Catalog API' });
  await expect(page.locator('.svelte-flow__edge[data-id="orders>catalog"]')).toHaveCount(1);
  await menu.focus();
  await menu.selectOption({ label: 'Payments API' });
  await expect(page.locator('.svelte-flow__edge[data-id="orders>payments"]')).toHaveCount(0);
  await expect(page.locator('.svelte-flow__edge')).toHaveCount(1);
});

test('a note for the agent is written on the card, and the card is removed from its corner', async ({ page }) => {
  await card(page, 'catalog').getByRole('button', { name: 'Add a note for the agent' }).click();
  const note = card(page, 'catalog').getByLabel('Note for the agent');
  await note.fill('run with the new pricing flag on');
  await page.getByRole('searchbox').focus();
  await expect(note).toHaveValue('run with the new pricing flag on');
  await expect(card(page, 'catalog').getByRole('button', { name: 'Add a note for the agent' })).toHaveCount(0);

  await card(page, 'payments').getByRole('button', { name: 'Remove Payments API' }).click();
  await expect(card(page, 'payments')).toHaveCount(0);
  await expect(page.locator('.svelte-flow__edge')).toHaveCount(0);
});

test('typing in a card and using its menus does not drag it', async ({ page }) => {
  const before = await card(page, 'orders').boundingBox();
  const menu = await card(page, 'orders').getByLabel('Branch').boundingBox();
  if (!before || !menu) throw new Error('no card');
  await page.mouse.move(menu.x + 40, menu.y + 10);
  await page.mouse.down();
  await page.mouse.move(menu.x + 140, menu.y + 80, { steps: 5 });
  await page.mouse.up();
  expect(await card(page, 'orders').boundingBox()).toEqual(before);
});

test.describe('a clone with uncommitted changes', () => {
  test.use({ dirty: ['orders'] });

  test('another branch asks what happens to them, a typed one too, and the review says it', async ({ page }) => {
    const orders = card(page, 'orders');
    const choice = orders.getByRole('radiogroup', { name: 'Your 3 uncommitted changes on main' });
    await expect(choice).toHaveCount(0);
    // A branch the clone does not list is kept as typed.
    await orders.getByLabel('Branch').fill('fix/not-fetched-yet');
    await orders.getByLabel('Branch').blur();
    await expect(choice.getByRole('radio', { name: 'Set aside' })).toBeChecked();
    await choice.getByRole('radio', { name: 'Take along' }).check();
    await orders.screenshot({ path: 'test-results/next-card-changes.png' });
    await nextEdit(page);
    await page.reload();
    await expect(orders.getByLabel('Branch')).toHaveValue('fix/not-fetched-yet');
    await expect(choice.getByRole('radio', { name: 'Take along' })).toBeChecked();
    await page.getByRole('button', { name: 'Run', exact: true }).click();
    await expect(page.getByRole('dialog')).toContainText(
      'Your 3 uncommitted changes on main: taken along, back on Stop',
    );
  });
});
