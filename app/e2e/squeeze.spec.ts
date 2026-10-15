// Zoomed out the cards are short: the room only their full form needs is closed up on screen, and nothing is moved.
import type { Page } from '@playwright/test';
import { card, expect, test } from './canvas.ts';

const at = (x: number, y: number, full?: number) => ({ x, y, run: 'cli', branch: 'main', ...(full && { full }) });
const box = async (page: Page, id: string) => {
  const got = await card(page, id).boundingBox();
  if (!got) throw new Error(`${id} is not on the page`);
  return got;
};
const board = (zoom: number) => ({
  env: 'qa',
  mode: 'auto',
  zoom,
  pan: { x: 120, y: 80 },
  nodes: { web: at(0, 0, 420), payments: at(0, 520), catalog: at(500, 0, 300) },
  edges: [{ from: 'web', to: 'payments', fromSide: 'bottom', toSide: 'top' }],
});

test.describe('zoomed out', () => {
  test.use({ board: board(0.4) });

  test('a row sits the usual gap under the short cards, and a card dropped there stays where it was let go', async ({
    page,
  }) => {
    await expect(card(page, 'payments')).toBeVisible();
    // Kept 100 under the full card (420 tall): drawn 100 under the short one, at 40%, once the short cards settle.
    const gap = async () => {
      const [web, below] = [await box(page, 'web'), await box(page, 'payments')];
      return Math.round(below.y - (web.y + web.height));
    };
    await expect.poll(gap).toBe(40);
    const payments = await box(page, 'payments');
    await page.screenshot({ path: 'test-results/next-squeezed.png' });

    await page.mouse.move(payments.x + 30, payments.y + 10);
    await page.mouse.down();
    await page.mouse.move(payments.x + 30, payments.y + 70, { steps: 10 });
    const held = await box(page, 'payments');
    await page.mouse.up();
    await expect.poll(async () => Math.round((await box(page, 'payments')).y)).toBe(Math.round(held.y));
  });
});

test.describe('in full', () => {
  test.use({ board: board(1) });

  test('nothing is closed up, and each card is kept with its full height', async ({ page, canvas }) => {
    await expect(card(page, 'payments')).toBeVisible();
    expect(Math.round((await box(page, 'payments')).y - (await box(page, 'web')).y)).toBe(520);
    await expect
      .poll(async () => {
        const kept = (await (await page.request.get(`${canvas.url}data/state.json`)).json()) as {
          nodes: Record<string, { full?: number }>;
        };
        return typeof kept.nodes['payments']?.full;
      })
      .toBe('number');
  });
});

test.describe('in Live', () => {
  test.use({
    board: {
      env: 'qa',
      mode: 'auto',
      zoom: 1,
      pan: { x: 120, y: 80 },
      nodes: { web: at(0, 0), orders: at(0, 500), payments: at(500, 500), catalog: at(0, 1000) },
      edges: [
        { from: 'web', to: 'orders', fromSide: 'bottom', toSide: 'top' },
        { from: 'orders', to: 'payments', fromSide: 'right', toSide: 'left' },
        { from: 'orders', to: 'catalog', fromSide: 'bottom', toSide: 'top' },
      ],
    },
  });

  test('Arrange leaves room between the cards', async ({ page }) => {
    await expect(card(page, 'catalog')).toBeVisible();
    await page.getByRole('radio', { name: 'Live' }).check();
    await page.getByRole('button', { name: 'Arrange' }).click();
    await page.waitForTimeout(800);
    const boxes = await Promise.all(['web', 'orders', 'payments', 'catalog'].map(id => box(page, id)));
    for (const [i, a] of boxes.entries())
      for (const b of boxes.slice(i + 1))
        expect(
          a.x + a.width + 20 <= b.x ||
            b.x + b.width + 20 <= a.x ||
            a.y + a.height + 20 <= b.y ||
            b.y + b.height + 20 <= a.y,
          `${JSON.stringify(a)} and ${JSON.stringify(b)} touch`,
        ).toBe(true);
    await page.screenshot({ path: 'test-results/next-live-arranged.png' });
  });
});
