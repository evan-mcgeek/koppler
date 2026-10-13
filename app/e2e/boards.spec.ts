// The new canvas's boards: the one on screen is kept by name, and the team's and the user's own open from the picker.
import type { Page } from '@playwright/test';
import { test, expect, nextEdit } from './canvas.ts';

const card = (page: Page, id: string) => page.locator(`.svelte-flow__node[data-id="${id}"]`);
const picker = (page: Page) => page.getByRole('button', { name: /^Board: / });
const boards = (page: Page) => page.getByRole('dialog', { name: 'Boards' });
/** The boards the menu lists, each by the button that opens it. */
const opens = (page: Page) => boards(page).locator('.row > button:first-child');
const kept = async (page: Page, url: string) =>
  (await (await page.request.get(`${url}data/state.json`)).json()) as {
    preset?: string | null;
    presets?: { name: string; nodes: Record<string, { branch?: string }>; layout?: { nodes?: object } }[];
  };

test('a team board opens arranged, and changing it makes a copy of your own', async ({ page, canvas }) => {
  await expect(picker(page)).toHaveText('New board');
  await picker(page).click();
  await expect(opens(page)).toHaveText([/Checkout\s*3 apps/, /Browse\s*2 apps/]);
  await page.screenshot({ path: 'test-results/next-boards.png' });
  await boards(page)
    .getByRole('button', { name: /^Checkout/ })
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
    .getByRole('button', { name: /^Browse/ })
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
  await expect(opens(page)).toHaveText([/Checkout/, /Browse\s*2 apps/, /Browse \(local\)\s*3 apps/]);
  await boards(page)
    .getByRole('button', { name: /^Browse \(local\)/ })
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
      .getByRole('button', { name: /^Checkout/ })
      .click();
    await expect(page.locator('.svelte-flow__node-app')).toHaveCount(2);
    await expect(page.getByRole('status')).toContainText('Opened Checkout, changed to fit');
    await expect(page.getByRole('status')).toContainText('Payments API');
  });
});

test('a board of your own is renamed, copied, shared, deleted and restored', async ({ page, canvas, context }) => {
  await context.grantPermissions(['clipboard-read', 'clipboard-write']);
  await page.getByRole('button', { name: 'Add Web Shop to the board', exact: true }).first().click();
  await page.getByRole('button', { name: 'Add Orders API to the board', exact: true }).first().click();
  // Named after its apps when it was first kept.
  await expect(picker(page)).toHaveText('Web Shop');

  await picker(page).click();
  const name = boards(page).getByLabel('Name of this board');
  await name.fill('Checkout');
  await boards(page).getByRole('button', { name: 'Rename' }).click();
  await expect(boards(page).getByRole('status')).toHaveText('A board is already called Checkout. Pick another name.');
  await name.fill('Orders work');
  await name.press('Enter');
  await expect(picker(page)).toHaveText('Orders work');

  await picker(page).click();
  await page.screenshot({ path: 'test-results/next-boards-manage.png' });
  await boards(page).getByRole('button', { name: 'Share Orders work' }).click();
  await expect(page.getByRole('status').filter({ hasText: 'Copied' })).toBeVisible();
  const shared = JSON.parse(await page.evaluate(() => navigator.clipboard.readText())) as Record<string, unknown>;
  expect(Object.keys(shared)).toEqual(['name', 'version', 'nodes', 'edges']);
  expect(shared['name']).toBe('Orders work');

  await boards(page).getByRole('button', { name: 'Duplicate' }).click();
  await expect(picker(page)).toHaveText('Orders work copy');
  await picker(page).click();
  await boards(page).getByRole('button', { name: 'Delete Orders work copy' }).click();
  const ask = page.getByRole('dialog').filter({ hasText: 'Delete board' });
  await expect(ask).toContainText('2 apps and 0 cables');
  await expect(ask).toContainText('It is the board on screen, so the screen empties.');
  await ask.getByRole('button', { name: 'Delete board' }).click();
  await expect(page.locator('.svelte-flow__node-app')).toHaveCount(0);
  await expect(picker(page)).toHaveText('New board');

  // The empty board offers the boards; the deleted one waits to be restored.
  const offered = page.getByRole('list', { name: 'Or open a board' }).getByRole('button');
  await expect(offered).toHaveText([/Checkout\s*Team board/, /Browse\s*Team board/, /Orders work\s*Your board/]);
  await page.screenshot({ path: 'test-results/next-boards-empty.png' });
  await picker(page).click();
  await boards(page).getByText('Recently deleted (1)').click();
  await boards(page).getByRole('button', { name: 'Restore Orders work copy' }).click();
  await expect(page.locator('.svelte-flow__node-app')).toHaveCount(2);
  await nextEdit(page);
  const now = await kept(page, canvas.url);
  expect(now.presets?.map(one => one.name)).toEqual(['Orders work', 'Orders work copy']);
  expect(now.preset).toBe('Orders work copy');
});

test('a board opens from a file dropped on the page, and from a link the server fetches', async ({ page }) => {
  const preset = {
    name: 'From a file',
    version: 1,
    nodes: { catalog: { run: 'cli' }, web: { run: 'cli' } },
    edges: [{ from: 'web', to: 'catalog' }],
  };
  const data = await page.evaluateHandle(text => {
    const transfer = new DataTransfer();
    transfer.items.add(new File([text], 'board.json', { type: 'application/json' }));
    return transfer;
  }, JSON.stringify(preset));
  await page.dispatchEvent('body', 'dragenter', { dataTransfer: data });
  await expect(page.getByText('Drop to open this board')).toBeVisible();
  await page.dispatchEvent('body', 'drop', { dataTransfer: data });
  await expect(picker(page)).toHaveText('From a file');
  await expect(page.locator('.svelte-flow__node-app')).toHaveCount(2);
  await expect(page.locator('.svelte-flow__edge')).toHaveCount(1);

  await page.route('**/preset?*', async route => {
    const { url } = route.request().postDataJSON() as { url: string };
    if (url.endsWith('missing.json'))
      await route.fulfill({ status: 400, json: { error: 'That link has no board file.' } });
    else await route.fulfill({ json: { presets: [{ ...preset, name: 'From a link' }] } });
  });
  await picker(page).click();
  const link = boards(page).getByLabel('Open a board from a link');
  await link.fill('https://github.com/acme/stack/blob/main/missing.json');
  await link.press('Enter');
  await expect(boards(page).getByRole('status')).toHaveText('That link has no board file.');
  await link.fill('https://github.com/acme/stack/blob/main/board.json');
  await boards(page).getByRole('button', { name: 'Open', exact: true }).click();
  await expect(picker(page)).toHaveText('From a link');
});

test('Arrange leaves no card on top of another', async ({ page }) => {
  await picker(page).click();
  await boards(page)
    .getByRole('button', { name: /^Checkout/ })
    .click();
  await page.getByRole('button', { name: 'Add Catalog API to the board', exact: true }).first().click();
  const cards = page.locator('.svelte-flow__node-app');
  await expect(cards).toHaveCount(4);
  await page.getByRole('button', { name: 'Arrange', exact: true }).click();
  const overlapping = () =>
    cards.evaluateAll(els => {
      const r = els.map(el => el.getBoundingClientRect());
      return r.flatMap((a, i) =>
        r.slice(i + 1).filter(b => a.left < b.right && b.left < a.right && a.top < b.bottom && b.top < a.bottom),
      ).length;
    });
  await expect.poll(overlapping).toBe(0);
});
