// The new canvas's frame and messages: refused cables, the protected environment, the empty board, the sheets.
import type { Page } from '@playwright/test';
import { at, card, expect, STACK, test } from './canvas.ts';

const cable = (page: Page, id: string) => page.locator(`.svelte-flow__edge[data-id="${id}"]`);
const middle = async (page: Page, id: string) => {
  const box = await card(page, id).boundingBox();
  if (!box) throw new Error('no card');
  return { x: box.x + box.width / 2, y: box.y + box.height / 2 };
};
/** Drags a cable from the bottom port of one card onto another, stopping over it. */
const dragCable = async (page: Page, from: string, to: string) => {
  const start = await middle(page, from);
  await page.mouse.move(start.x, start.y);
  const port = await card(page, from).locator('.port.bottom').boundingBox();
  if (!port) throw new Error('no port');
  await page.mouse.move(port.x + 8, port.y + 8);
  await page.mouse.down();
  const onto = await middle(page, to);
  await page.mouse.move(onto.x, onto.y, { steps: 8 });
};
test.use({
  stack: { ...STACK, protected: ['prod'] },
  board: {
    env: 'qa',
    mode: 'auto',
    zoom: 0.8,
    pan: { x: 80, y: 60 },
    nodes: { web: at(0, 0), orders: at(420, 0), payments: at(840, 0) },
    edges: [{ from: 'web', to: 'orders', fromSide: 'right', toSide: 'left' }],
  },
});
test.beforeEach(async ({ page }) => {
  await expect(card(page, 'web')).toBeVisible();
});

test('a cable against the direction the code shows is refused, and the real one is offered', async ({ page }) => {
  await dragCable(page, 'payments', 'orders');
  await expect(card(page, 'orders').locator('.card')).toHaveClass(/drop-bad/);
  await page.mouse.up();
  await expect(cable(page, 'payments>orders')).toHaveCount(0);
  const refused = page.getByRole('alert');
  await expect(refused).toContainText('In the code Orders API calls Payments API, not the other way round.');
  await refused.getByRole('button', { name: 'Connect that way' }).click();
  await expect(cable(page, 'orders>payments')).toHaveCount(1);
  await expect(refused).toHaveCount(0);
});

test('a cable to an app that answers no calls is refused, and one the stack allows lands with a green hint', async ({
  page,
}) => {
  await dragCable(page, 'orders', 'web');
  await page.mouse.up();
  await expect(page.getByRole('alert')).toContainText('In the code Web Shop calls Orders API');
  await expect(page.getByRole('alert')).toContainText('That cable is already on the board.');
  await page.getByRole('button', { name: 'Dismiss', exact: true }).click();

  await dragCable(page, 'web', 'payments');
  await expect(card(page, 'payments').locator('.card')).toHaveClass(/drop-ok/);
  await page.mouse.up();
  await expect(cable(page, 'web>payments')).toHaveCount(1);
});

test("a cable's plug turns red with it under the pointer", async ({ page }) => {
  const plug = page.locator('.ends .plug[data-cable="web>orders"]');
  await expect(plug).not.toHaveClass(/cut/);
  const wire = await cable(page, 'web>orders')
    .locator('.wire')
    .evaluate(el => {
      const box = el.getBoundingClientRect();
      return { x: box.x + box.width / 2, y: box.y + box.height / 2 };
    });
  await page.mouse.move(wire.x, wire.y);
  await expect(plug).toHaveClass(/cut/);
});

test('a protected environment marks the frame, and an emptied board says how to start', async ({ page }) => {
  await expect(page.getByText('local code runs against real')).toHaveCount(0);
  await page.getByRole('radio', { name: 'PROD' }).check();
  await expect(page.getByRole('alert')).toHaveText('PROD: local code runs against real PROD data and secrets.');
  await expect(page.getByRole('banner')).toHaveClass(/protected/);
  await page.screenshot({ path: 'test-results/next-protected.png' });
  await page.getByRole('button', { name: 'Clear' }).click();
  await page.getByRole('button', { name: 'Clear board' }).click();
  await expect(page.getByText('Click the apps you want to run together.')).toBeVisible();
});

test('the shortcuts sheet opens with ?, and the appearance is picked in Settings and kept', async ({ page }) => {
  const sheet = page.locator('#help');
  await expect(sheet).toBeHidden();
  await page.keyboard.press('?');
  await expect(sheet).toBeVisible();
  await expect(sheet).toContainText('Fit the whole board in view');
  await page.keyboard.press('Escape');
  await expect(sheet).toBeHidden();
  await page.getByRole('button', { name: 'Shortcuts and legend' }).click();
  await expect(sheet).toBeVisible();
  await page.keyboard.press('Escape');

  await page.getByRole('button', { name: 'Settings', exact: true }).click();
  await page.getByRole('radio', { name: /^Scope/ }).click();
  await expect(page.locator('html')).toHaveAttribute('data-scheme', 'scope');
  // A local colour picked by hand stays over the scheme; a scheme picked again drops it.
  await page.getByRole('radio', { name: 'Local #ffd43b' }).click();
  const local = () =>
    page.evaluate(() => getComputedStyle(document.documentElement).getPropertyValue('--local').trim());
  expect(await local()).toBe('#ffd43b');
  await page.reload();
  await expect(page.locator('html')).toHaveAttribute('data-scheme', 'scope');
  expect(await local()).toBe('#ffd43b');
  await page.getByRole('button', { name: 'Settings', exact: true }).click();
  await expect(page.getByRole('radio', { name: /^Scope/ })).toBeChecked();
  await expect(page.getByRole('radio', { name: 'Local #ffd43b' })).toBeChecked();
  await page.screenshot({ path: 'test-results/next-appearance.png' });
  await page.getByRole('button', { name: 'Scheme default' }).click();
  expect(await local()).toBe('#52f29a');
  await page.getByRole('radio', { name: /^Mono/ }).click();
  await expect(page.locator('html')).not.toHaveAttribute('data-scheme');
  expect(await local()).toMatch(/^#f{3}(f{3})?$/);
});

test('the keyboard: Space presses the focused button, and shortcuts stay off under an open menu', async ({ page }) => {
  // Space is the hand tool on the board only: on a button it presses it.
  const live = page.getByRole('radio', { name: 'Live' });
  const percent = page.getByTitle('Reset to 100%');
  await page.getByRole('button', { name: 'Zoom out' }).focus();
  const before = await percent.textContent();
  await page.keyboard.press('Space');
  await expect(percent).not.toHaveText(before ?? '');
  // A letter typed while a menu is open is not a shortcut of the board under it.
  await page.getByRole('button', { name: 'More ways to stop' }).click();
  await expect(page.getByRole('menu', { name: 'More ways to stop' })).toBeVisible();
  await page.keyboard.press('l');
  await expect(live).not.toBeChecked();
  await page.keyboard.press('Escape');
  await page.keyboard.press('l');
  await expect(live).toBeChecked();
});
