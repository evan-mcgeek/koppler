// The side panel as Claude Design drew it: the board picker in the bar, app names that fit, actions on hover, and a
// width you can change.
import type { Page } from '@playwright/test';
import { expect, runningApps, test } from './canvas.ts';

test.use({
  uncloned: ['payments'],
  board: {
    env: 'qa',
    mode: 'auto',
    zoom: 1,
    pan: { x: 0, y: 0 },
    nodes: { web: { x: 0, y: 0, run: 'cli', branch: 'main' }, orders: { x: 420, y: 0, run: 'cli', branch: 'main' } },
    edges: [],
  },
});

const panel = (page: Page) => page.getByRole('complementary');
const edge = (page: Page) => page.getByRole('separator', { name: 'Side panel width' });
const width = async (page: Page) => Math.round((await panel(page).boundingBox())?.width ?? 0);

test('the board picker sits in the bar in every view, and the side panel starts with Apps', async ({ page }) => {
  const bar = page.getByRole('banner');
  await runningApps(page, ['web']);
  await expect(page.getByRole('radio', { name: 'Live' })).toBeEnabled();
  for (const view of ['Plan', 'Live', 'Discover']) {
    await page.getByRole('radio', { name: view }).check({ force: true });
    await expect(bar.getByRole('button', { name: /^Board:/ })).toBeVisible();
  }
  await page.getByRole('radio', { name: 'Run' }).check({ force: true });
  await expect(panel(page).getByRole('button', { name: /^Board:/ })).toHaveCount(0);
  await expect(panel(page).getByRole('heading').first()).toHaveText(/^Apps/);
  // The menu opens under the board's name, with Find a board ready to type in.
  await bar.getByRole('button', { name: /^Board:/ }).click();
  const menu = page.getByRole('dialog', { name: 'Boards' });
  await expect(menu.getByRole('searchbox', { name: 'Find a board' })).toBeFocused();
  expect(Math.round((await menu.boundingBox())?.width ?? 0)).toBe(340);
  await page.screenshot({ path: 'test-results/side-panel-menu.png' });
  // B opens it too, and Find a board narrows it.
  await page.keyboard.press('Escape');
  await page.keyboard.press('b');
  await expect(menu.getByRole('searchbox', { name: 'Find a board' })).toBeFocused();
  await page.keyboard.type('zzz');
  await expect(menu).toContainText('No board is called that.');
});

test('a row: the kind in its column, the name over two lines at most, the state under it', async ({ page }) => {
  const row = (name: string) => panel(page).getByRole('listitem').filter({ hasText: name });
  await expect(panel(page).getByText('On the board · 2')).toBeVisible();
  await expect(panel(page).getByText('Not on the board')).toBeVisible();
  await expect(row('Payments API')).toContainText('Not cloned');
  // At rest, no action takes room from the name.
  await expect(row('Catalog API').getByRole('button', { name: 'Run Catalog API alone' })).toBeHidden();
  await row('Catalog API').hover();
  await expect(row('Catalog API').getByRole('button', { name: 'Run Catalog API alone' })).toBeVisible();
  await expect(row('Catalog API').getByRole('button', { name: 'Add Catalog API to the board' })).toBeVisible();
  await page.screenshot({ path: 'test-results/side-panel-hover.png' });
  // Removing from the stack is behind More, in words, and asks first.
  await expect(panel(page).getByRole('button', { name: /^Remove .* from the stack$/ })).toHaveCount(0);
  await row('Catalog API').getByRole('button', { name: 'More for Catalog API' }).click();
  await page.getByRole('menuitem', { name: 'Remove from the stack…' }).click();
  await expect(page.getByRole('dialog').filter({ hasText: 'Remove Catalog API from the stack?' })).toBeVisible();
});

test('the panel is widened by its edge, kept on this Mac, and put back to 300', async ({ page }) => {
  await expect.poll(() => width(page)).toBe(300);
  await expect(edge(page)).toHaveAttribute('aria-valuenow', '300');
  const line = await edge(page).boundingBox();
  if (!line) throw new Error('no edge');
  const y = line.y + 200;
  const x = line.x + line.width / 2;
  await page.mouse.move(x, y);
  await page.mouse.down();
  await page.mouse.move(x + 100, y, { steps: 8 });
  await expect(page.getByText('400 px')).toBeVisible();
  await page.mouse.up();
  await expect.poll(() => width(page)).toBe(400);
  await expect(page.getByText('400 px')).toBeHidden();
  // Never past 560, nor under 280.
  await page.mouse.move(x + 100, y);
  await page.mouse.down();
  await page.mouse.move(x + 500, y, { steps: 8 });
  await page.mouse.up();
  await expect.poll(() => width(page)).toBe(560);
  // Kept on reload, and when the panel folds and opens again.
  await page.reload();
  await expect.poll(() => width(page)).toBe(560);
  await page.getByRole('button', { name: 'Hide the side pane' }).click();
  await page.getByRole('button', { name: 'Show the side pane' }).click();
  await expect.poll(() => width(page)).toBe(560);
  // From the keyboard: arrows move it, Shift moves it further, Enter puts it back.
  await edge(page).focus();
  await page.keyboard.press('ArrowLeft');
  await expect.poll(() => width(page)).toBe(552);
  await page.keyboard.press('Shift+ArrowLeft');
  await expect.poll(() => width(page)).toBe(512);
  await page.keyboard.press('Enter');
  await expect.poll(() => width(page)).toBe(300);
  await edge(page).dblclick();
  await expect.poll(() => width(page)).toBe(300);
});

test('in a narrower window the widest the panel goes leaves the board 640px', async ({ page }) => {
  await edge(page).focus();
  for (let n = 0; n < 8; n++) await page.keyboard.press('Shift+ArrowRight');
  await expect.poll(() => width(page)).toBe(560);
  await page.setViewportSize({ width: 1110, height: 800 });
  await expect.poll(() => width(page)).toBe(470);
  // The width chosen comes back as the window widens again.
  await page.setViewportSize({ width: 1440, height: 800 });
  await expect.poll(() => width(page)).toBe(560);
});

test('from the keyboard: More opens on its first item, and an app added keeps the focus on its row', async ({
  page,
}) => {
  const row = panel(page).getByRole('listitem').filter({ hasText: 'Catalog API' });
  await row.getByRole('button', { name: /^Catalog API/ }).focus();
  await page.keyboard.press('Tab');
  await page.keyboard.press('Tab');
  await page.keyboard.press('Tab');
  await expect(row.getByRole('button', { name: 'More for Catalog API' })).toBeFocused();
  await page.keyboard.press('Enter');
  const menu = page.getByRole('menu', { name: 'More' });
  await expect(menu.getByRole('menuitem', { name: 'Run alone' })).toBeFocused();
  await page.keyboard.press('ArrowDown');
  await expect(menu.getByRole('menuitem', { name: 'Add to the board' })).toBeFocused();
  await page.keyboard.press('Enter');
  await expect(panel(page).getByRole('list', { name: 'On the board · 3' })).toContainText('Catalog API');
  await expect(panel(page).getByRole('button', { name: /^Catalog API/ })).toBeFocused();
  await page.keyboard.press('ArrowDown');
  await expect(panel(page).getByRole('button', { name: /^Orders API/ })).toBeFocused();
});

test('in a narrow bar the stack is the board menu first row, and Switch stack opens its menu', async ({ page }) => {
  await page.setViewportSize({ width: 1010, height: 800 });
  const bar = page.getByRole('banner');
  await expect(bar.getByRole('button', { name: 'Acme Shop' })).toBeHidden();
  await bar.getByRole('button', { name: /^Board:/ }).click();
  const menu = page.getByRole('dialog', { name: 'Boards' });
  await expect(menu).toContainText('Acme Shop');
  await menu.getByRole('button', { name: 'Switch stack' }).click();
  await expect(page.getByRole('menu', { name: 'Stacks' })).toBeVisible();
  await page.screenshot({ path: 'test-results/side-panel-narrow.png' });
});
