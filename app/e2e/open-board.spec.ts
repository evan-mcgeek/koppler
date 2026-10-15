// `koppler canvas --board "<name>"` opens the new canvas on that board.
import { test, expect } from './canvas.ts';

test.use({ start: '#board=browse' });

test('the canvas opens on the board its address names, once', async ({ page }) => {
  await expect(page.getByRole('button', { name: 'Board: Browse' })).toBeVisible();
  await expect(page.locator('.svelte-flow__node-app')).toHaveCount(2);
  await expect(page.locator('.svelte-flow__node-app').filter({ hasText: 'Catalog API' })).toBeVisible();
  expect(new URL(page.url()).hash).toBe('');
});
