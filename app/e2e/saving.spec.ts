// The new canvas keeps the board: what is changed on it comes back after a reload, from the server's copy.
import type { Page } from '@playwright/test';
import { test, expect } from './canvas.ts';

const card = (page: Page, id: string) => page.locator(`.svelte-flow__node[data-id="${id}"]`);
const saved = (page: Page) =>
  page.waitForResponse(r => r.url().includes('/state?') && r.request().method() === 'POST' && r.ok());
const view = (page: Page) => page.locator('.svelte-flow__viewport').evaluate(el => getComputedStyle(el).transform);
const at = (x: number, y: number) => ({ x, y, run: 'cli', branch: 'main' });
const board = {
  env: 'qa',
  mode: 'auto',
  zoom: 0.8,
  pan: { x: 120, y: 60 },
  nodes: { web: at(0, 0), orders: at(420, 0) },
  edges: [{ from: 'web', to: 'orders', fromSide: 'right', toSide: 'left' }],
  // Not shown by the new canvas yet: it must not lose them.
  presets: [{ name: 'Checkout', version: 1, nodes: { web: { run: 'cli' } }, edges: [] }],
  infra: { 'tunnel:db.qa.acme.example:5432': { x: 40, y: 400 } },
};
test.use({ board });

test('the board opens where it was left, and a moved view is kept', async ({ page }) => {
  await expect(card(page, 'web')).toBeVisible();
  expect(await view(page)).toBe('matrix(0.8, 0, 0, 0.8, 120, 60)');
  const kept = saved(page);
  await page.mouse.move(700, 700);
  await page.mouse.wheel(40, 30);
  await kept;
  await page.reload();
  await expect(card(page, 'web')).toBeVisible();
  expect(await view(page)).toBe('matrix(0.8, 0, 0, 0.8, 80, 30)');
});

test('what is changed on the board comes back after a reload', async ({ page, canvas }) => {
  await card(page, 'orders').getByLabel('Branch').fill('feature/checkout');
  await card(page, 'orders').getByLabel('Branch').blur();
  await card(page, 'orders').getByRole('radio', { name: 'Me' }).check();
  await card(page, 'web').getByRole('button', { name: 'Add a note for the agent' }).click();
  await card(page, 'web').getByLabel('Note for the agent').fill('use the test account');
  await page.getByRole('button', { name: 'Add Catalog API to the board', exact: true }).first().click();
  const menu = card(page, 'web').getByLabel('Add or remove a cable from Web Shop');
  await menu.focus();
  const kept = saved(page);
  await menu.selectOption({ label: 'Catalog API' });
  await kept;
  await page.waitForTimeout(600);

  await page.reload();
  await expect(card(page, 'catalog')).toBeVisible();
  await expect(card(page, 'orders').getByLabel('Branch')).toHaveValue('feature/checkout');
  await expect(card(page, 'orders').getByRole('radio', { name: 'Me' })).toBeChecked();
  await expect(card(page, 'web').getByLabel('Note for the agent')).toHaveValue('use the test account');
  await expect(page.locator('.svelte-flow__edge')).toHaveCount(2);
  await expect(page.locator('.svelte-flow__edge[data-id="web>catalog"]')).toHaveCount(1);

  // The board the user already had is still in the server's copy. The one on screen is kept beside it, under the
  // name it got from its apps when it was first kept.
  const now = (await (await page.request.get(`${canvas.url}data/state.json`)).json()) as typeof board & {
    preset?: string;
  };
  expect(now.presets.map(preset => preset.name)).toEqual(['Checkout', 'Web Shop + 1']);
  expect(now.preset).toBe('Web Shop + 1');
  expect(now.infra).toEqual(board.infra);
});

test('a board that was left with no card in sight is brought back into view', async ({ page }) => {
  const kept = saved(page);
  await page.mouse.move(700, 700);
  await page.mouse.wheel(4000, 4000);
  await kept;
  await expect(card(page, 'web')).not.toBeInViewport();
  await page.reload();
  await expect(card(page, 'web')).toBeInViewport();
});

test('a board that cannot be saved says so', async ({ page }) => {
  await page.route('**/state?**', route => route.abort());
  await card(page, 'web').getByRole('button', { name: 'Remove Web Shop' }).click();
  await expect(page.getByRole('alert')).toContainText('Not saved');
});
