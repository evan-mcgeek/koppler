// Areas set by hand: a board's area from its row in the board menu, an app's areas in its settings, and the stack's
// areas in their own tab of the stack's settings.
import fs from 'node:fs';
import path from 'node:path';
import type { Page } from '@playwright/test';
import { expect, fromMenu, STACK, test } from './canvas.ts';

const apps = STACK.apps as Record<string, object>;
const SHOP = {
  ...STACK,
  areas: { payments: { name: 'Payments' }, shipping: { name: 'Shipping' } },
  apps: {
    ...apps,
    orders: { ...apps['orders'], areas: ['payments'] },
    payments: { ...apps['payments'], areas: ['payments'] },
    catalog: { ...apps['catalog'], areas: ['shipping'] },
  },
  presets: [
    ...(STACK.presets ?? []),
    {
      name: 'Order emails',
      version: 1,
      nodes: { web: { run: 'cli' }, catalog: { run: 'cli' } },
      edges: [],
      area: 'payments',
    },
  ],
} as typeof STACK;
test.use({
  stack: SHOP,
  board: {
    env: 'qa',
    mode: 'auto',
    nodes: { web: { x: 0, y: 0, run: 'cli' } },
    edges: [],
    presets: [
      { name: 'Refund debugging', version: 1, nodes: { payments: { run: 'cli' }, catalog: { run: 'cli' } }, edges: [] },
    ],
  },
});

type Written = {
  areas?: Record<string, { name: string }>;
  apps: Record<string, { areas?: string[] }>;
  presets: { name: string; area?: string }[];
};
/** The stack file the canvas changes, as `koppler init` sets it up. */
const stackFile = (dir: string) => {
  fs.mkdirSync(path.join(dir, 'stack'), { recursive: true });
  fs.mkdirSync(path.join(dir, 'config'), { recursive: true });
  fs.writeFileSync(path.join(dir, 'stack', 'stack.json'), JSON.stringify(SHOP));
  fs.writeFileSync(path.join(dir, 'config', 'config.json'), JSON.stringify({ stack: path.join(dir, 'stack') }));
  return () => JSON.parse(fs.readFileSync(path.join(dir, 'stack', 'stack.json'), 'utf8')) as Written;
};
const kept = async (page: Page, url: string) =>
  (await (await page.request.get(`${url}data/state.json`)).json()) as { presets?: { name: string; area?: string }[] };
const boardMenu = async (page: Page) => {
  await page
    .getByRole('banner')
    .getByRole('button', { name: /^Board:/ })
    .click();
  return page.getByRole('dialog', { name: 'Boards' });
};
const rowOf = (menu: ReturnType<Page['locator']>, name: string) => menu.locator('.row').filter({ hasText: name });
/** The area heading a board's row sits under. */
const headingOf = (row: ReturnType<Page['locator']>) =>
  row.evaluate(at => {
    let above = at.previousElementSibling;
    while (above && !above.matches('p.sub')) above = above.previousElementSibling;
    return above?.querySelector('span')?.textContent;
  });

test('a board shows only its area; a tie says why in its tooltip, and the row menu sets or clears its area', async ({
  page,
  canvas,
}) => {
  const read = stackFile(canvas.dir);
  let menu = await boardMenu(page);
  // How an area came about is not said in the menu: a board under its area's heading shows nothing more.
  await expect(rowOf(menu, 'Order emails')).not.toContainText('set by hand');
  const mine = rowOf(menu, 'Refund debugging');
  // Your own board sits under its area's heading, as the team's do.
  await expect.poll(() => headingOf(mine)).toBe('Shipping');
  await expect(mine.getByRole('button').first()).toHaveAttribute(
    'title',
    '1 app in Payments, 1 in Shipping. Shipping is smaller',
  );
  await page.screenshot({ path: 'test-results/areas-by-hand.png' });

  // A team board: from the row's menu, for the team, in the stack.
  await rowOf(menu, 'Order emails').hover();
  await rowOf(menu, 'Order emails').getByRole('button', { name: 'More for Order emails' }).click();
  await page.getByRole('menu', { name: 'Order emails' }).getByRole('menuitem', { name: 'Set area…' }).click();
  const setting = menu.getByRole('menu', { name: 'Order emails · area' });
  await expect(menu).toContainText('Team board. Changing it changes it for the team.');
  await expect(setting.getByRole('menuitemradio', { name: 'Payments' })).toBeChecked();
  await expect(setting).toContainText('Shipping: 1 of its 2 apps');
  await page.screenshot({ path: 'test-results/areas-set-area.png' });
  await setting.getByRole('menuitemradio', { name: /Worked out from its apps/ }).click();
  await expect.poll(() => read().presets.find(one => one.name === 'Order emails')?.area).toBeUndefined();
  await expect(menu.locator('p.sub span:first-child')).toHaveText(['Payments', 'Shipping', 'No area']);

  // Right-click a team board, then your own: yours is kept on this Mac.
  await rowOf(menu, 'Checkout').click({ button: 'right' });
  await page.getByRole('menu', { name: 'Checkout' }).getByRole('menuitem', { name: 'Set area…' }).click();
  await menu.getByRole('menu', { name: 'Checkout · area' }).getByRole('menuitemradio', { name: 'Shipping' }).click();
  await expect.poll(() => read().presets.find(one => one.name === 'Checkout')?.area).toBe('shipping');
  await page.keyboard.press('Escape');
  menu = await boardMenu(page);
  await rowOf(menu, 'Refund debugging').click({ button: 'right' });
  await page.getByRole('menu', { name: 'Refund debugging' }).getByRole('menuitem', { name: 'Set area…' }).click();
  await expect(menu).toContainText('Your board, on this Mac.');
  await menu
    .getByRole('menu', { name: 'Refund debugging · area' })
    .getByRole('menuitemradio', { name: 'Payments' })
    .click();
  await expect.poll(() => headingOf(rowOf(menu, 'Refund debugging'))).toBe('Payments');
  await expect
    .poll(async () => (await kept(page, canvas.url)).presets?.find(one => one.name === 'Refund debugging')?.area)
    .toBe('payments');
});

test("an app's areas are values to take out, and a checklist of the stack's areas to add", async ({ page, canvas }) => {
  const read = stackFile(canvas.dir);
  await fromMenu(page, 'Settings', 'Stack settings');
  let panel = page.getByRole('dialog', { name: 'Acme Shop settings' });
  await page.getByRole('tab', { name: 'Apps' }).click();
  await panel.getByRole('listitem').filter({ hasText: 'Orders API' }).getByRole('button', { name: 'Settings' }).click();
  panel = page.getByRole('dialog', { name: 'Orders API' });
  await page.getByRole('tab', { name: 'Identity' }).click();
  const field = panel.getByRole('group', { name: 'Areas' });
  await expect(field.getByRole('listitem')).toHaveText(['Payments']);
  await field.getByRole('button', { name: 'Add an area' }).click();
  const list = field.getByRole('group', { name: "The stack's areas" });
  await expect(list.getByRole('checkbox', { name: 'Payments' })).toBeChecked();
  await list.getByRole('checkbox', { name: 'Shipping' }).check();
  await expect(field.getByRole('listitem')).toHaveText(['Payments', 'Shipping']);
  await expect(list).toContainText('New areas are added in stack settings, Areas');
  await page.screenshot({ path: 'test-results/areas-app-field.png' });
  await field.getByRole('button', { name: 'Remove Payments' }).click();
  await expect(field.getByRole('listitem')).toHaveText(['Shipping']);
  await panel.getByRole('button', { name: 'Save' }).click();
  await expect(panel.getByRole('status')).toHaveText('Saved');
  expect(read().apps['orders']?.areas).toEqual(['shipping']);
  await field.getByRole('button', { name: 'Remove Shipping' }).click();
  await expect(field).toContainText('No area: shows in every area');
  await panel.getByRole('button', { name: 'Save' }).click();
  await expect(panel.getByRole('status')).toHaveText('Saved');
  expect(read().apps['orders']?.areas).toBeUndefined();
});

test("the stack's Areas tab adds, renames, reorders and removes areas, and a removal in use asks first", async ({
  page,
  canvas,
}) => {
  const read = stackFile(canvas.dir);
  await fromMenu(page, 'Settings', 'Stack settings');
  const panel = page.getByRole('dialog', { name: 'Acme Shop settings' });
  await page.getByRole('tab', { name: 'Areas' }).click();
  const table = panel.getByRole('table', { name: 'Areas' });
  const row = (id: string) => table.getByRole('row').filter({ hasText: id });
  await expect(row('payments')).toContainText('2 apps');
  await expect(row('payments')).toContainText('2 boards');
  await expect(row('shipping')).toContainText('1 app');
  await expect(row('shipping')).toContainText('1 board');

  await panel.getByRole('button', { name: 'Add area' }).click();
  const named = panel.getByRole('textbox', { name: 'Name of the new area' });
  await named.fill('Order emails');
  await named.press('Enter');
  await expect(row('order-emails')).toContainText('0 apps');
  await row('payments').getByRole('textbox', { name: 'Name' }).fill('Payments and refunds');
  await row('payments').getByRole('textbox', { name: 'Name' }).press('Tab');
  await row('shipping').getByRole('button', { name: 'Move Shipping' }).dragTo(row('payments'));
  await expect(table.getByRole('row')).toHaveText([/Name/, /shipping/, /payments/, /order-emails/]);
  await page.screenshot({ path: 'test-results/areas-tab.png' });
  await panel.getByRole('button', { name: 'Save' }).click();
  await expect(panel.getByRole('status')).toHaveText('Saved');
  expect(read().areas).toEqual({
    shipping: { name: 'Shipping' },
    payments: { name: 'Payments and refunds' },
    'order-emails': { name: 'Order emails' },
  });
  expect(Object.keys(read().areas ?? {})).toEqual(['shipping', 'payments', 'order-emails']);

  // Removing one in use names what it clears, and keeps it on Keep it.
  await row('payments').getByRole('button', { name: 'Remove' }).click();
  const ask = page.getByRole('alertdialog', { name: 'Remove the Payments and refunds area?' });
  await expect(ask).toContainText('2 apps lose it: Orders API, Payments API.');
  await expect(ask).toContainText('Checkout is worked out from it');
  await expect(ask).toContainText('Order emails is set to it by hand');
  await page.screenshot({ path: 'test-results/areas-remove.png' });
  await ask.getByRole('button', { name: 'Keep it' }).click();
  await expect(row('payments')).toBeVisible();
  await row('payments').getByRole('button', { name: 'Remove' }).click();
  await ask.getByRole('button', { name: 'Remove Payments and refunds' }).click();
  await expect(row('payments')).toHaveCount(0);
  // One not in use goes at once.
  await row('order-emails').getByRole('button', { name: 'Remove' }).click();
  await expect(row('order-emails')).toHaveCount(0);
  await panel.getByRole('button', { name: 'Save' }).click();
  await expect(panel.getByRole('status')).toHaveText('Saved');
  const after = read();
  expect(after.areas).toEqual({ shipping: { name: 'Shipping' } });
  expect(after.apps['orders']?.areas).toBeUndefined();
  expect(after.apps['catalog']?.areas).toEqual(['shipping']);
  expect(after.presets.find(one => one.name === 'Order emails')?.area).toBeUndefined();
});

test("a team board's settings set its area, or take it from its apps", async ({ page, canvas }) => {
  const read = stackFile(canvas.dir);
  await fromMenu(page, 'Settings', 'Stack settings');
  const panel = page.getByRole('dialog', { name: 'Acme Shop settings' });
  await page.getByRole('tab', { name: 'Team boards' }).click();
  const area = panel
    .locator('details')
    .filter({ has: page.locator('summary', { hasText: 'Order emails' }) })
    .getByLabel('Area', { exact: true });
  await expect(area).toHaveValue('payments');
  await expect(area.locator('option')).toHaveText(['Worked out from its apps', 'Payments', 'Shipping']);
  await area.selectOption({ label: 'Worked out from its apps' });
  await panel.getByRole('button', { name: 'Save' }).click();
  await expect(panel.getByRole('status')).toHaveText('Saved');
  expect(read().presets.find(one => one.name === 'Order emails')?.area).toBeUndefined();
});

test("a team board's area goes to that board even when the stack changed on disk since the canvas read it", async ({
  page,
  canvas,
}) => {
  const read = stackFile(canvas.dir);
  const menu = await boardMenu(page);
  await expect(rowOf(menu, 'Order emails')).toBeVisible();
  // A pull puts another team board first: the canvas's copy is now one place off.
  const file = path.join(canvas.dir, 'stack', 'stack.json');
  fs.writeFileSync(
    file,
    JSON.stringify({
      ...SHOP,
      presets: [{ name: 'Sign up', version: 1, nodes: { web: {} }, edges: [] }, ...(SHOP.presets ?? [])],
    }),
  );
  await rowOf(menu, 'Browse').click({ button: 'right' });
  await page.getByRole('menu', { name: 'Browse' }).getByRole('menuitem', { name: 'Set area…' }).click();
  await menu.getByRole('menu', { name: 'Browse · area' }).getByRole('menuitemradio', { name: 'Payments' }).click();
  await expect.poll(() => read().presets.find(one => one.name === 'Browse')?.area).toBe('payments');
  expect(read().presets.find(one => one.name === 'Checkout')?.area).toBeUndefined();
  // One gone from the file is refused with why, and nothing else changes.
  fs.writeFileSync(file, JSON.stringify({ ...SHOP, presets: (SHOP.presets ?? []).filter((_, n) => n !== 0) }));
  await rowOf(menu, 'Checkout').click({ button: 'right' });
  await page.getByRole('menu', { name: 'Checkout' }).getByRole('menuitem', { name: 'Set area…' }).click();
  await menu.getByRole('menu', { name: 'Checkout · area' }).getByRole('menuitemradio', { name: 'Shipping' }).click();
  await expect(page.getByText(/The stack changed: it has no team board called Checkout now/)).toBeVisible();
  expect(read().presets.map(one => one.area)).toEqual([undefined, 'payments']);
});

test("the keyboard moves through a row's menu and the areas without setting one until Enter", async ({
  page,
  canvas,
}) => {
  const read = stackFile(canvas.dir);
  const menu = await boardMenu(page);
  const more = rowOf(menu, 'Order emails').getByRole('button', { name: 'More for Order emails' });
  await rowOf(menu, 'Order emails').hover();
  await more.click();
  const rowMenu = page.getByRole('menu', { name: 'Order emails' });
  await expect(rowMenu.getByRole('menuitem', { name: 'Open' })).toBeFocused();
  await page.keyboard.press('Escape');
  await expect(rowMenu).toBeHidden();
  await expect(more).toBeFocused();
  await page.keyboard.press('Enter');
  await page.keyboard.press('ArrowDown');
  await expect(rowMenu.getByRole('menuitem', { name: 'Set area…' })).toBeFocused();
  await page.keyboard.press('Enter');
  const areas = menu.getByRole('menu', { name: 'Order emails · area' });
  await expect(areas.getByRole('menuitemradio', { name: 'Payments' })).toBeFocused();
  await expect(areas.getByRole('menuitemradio', { name: 'Payments' })).toHaveAttribute('aria-checked', 'true');
  // Arrows only move; Enter sets.
  await page.keyboard.press('ArrowDown');
  await expect(areas.getByRole('menuitemradio', { name: 'Shipping' })).toBeFocused();
  await page.waitForTimeout(300);
  expect(read().presets.find(one => one.name === 'Order emails')?.area).toBe('payments');
  await page.keyboard.press('Enter');
  await expect.poll(() => read().presets.find(one => one.name === 'Order emails')?.area).toBe('shipping');
});

test('a lock in the Areas tab keeps what it covers, and Remove says which lock holds it', async ({ page, canvas }) => {
  stackFile(canvas.dir);
  const lock = (at: string) =>
    page.evaluate(async path => {
      const token = location.pathname.split('/')[2] ?? '';
      await fetch(`/stack-lock?token=${token}`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ path, on: true }),
      });
    }, at);
  await lock('areas.shipping.name');
  await lock('apps.orders.areas');
  await expect
    .poll(
      async () =>
        // Null until the server has written its first status: the poll asks again.
        ((await (await page.request.get(`${canvas.url}data/status.json`)).json()) as { locks?: string[] } | null)
          ?.locks,
    )
    .toEqual(expect.arrayContaining(['areas.shipping.name', 'apps.orders.areas']));
  await fromMenu(page, 'Settings', 'Stack settings');
  const panel = page.getByRole('dialog', { name: 'Acme Shop settings' });
  await page.getByRole('tab', { name: 'Areas' }).click();
  const row = (id: string) => panel.getByRole('table', { name: 'Areas' }).getByRole('row').filter({ hasText: id });
  await expect(row('shipping').getByRole('textbox', { name: 'Name' })).toBeDisabled();
  await expect(row('payments').getByRole('textbox', { name: 'Name' })).toBeEnabled();
  await expect(row('payments').getByRole('button', { name: 'Remove' })).toBeDisabled();
  await expect(row('payments').getByRole('button', { name: 'Remove' })).toHaveAttribute(
    'title',
    "Locked: Orders API's areas",
  );
  // Removing it would take its locked name too.
  await expect(row('shipping').getByRole('button', { name: 'Remove' })).toHaveAttribute(
    'title',
    'Locked: the Shipping area',
  );
  // A lock set elsewhere while the panel is open holds at once, without opening it again.
  await lock('areas');
  await expect(panel.getByRole('button', { name: 'Add area' })).toBeDisabled();
  await expect(row('payments').getByRole('button', { name: 'Move Payments' })).toBeDisabled();
  await expect(row('shipping').getByRole('button', { name: 'Remove' })).toHaveAttribute('title', 'Locked: the areas');
});
