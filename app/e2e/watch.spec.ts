// A card that Koppler starts can be set to restart its app whenever a file in its clone changes; the board keeps it.
import { actions, at, card, expect, saved, test } from './canvas.ts';

test.use({
  board: { env: 'qa', mode: 'auto', zoom: 1, pan: { x: 60, y: 60 }, nodes: { web: at(0, 0) }, edges: [] },
});

test('Auto-restart is switched on a card, kept on the board, and goes along with a run', async ({ page }) => {
  const toggle = (await actions(page, 'web')).getByRole('button', { name: 'Auto-restart for Web Shop' });
  await expect(toggle).toHaveAttribute('aria-pressed', 'false');
  const kept = saved(page);
  await toggle.click();
  await expect(card(page, 'web').getByRole('img', { name: 'Auto-restart' })).toBeVisible();
  expect(
    ((await kept).request().postDataJSON() as { nodes: Record<string, { watch?: boolean }> }).nodes['web']?.watch,
  ).toBe(true);
  await page.screenshot({ path: 'test-results/next-watch.png' });
  await page.reload();
  await expect(card(page, 'web').getByRole('img', { name: 'Auto-restart' })).toBeVisible();
  await expect((await actions(page, 'web')).getByRole('button', { name: 'Auto-restart for Web Shop' })).toHaveAttribute(
    'aria-pressed',
    'true',
  );
  // Started from the IDE, Koppler does not start it, so there is nothing to restart.
  await card(page, 'web').getByRole('radio', { name: 'Me' }).check();
  await expect(card(page, 'web').getByRole('img', { name: 'Auto-restart' })).toHaveCount(0);
});
