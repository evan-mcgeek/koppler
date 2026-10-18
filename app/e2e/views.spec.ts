// The new canvas's two views: Edit sets the board up, Live shows it as it runs, in the same places.
import type { Page } from '@playwright/test';
import { at, card, expect, test } from './canvas.ts';

const corner = async (page: Page, id: string) => {
  const box = await card(page, id).boundingBox();
  return [Math.round(box?.x ?? 0), Math.round(box?.y ?? 0)];
};
test.use({
  board: {
    env: 'qa',
    mode: 'auto',
    zoom: 0.8,
    pan: { x: 80, y: 60 },
    nodes: { web: at(0, 0), orders: at(480, 0) },
    edges: [{ from: 'web', to: 'orders', fromSide: 'right', toSide: 'left' }],
  },
});

test('Live shows the same board in the same places as cards to read, and nothing on it can be changed', async ({
  page,
}) => {
  await expect(card(page, 'web').locator('.body')).toBeVisible();
  const before = [await corner(page, 'web'), await corner(page, 'orders')];
  const middles = await Promise.all(
    ['web', 'orders'].map(async id => {
      const box = await card(page, id).boundingBox();
      return Math.round((box?.y ?? 0) + (box?.height ?? 0) / 2);
    }),
  );
  await page.getByRole('radio', { name: 'Live' }).check();
  await expect(card(page, 'web').locator('.body')).toHaveCount(0);
  await expect(card(page, 'web').locator('.glance')).toContainText('main');
  await expect(card(page, 'web').getByRole('button', { name: 'Remove Web Shop' })).toBeHidden();
  // Short, a card sits in the middle of its full card's room: the cards keep their columns, and their middles
  // keep the same distance up or down from each other, so the cable between them runs the same way.
  const middle = async (id: string) => {
    const box = await card(page, id).boundingBox();
    return Math.round((box?.y ?? 0) + (box?.height ?? 0) / 2);
  };
  expect([(await corner(page, 'web'))[0], (await corner(page, 'orders'))[0]]).toEqual([before[0]?.[0], before[1]?.[0]]);
  expect(
    Math.abs((await middle('orders')) - (await middle('web')) - ((middles[1] ?? 0) - (middles[0] ?? 0))),
  ).toBeLessThanOrEqual(2);
  await page.screenshot({ path: 'test-results/next-live-view.png' });

  // A card does not move, and a cable is not unplugged by a click.
  const inLive = await corner(page, 'web');
  const [x = 0, y = 0] = inLive;
  await page.mouse.move(x + 60, y + 20);
  await page.mouse.down();
  await page.mouse.move(x + 200, y + 120, { steps: 6 });
  await page.mouse.up();
  expect(await corner(page, 'web')).toEqual(inLive);
  const wire = await page
    .locator('.svelte-flow__edge .wire')
    .evaluate(el => [
      el.getBoundingClientRect().x + el.getBoundingClientRect().width / 2,
      el.getBoundingClientRect().y,
    ]);
  await page.mouse.click(wire[0] ?? 0, wire[1] ?? 0);
  await expect(page.locator('.svelte-flow__edge')).toHaveCount(1);

  await page.keyboard.press('e');
  await expect(page.getByRole('radio', { name: 'Edit' })).toBeChecked();
  await expect(card(page, 'web').locator('.body')).toBeVisible();
  expect([await corner(page, 'web'), await corner(page, 'orders')]).toEqual(before);
  await expect(page.getByRole('button', { name: 'Undo' })).toBeDisabled();
  await page.keyboard.press('l');
  await expect(page.getByRole('radio', { name: 'Live' })).toBeChecked();
});

test('Present shows the board alone, and Escape brings the page back', async ({ page }) => {
  const bar = page.getByRole('button', { name: 'Run', exact: true });
  const side = page.getByRole('complementary');
  await expect(bar).toBeVisible();
  await page.getByRole('button', { name: 'Present' }).click();
  await expect(bar).toBeHidden();
  await expect(side).toBeHidden();
  await expect(card(page, 'web')).toBeInViewport({ ratio: 1 });
  await expect(page.getByRole('button', { name: 'Clear' })).toHaveCount(0);
  await page.screenshot({ path: 'test-results/next-present.png' });
  await page.keyboard.press('Escape');
  await expect(bar).toBeVisible();
  await expect(side).toBeVisible();
  await page.keyboard.press('p');
  await expect(bar).toBeHidden();
  await page.getByRole('button', { name: 'Stop presenting' }).click();
  await expect(bar).toBeVisible();
});

test('the toolbar sits at the bottom left and the overview of the board at the bottom right, on one line', async ({
  page,
}) => {
  const map = await page.getByRole('img', { name: 'Overview of the board' }).boundingBox();
  const tools = await page.getByRole('toolbar', { name: 'Board' }).boundingBox();
  if (!map || !tools) throw new Error('not on the page');
  expect(tools.x + tools.width).toBeLessThan(map.x);
  expect(Math.abs(map.y + map.height - (tools.y + tools.height))).toBeLessThan(2);
});
