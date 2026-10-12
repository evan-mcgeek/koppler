// The new canvas's boards: the one on screen is kept by name, and the team's and the user's own open from the picker.
import type { Page } from '@playwright/test';
import { test, expect, nextEdit } from '../canvas.ts';

const card = (page: Page, id: string) => page.locator(`.svelte-flow__node[data-id="${id}"]`);
const picker = (page: Page) => page.getByRole('button', { name: /^Board: / });
const boards = (page: Page) => page.getByRole('dialog', { name: 'Boards' });
const kept = async (page: Page, url: string) =>
  (await (await page.request.get(`${url}data/state.json`)).json()) as {
    preset?: string | null;
    presets?: { name: string; nodes: Record<string, { branch?: string }>; layout?: { nodes?: object } }[];
  };
test.use({ start: 'next/' });

test('a team board opens arranged, and changing it makes a copy of your own', async ({ page, canvas }) => {
  await expect(picker(page)).toHaveText('New board');
  await picker(page).click();
  await expect(boards(page).getByRole('button')).toHaveText([/Checkout\s*3 apps/, /Browse\s*2 apps/, 'New board']);
  await page.screenshot({ path: 'test-results/next-boards.png' });
  await boards(page)
    .getByRole('button', { name: /Checkout/ })
    .click();
  await expect(picker(page)).toHaveText('Checkout');
  await expect(page.locator('.svelte-flow__node-app')).toHaveCount(3);
  await expect(page.locator('.svelte-flow__edge')).toHaveCount(2);
  // Arranged, not stacked on one spot.
  const spot = async (id: string) => {
    const box = await card(page, id).boundingBox();
    return `${String(Math.round(box?.x ?? 0))},${String(Math.round(box?.y ?? 0))}`;
  };
  await expect
    .poll(async () => new Set([await spot('web'), await spot('orders'), await spot('payments')]).size)
    .toBe(3);
  // And brought into view whole.
  for (const id of ['web', 'orders', 'payments']) await expect(card(page, id)).toBeInViewport({ ratio: 1 });
  await page.screenshot({ path: 'test-results/next-board-opened.png' });
  await nextEdit(page);
  // Opened and untouched, it stays the team's: nothing of the user's own is kept.
  expect((await kept(page, canvas.url)).presets ?? []).toEqual([]);

  await card(page, 'orders').getByLabel('Branch').click();
  await card(page, 'orders').getByLabel('Branch').fill('feature/checkout');
  await card(page, 'orders').getByLabel('Branch').blur();
  await expect(picker(page)).toHaveText('Checkout (local)');
  await expect
    .poll(async () => (await kept(page, canvas.url)).presets?.map(one => one.name))
    .toEqual(['Checkout (local)']);
  const mine = (await kept(page, canvas.url)).presets?.[0];
  expect(mine?.nodes['orders']?.branch).toBe('feature/checkout');
  expect(Object.keys(mine?.layout?.nodes ?? {}).sort()).toEqual(['orders', 'payments', 'web']);
});

test('your own board comes back as you left it, and a new board starts empty', async ({ page, canvas }) => {
  await picker(page).click();
  await boards(page)
    .getByRole('button', { name: /Browse/ })
    .click();
  await expect(page.locator('.svelte-flow__node-app')).toHaveCount(2);
  await page.getByRole('button', { name: 'Add Payments API to the board', exact: true }).first().click();
  await expect(picker(page)).toHaveText('Browse (local)');
  await nextEdit(page);
  const where = await card(page, 'payments').boundingBox();

  await picker(page).click();
  await boards(page).getByRole('button', { name: 'New board' }).click();
  await expect(page.locator('.svelte-flow__node-app')).toHaveCount(0);
  await expect(picker(page)).toHaveText('New board');
  await nextEdit(page);
  // The copy is untouched by the empty board that followed it.
  expect(Object.keys((await kept(page, canvas.url)).presets?.[0]?.nodes ?? {})).toHaveLength(3);

  await picker(page).click();
  await expect(boards(page).getByRole('button')).toHaveText([
    /Checkout/,
    /Browse\s*2 apps/,
    /Browse \(local\)\s*3 apps/,
    'New board',
  ]);
  await boards(page)
    .getByRole('button', { name: /Browse \(local\)/ })
    .click();
  await expect(page.locator('.svelte-flow__node-app')).toHaveCount(3);
  await expect(page.locator('.svelte-flow__edge')).toHaveCount(1);
  // Undo goes back to the empty board, by name too, and leaves the copy alone.
  await page.getByRole('button', { name: 'Undo' }).click();
  await expect(page.locator('.svelte-flow__node-app')).toHaveCount(0);
  await expect(picker(page)).toHaveText('New board');
  await page.getByRole('button', { name: 'Redo' }).click();
  await expect(picker(page)).toHaveText('Browse (local)');
  await expect(card(page, 'payments')).toBeVisible();
  expect(where).not.toBeNull();
});

test.describe('a board with an app that is not cloned here', () => {
  test.use({ uncloned: ['payments'] });

  test('opens with what can run, and says what was left out', async ({ page }) => {
    await picker(page).click();
    await boards(page)
      .getByRole('button', { name: /Checkout/ })
      .click();
    await expect(page.locator('.svelte-flow__node-app')).toHaveCount(2);
    await expect(page.getByRole('status')).toContainText('Opened Checkout, changed to fit');
    await expect(page.getByRole('status')).toContainText('Payments API');
  });
});
