// Cables: where their ends sit on the cards they join.
import type { Page } from '@playwright/test';
import { test, expect } from './canvas.ts';

const card = (page: Page, name: string) => page.getByRole('group', { name: new RegExp(`^${name},`) });
/** How far along its card each end of the one cable sits, in pixels from the card's left edge. */
const ends = async (page: Page) => {
  const left = async (name: string) => (await card(page, name).boundingBox())?.x ?? 0;
  const middle = async (end: string) => {
    const box = await page.locator(`#ends .${end}`).boundingBox();
    return (box?.x ?? 0) + (box?.width ?? 0) / 2;
  };
  return [
    Math.round((await middle('plug')) - (await left('Web Shop'))),
    Math.round((await middle('socket')) - (await left('Orders API'))),
  ];
};

test.describe('a card joined to one below it that sits off to the side', () => {
  test.use({
    board: {
      env: 'qa',
      mode: 'auto',
      zoom: 1,
      pan: { x: 0, y: 0 },
      nodes: {
        web: { x: 200, y: 80, run: 'cli', branch: 'main' },
        orders: { x: 330, y: 520, run: 'cli', branch: 'main' },
      },
      edges: [{ from: 'web', to: 'orders', fromSide: 'bottom', toSide: 'top' }],
    },
  });

  const drag = async (page: Page) => {
    const box = await card(page, 'Web Shop').boundingBox();
    if (!box) throw new Error('no card');
    await page.mouse.move(box.x + 80, box.y + 20);
    await page.mouse.down();
    await page.mouse.move(box.x + 170, box.y + 20, { steps: 6 });
    await page.mouse.up();
    expect((await card(page, 'Web Shop').boundingBox())?.x).toBeGreaterThan(box.x + 60);
  };

  test('dragging a card leaves the ends of its cable where they are on their cards', async ({ page }) => {
    await expect(page.locator('#ends .plug')).toBeVisible();
    const before = await ends(page);
    await drag(page);
    expect(await ends(page)).toEqual(before);
  });

  test('after Arrange too, dragging a card leaves the ends where Arrange put them', async ({ page }) => {
    await page.getByRole('button', { name: 'Arrange', exact: true }).click();
    await expect(page.locator('#ends .plug')).toBeVisible();
    await page.waitForTimeout(600);
    const before = await ends(page);
    await drag(page);
    expect(await ends(page)).toEqual(before);
  });
});
