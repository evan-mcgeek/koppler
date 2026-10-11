// Boards: opening one, changing it, and finding it again as it was left.
import type { Page } from '@playwright/test';
import { test, expect, nextEdit } from './canvas.ts';

const card = (page: Page, name: string) => page.getByRole('group', { name: new RegExp(`^${name},`) });
const cards = (page: Page) => page.getByRole('main').getByRole('group', { name: /Arrow keys move it/ });
const boxes = async (page: Page) =>
  Object.fromEntries(
    await cards(page).evaluateAll(els =>
      els.map(el => {
        const r = el.getBoundingClientRect();
        return [(el.getAttribute('aria-label') ?? '').split(',')[0], [Math.round(r.x), Math.round(r.y)]];
      }),
    ),
  ) as Record<string, [number, number]>;
const saved = (page: Page) =>
  page.waitForResponse(r => r.url().includes('/state?') && r.request().method() === 'POST' && r.ok());

test('an empty board offers the team boards, and opening one puts its apps and tunnel on it', async ({ page }) => {
  await expect(page.getByText('Apps 0 of 4 on the board')).toBeVisible();
  const offered = page.getByRole('list', { name: 'Recently opened boards' }).getByRole('button');
  await expect(offered).toHaveText([/Checkout/, /Browse/]);
  await offered.filter({ hasText: 'Checkout' }).click();
  await expect(cards(page)).toHaveCount(3);
  for (const name of ['Web Shop', 'Orders API', 'Payments API']) await expect(card(page, name)).toBeVisible();
  await expect(page.getByText('db.qa.acme.example')).toBeVisible();
  await expect(page.getByText('Apps 3 of 4 on the board')).toBeVisible();
});

test('an app can be added, removed, and brought back with undo', async ({ page }) => {
  await page.getByRole('button', { name: 'Add Catalog API to the board' }).click();
  await expect(card(page, 'Catalog API')).toBeVisible();
  await nextEdit(page);
  await page.getByRole('button', { name: 'Remove Catalog API', exact: true }).click();
  await expect(cards(page)).toHaveCount(0);
  await page.getByRole('button', { name: 'Undo' }).click();
  await expect(card(page, 'Catalog API')).toBeVisible();
});

test('a board comes back after a reload where it was arranged', async ({ page }) => {
  await page.getByRole('button', { name: /^Checkout/ }).click();
  await expect(cards(page)).toHaveCount(3);
  const stored = saved(page);
  await page.getByRole('button', { name: 'Arrange' }).click();
  await stored;
  await expect.poll(async () => JSON.stringify(await boxes(page)) === JSON.stringify(await boxes(page))).toBe(true);
  const before = await boxes(page),
    zoom = await page.getByRole('group', { name: 'Zoom' }).innerText();
  await page.reload();
  await expect(cards(page)).toHaveCount(3);
  // Positions are stored as whole numbers, so a card may sit a pixel off.
  const moved = async () => {
    const now = await boxes(page);
    return Math.max(
      ...Object.keys(before).flatMap(k => [0, 1].map(i => Math.abs((now[k]?.[i] ?? 1e6) - (before[k]?.[i] ?? 0)))),
    );
  };
  await expect.poll(moved).toBeLessThanOrEqual(1);
  expect(await page.getByRole('group', { name: 'Zoom' }).innerText()).toBe(zoom);
});

test('Arrange leaves no card on top of another', async ({ page }) => {
  await page.getByRole('button', { name: /^Checkout/ }).click();
  await page.getByRole('button', { name: 'Add Catalog API to the board' }).click();
  await expect(cards(page)).toHaveCount(4);
  await page.getByRole('button', { name: 'Arrange' }).click();
  const overlapping = () =>
    cards(page).evaluateAll(els => {
      const r = els.map(el => el.getBoundingClientRect());
      return r.flatMap((a, i) =>
        r.slice(i + 1).filter(b => a.left < b.right && b.left < a.right && a.top < b.bottom && b.top < a.bottom),
      ).length;
    });
  await expect.poll(overlapping).toBe(0);
});

test.describe('with boards opened before', () => {
  test.use({
    board: {
      env: 'qa',
      mode: 'auto',
      nodes: {},
      edges: [],
      zoom: 1,
      pan: { x: 0, y: 0 },
      recent: [
        { name: 'Browse', at: '2026-01-02T10:00:00.000Z' },
        { name: 'Checkout', at: '2026-01-01T10:00:00.000Z' },
      ],
    },
  });
  test('the empty board lists them by most recently opened', async ({ page }) => {
    const offered = page.getByRole('list', { name: 'Recently opened boards' }).getByRole('button');
    await expect(offered).toHaveText([/Browse/, /Checkout/]);
  });
});
