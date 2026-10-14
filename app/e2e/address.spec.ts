// A new address for the canvas: the page moves to it, and the address given out before stops working.
import { expect, test } from './canvas.ts';

test('Settings gives the canvas a new address; the old one no longer opens it', async ({ page, canvas }) => {
  const old = new URL(canvas.url);
  await page.getByRole('button', { name: 'Settings', exact: true }).click();
  await page.getByRole('button', { name: 'New address' }).click();
  await expect(page.getByText('Other open tabs and copied links stop working.')).toBeVisible();
  await page.getByRole('button', { name: 'Get it' }).click();
  await expect.poll(() => new URL(page.url()).pathname).not.toBe(old.pathname);
  await expect(page.getByRole('button', { name: 'Run', exact: true })).toBeVisible();
  expect((await page.request.get(canvas.url)).status()).toBe(404);
  expect((await page.request.get(page.url())).status()).toBe(200);
});
