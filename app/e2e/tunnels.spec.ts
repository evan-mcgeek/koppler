// The new canvas's tunnel cards: the databases and caches the board's apps reach, beside the app that leads them.
import type { Page } from '@playwright/test';
import { test, expect, nextEdit } from './canvas.ts';

const card = (page: Page, id: string) => page.locator(`.svelte-flow__node[data-id="${id}"]`);
const tunnels = (page: Page) => page.locator('.svelte-flow__node-tunnel');
const saved = (page: Page) =>
  page.waitForResponse(r => r.url().includes('/state?') && r.request().method() === 'POST' && r.ok());
const at = (x: number, y: number) => ({ x, y, run: 'cli', branch: 'main' });
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
  await card(page, 'orders').getByRole('button', { name: 'Remove Orders API' }).click();
  await expect(tunnels(page)).toHaveCount(0);
});
