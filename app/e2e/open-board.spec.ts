// `koppler canvas --board "<name>"` opens the canvas on that board.
import { test, expect } from './canvas.ts';

test.use({ start: '#board=browse' });

test('the canvas opens on the board its address names, once', async ({ page }) => {
  await expect(page.getByRole('button', { name: 'Browse', exact: true })).toBeVisible();
  await expect(page.locator('.node')).toHaveCount(2);
  await expect(page.locator('.node').filter({ hasText: 'Catalog API' })).toBeVisible();
  expect(new URL(page.url()).hash).toBe('');
});
