// The board's toolbar stays one row, whatever room the panels beside the board leave it.
import { at, expect, test } from './canvas.ts';

test.use({
  board: { env: 'qa', mode: 'auto', zoom: 1, pan: { x: 60, y: 60 }, nodes: { web: at(0, 0) }, edges: [] },
});

test('with the Agent panel open, the toolbar keeps one row', async ({ page }) => {
  const toolbar = page.locator('.svelte-flow__panel.bottom.center');
  const row = async () => (await toolbar.boundingBox())?.height ?? 0;
  const one = await row();
  await page.locator('header .agent').click();
  await expect(page.getByRole('dialog', { name: 'Messages from the agent' })).toBeVisible();
  await page.waitForTimeout(300);
  expect(await row()).toBe(one);
  await page.screenshot({ path: 'test-results/toolbar-narrow.png' });
});
