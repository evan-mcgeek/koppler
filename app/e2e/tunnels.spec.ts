// The new canvas's tunnel cards: the databases and caches the board's apps reach, beside the app that leads them.
import type { Page } from '@playwright/test';
import { actions, at, card, expect, nextEdit, saved, test } from './canvas.ts';

const tunnels = (page: Page) => page.locator('.svelte-flow__node-tunnel');
test.use({
  board: {
    env: 'qa',
    mode: 'auto',
    zoom: 1,
    pan: { x: 120, y: 80 },
    nodes: { web: at(0, 0), orders: at(420, 0) },
    edges: [{ from: 'web', to: 'orders', fromSide: 'right', toSide: 'left' }],
  },
});

test('an app with a tunnel gets its card under it, linked, for the environment of the board', async ({ page }) => {
  await expect(tunnels(page)).toHaveCount(1);
  const tunnel = tunnels(page).first();
  await expect(tunnel).toContainText('Database (Postgres)');
  await expect(tunnel).toContainText('localhost:5432');
  await expect(tunnel).toContainText('db.qa.acme.example');
  await expect(page.locator('.links .link')).toHaveCount(1);
  const app = await card(page, 'orders').boundingBox();
  const under = await tunnel.boundingBox();
  if (!app || !under) throw new Error('not on the page');
  expect(under.x).toBe(app.x);
  expect(Math.round(under.y - (app.y + app.height))).toBe(20);
  await page.screenshot({ path: 'test-results/next-tunnel.png' });

  await page.getByRole('radio', { name: 'PROD' }).check();
  await expect(tunnel).toContainText('db.prod.acme.example');
});

test('a tunnel card moves with its app, and keeps the place it is dragged to', async ({ page }) => {
  const tunnel = tunnels(page).first();
  const before = await tunnel.boundingBox();
  const app = await card(page, 'orders').boundingBox();
  if (!before || !app) throw new Error('not on the page');
  await page.mouse.move(app.x + 80, app.y + 20);
  await page.mouse.down();
  await page.mouse.move(app.x + 180, app.y + 80, { steps: 8 });
  await page.mouse.up();
  const moved = await tunnel.boundingBox();
  const appNow = await card(page, 'orders').boundingBox();
  if (!moved || !appNow) throw new Error('not on the page');
  expect(appNow.x).toBeGreaterThan(app.x + 60);
  // Still under its app, exactly as before.
  expect([moved.x - appNow.x, moved.y - appNow.y]).toEqual([before.x - app.x, before.y - app.y]);

  const kept = saved(page);
  await page.mouse.move(moved.x + 60, moved.y + 12);
  await page.mouse.down();
  await page.mouse.move(moved.x + 260, moved.y + 92, { steps: 8 });
  await page.mouse.up();
  const dragged = await tunnel.boundingBox();
  await kept;
  await page.reload();
  await expect(tunnels(page)).toHaveCount(1);
  expect(await tunnels(page).first().boundingBox()).toEqual(dragged);
});

test('picking the app after its tunnel card drags only the app, with its tunnel card following once', async ({
  page,
}) => {
  const tunnel = tunnels(page).first();
  await tunnel.click({ position: { x: 40, y: 12 } });
  await card(page, 'orders').click({ position: { x: 40, y: 12 } });
  await expect(tunnel).not.toHaveClass(/selected/);
  const before = await tunnel.boundingBox();
  const app = await card(page, 'orders').boundingBox();
  if (!before || !app) throw new Error('not on the page');
  await page.mouse.move(app.x + 40, app.y + 12);
  await page.mouse.down();
  await page.mouse.move(app.x + 140, app.y + 112, { steps: 8 });
  await page.mouse.up();
  await expect(card(page, 'web')).not.toHaveClass(/selected/);
  const moved = await tunnel.boundingBox();
  const appNow = await card(page, 'orders').boundingBox();
  if (!moved || !appNow) throw new Error('not on the page');
  expect([moved.x - appNow.x, moved.y - appNow.y]).toEqual([before.x - app.x, before.y - app.y]);
  await expect(tunnel).not.toHaveClass(/selected/);
});

test('the Tunnels switch on the app, or the cross on the tunnel card, runs the app without it', async ({ page }) => {
  await expect(card(page, 'web').getByText('Tunnels')).toHaveCount(0);
  const tunnelsSwitch = card(page, 'orders').getByRole('switch', { name: "Open Orders API's tunnels" });
  await expect(tunnelsSwitch).toBeChecked();
  await tunnels(page).first().getByRole('button', { name: 'Run without this tunnel' }).click();
  await expect(tunnels(page)).toHaveCount(0);
  await expect(page.locator('.links .link')).toHaveCount(0);
  await expect(tunnelsSwitch).not.toBeChecked();
  await nextEdit(page);
  await tunnelsSwitch.check();
  await expect(tunnels(page)).toHaveCount(1);
  await page.getByRole('button', { name: 'Undo' }).click();
  await expect(tunnels(page)).toHaveCount(0);
});

test('removing the app takes its tunnel card along, and Delete does not remove a tunnel card', async ({ page }) => {
  await tunnels(page).first().click();
  await page.keyboard.press('Delete');
  await expect(tunnels(page)).toHaveCount(1);
  await (await actions(page, 'orders')).getByRole('button', { name: 'Remove Orders API' }).click();
  await expect(tunnels(page)).toHaveCount(0);
});

test('a card added from the panel is the only one selected: what was selected stays where it is', async ({ page }) => {
  const tunnel = tunnels(page).first();
  await tunnel.click({ position: { x: 20, y: 10 } });
  await expect(tunnel).toHaveClass(/selected/);
  await page.getByRole('complementary').getByRole('button', { name: 'Payments API', exact: true }).click();
  const added = card(page, 'payments');
  await expect(added).toBeVisible();
  await expect(tunnel).not.toHaveClass(/selected/);
  const before = await tunnel.boundingBox();
  const box = await added.locator('header').boundingBox();
  if (!before || !box) throw new Error('not on the page');
  await page.mouse.move(box.x + 40, box.y + 10);
  await page.mouse.down();
  await page.mouse.move(box.x + 140, box.y + 110, { steps: 8 });
  await page.mouse.up();
  expect(await tunnel.boundingBox()).toEqual(before);
});

test('another board opens with nothing selected, though it has the same tunnel', async ({ page }) => {
  const tunnel = tunnels(page).first();
  await tunnel.click({ position: { x: 20, y: 10 } });
  await expect(tunnel).toHaveClass(/selected/);
  await page.getByRole('button', { name: /^Board: / }).click();
  await page
    .getByRole('dialog', { name: 'Boards' })
    .getByRole('button', { name: /^Checkout/ })
    .click();
  await expect(page.locator('.svelte-flow__node-app')).toHaveCount(3);
  await expect(tunnels(page)).toHaveCount(1);
  await expect(page.locator('.svelte-flow__node.selected')).toHaveCount(0);
});

test.describe('another board', () => {
  test.use({
    board: {
      env: 'qa',
      mode: 'auto',
      zoom: 1,
      pan: { x: 120, y: 80 },
      nodes: { web: at(0, 0), orders: at(420, 0) },
      edges: [{ from: 'web', to: 'orders', fromSide: 'right', toSide: 'left' }],
      presets: [
        {
          name: 'Orders alone',
          version: 1,
          nodes: { orders: { run: 'cli' } },
          edges: [],
          layout: { nodes: { orders: { x: 1600, y: 1200 } } },
        },
      ],
    },
  });

  test('opened, it puts its tunnel cards beside its own apps, not where the board before had them', async ({
    page,
  }) => {
    await expect(tunnels(page)).toHaveCount(1);
    await page.getByRole('button', { name: /^Board: / }).click();
    await page
      .getByRole('dialog', { name: 'Boards' })
      .getByRole('button', { name: /^Orders alone/ })
      .click();
    await expect(card(page, 'web')).toHaveCount(0);
    await expect
      .poll(async () => {
        const app = await card(page, 'orders').boundingBox();
        const under = await tunnels(page).first().boundingBox();
        return app && under ? [Math.round(under.x - app.x), Math.round(under.y - (app.y + app.height))] : null;
      })
      .toEqual([0, 20]);
  });
});

test.describe('an app whose card grows once its run shows', () => {
  test.use({
    board: { env: 'qa', mode: 'auto', zoom: 1, pan: { x: 120, y: 80 }, nodes: { orders: at(0, 0) }, edges: [] },
  });
  test('gets its tunnel card under it as it is then, never over it', async ({ page }) => {
    const done = [
      { label: 'Tunnels', state: 'done' },
      { label: 'Start', state: 'done' },
    ];
    await page.route('**/data/status.json', async route => {
      // The status comes late, after the cards have their first sizes.
      await new Promise(resolve => setTimeout(resolve, 600));
      await route.fulfill({
        json: { live: { env: 'qa', nodes: { orders: {} } }, apps: { orders: { listening: true, steps: done } } },
      });
    });
    await page.reload();
    const tunnel = tunnels(page).first();
    await expect(card(page, 'orders').locator('.progress')).toBeVisible();
    await page.waitForTimeout(500);
    const app = await card(page, 'orders').boundingBox();
    const below = await tunnel.boundingBox();
    expect((below?.y ?? 0) - ((app?.y ?? 0) + (app?.height ?? 0))).toBeGreaterThanOrEqual(16);
  });
});
