// The new canvas's app card: what the user chooses on it.
import type { Page } from '@playwright/test';
import { test, expect, nextEdit, STACK } from './canvas.ts';

const card = (page: Page, id: string) => page.locator(`.svelte-flow__node[data-id="${id}"]`);
const at = (x: number, y: number) => ({ x, y, run: 'cli', branch: 'main' });
const mobile = {
  name: 'Mobile App',
  kind: 'flutter',
  slug: 'acme/mobile-app',
  consumes: { orders: { how: 'env', env: 'ORDERS_URL' } },
};
test.use({
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
  // The field opens a list of the clone's branches, with the one it is on marked; typing filters it.
  const options = page.getByRole('listbox').locator('.name');
  await branch.click();
  await expect(options).toHaveText(['main', 'feature/checkout']);
  await expect(page.getByRole('option', { name: 'main' })).toContainText('current');
  await branch.pressSequentially('check');
  await expect(options).toHaveText(['feature/checkout']);
  await branch.press('Enter');
  await expect(branch).toHaveValue('feature/checkout');
  await expect(page.getByRole('listbox')).toBeHidden();
  // It opens again on the card's branch.
  await branch.click();
  await expect(page.getByRole('listbox').getByRole('option', { selected: true })).toContainText('feature/checkout');
  await branch.press('Escape');
  // Escape leaves the branch as it was; a name the clone does not list is kept when the field is left.
  await branch.click();
  await branch.pressSequentially('zzz');
  await expect(page.getByRole('listbox')).toContainText('No branch matches. Enter keeps "zzz".');
  await branch.press('Escape');
  await expect(branch).toHaveValue('feature/checkout');
  await branch.click();
  await options.filter({ hasText: 'main' }).click();
  await expect(branch).toHaveValue('main');
  await expect(page.getByRole('listbox')).toBeHidden();
  await branch.fill('not/pushed-yet');
  await branch.blur();
  await expect(branch).toHaveValue('not/pushed-yet');

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

test('a card drags by its fields too, and a field opens on a press that did not move', async ({ page }) => {
  const orders = card(page, 'orders');
  const branch = orders.getByLabel('Branch');
  const before = await orders.boundingBox();
  const field = await branch.boundingBox();
  if (!before || !field) throw new Error('no card');
  await page.mouse.move(field.x + 40, field.y + 10);
  await page.mouse.down();
  // Held back on the press: nothing is focused while it may still become a drag.
  await expect(branch).not.toBeFocused();
  await page.mouse.move(field.x + 140, field.y + 80, { steps: 50 });
  await page.mouse.up();
  // It follows the pointer from where the press became a drag, a few pixels in.
  const after = await orders.boundingBox();
  expect((after?.x ?? 0) - before.x).toBeGreaterThan(90);
  expect((after?.y ?? 0) - before.y).toBeGreaterThan(60);
  await expect(branch).not.toBeFocused();

  await branch.click();
  await expect(branch).toBeFocused();
  await branch.fill('feature/checkout');
  // While it is typed in, a press inside it places the caret and does not move the card.
  const typing = await branch.boundingBox();
  if (!typing) throw new Error('no field');
  await page.mouse.move(typing.x + 20, typing.y + 10);
  await page.mouse.down();
  await page.mouse.move(typing.x + 80, typing.y + 12, { steps: 5 });
  await page.mouse.up();
  expect(await orders.boundingBox()).toEqual(after);
  await expect(branch).toBeFocused();
  // A menu opens on the click as well.
  const cables = orders.getByLabel('Add or remove a cable from Orders API');
  await cables.click();
  await expect(cables).toBeFocused();
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

test.describe('an app that depends on a library cloned here', () => {
  test.use({ libraries: { orders: ['acme-ui', '@acme/kit'] } });

  test('runs with the local copy when its switch is on, and the run says so', async ({ page }) => {
    const orders = card(page, 'orders');
    const kit = orders.getByRole('switch', { name: 'Use the local @acme/kit' });
    await expect(orders.getByRole('switch', { name: 'Use the local acme-ui' })).not.toBeChecked();
    await expect(card(page, 'payments').getByText('Libraries')).toHaveCount(0);
    // A switch is its track and its name: the empty space to the right of them is not part of it.
    const row = await kit.boundingBox();
    const whole = await orders.boundingBox();
    if (row && whole) await page.mouse.click(whole.x + whole.width - 24, row.y + row.height / 2);
    await expect(kit).not.toBeChecked();
    await kit.check();
    await orders.screenshot({ path: 'test-results/next-card-libraries.png' });
    await nextEdit(page);
    await page.reload();
    await expect(kit).toBeChecked();
    await page.getByRole('button', { name: 'Run', exact: true }).click();
    await expect(page.getByRole('dialog')).toContainText('Uses your local @acme/kit');
  });
});

test('the board has an overview that moves the view, and no mark of the library', async ({ page }) => {
  const map = page.getByRole('img', { name: 'Overview of the board' });
  await expect(map).toBeVisible();
  await page.screenshot({ path: 'test-results/next-overview.png' });
  const view = () => page.locator('.svelte-flow__viewport').getAttribute('style');
  const before = await view();
  const box = await map.boundingBox();
  if (!box) throw new Error('no overview');
  await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
  await page.mouse.down();
  await page.mouse.move(box.x + box.width / 2 + 30, box.y + box.height / 2 + 20, { steps: 5 });
  await page.mouse.up();
  expect(await view()).not.toBe(before);
  await expect(page.locator('.svelte-flow__attribution')).toHaveCount(0);
});

test.describe('cards stacked in a column', () => {
  test.use({
    board: {
      env: 'qa',
      mode: 'auto',
      zoom: 1,
      pan: { x: 40, y: 20 },
      nodes: { web: at(0, 0), payments: at(40, 420), orders: at(700, 420) },
      edges: [],
    },
  });

  test('a card that grows pushes the card under it down, and lets it back up when it shrinks', async ({ page }) => {
    const top = async (id: string) => Math.round((await card(page, id).boundingBox())?.y ?? 0);
    const tall = async () => Math.round((await card(page, 'web').boundingBox())?.height ?? 0);
    await expect(card(page, 'payments')).toBeVisible();
    const [under, aside, before] = [await top('payments'), await top('orders'), await tall()];
    await card(page, 'web').getByRole('button', { name: 'Add a note for the agent' }).click();
    await expect.poll(tall).toBeGreaterThan(before);
    const grown = (await tall()) - before;
    await expect.poll(() => top('payments')).toBe(under + grown);
    // A card that is not under it stays.
    expect(await top('orders')).toBe(aside);
    await card(page, 'web').getByLabel('Note for the agent').focus();
    await card(page, 'web').getByLabel('Note for the agent').blur();
    await expect.poll(tall).toBe(before);
    await expect.poll(() => top('payments')).toBe(under);
  });
});
