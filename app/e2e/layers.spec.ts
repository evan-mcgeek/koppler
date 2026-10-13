// What is drawn over what: a card on top hides the cable ends of the card under it, and a group pick leaves no box.
import { test, expect, actions } from './canvas.ts';

const at = (x: number, y: number) => ({ x, y, run: 'cli', branch: 'main' });
test.use({
  board: {
    env: 'qa',
    mode: 'auto',
    zoom: 1,
    pan: { x: 60, y: 60 },
    nodes: { web: at(0, 0), orders: at(200, 60), payments: at(900, 0) },
    edges: [
      { from: 'web', to: 'orders', fromSide: 'right', toSide: 'left' },
      { from: 'orders', to: 'payments', fromSide: 'right', toSide: 'left' },
    ],
  },
});

test('a card drawn over another hides the cable ends under it', async ({ page }) => {
  await expect(page.locator('.svelte-flow__node-app')).toHaveCount(3);
  // Orders API lies over Web Shop's right side, where its cable starts.
  await expect(page.locator('.ends .plug[data-cable="web>orders"]')).toHaveCount(0);
  await expect(page.locator('.ends .plug[data-cable="orders>payments"]')).toHaveCount(1);
  await page.screenshot({ path: 'test-results/next-covered-ends.png' });
  // Picked, Web Shop comes to the front, and its end shows again.
  await page.locator('.svelte-flow__node[data-id="web"] header').click({ position: { x: 30, y: 12 } });
  await expect(page.locator('.ends .plug[data-cable="web>orders"]')).toHaveCount(1);
});

test('a group picked by dragging an area shows no box around it', async ({ page }) => {
  await page.locator('.svelte-flow__node-app').first().waitFor();
  await page.mouse.move(340, 700);
  await page.mouse.down();
  await page.mouse.move(1300, 70, { steps: 10 });
  await page.mouse.up();
  await expect(page.locator('.svelte-flow__node-app.selected')).not.toHaveCount(0);
  await expect(page.locator('.svelte-flow__selection')).toBeHidden();
  // The cards under where the box was still take a click.
  await (await actions(page, 'payments')).getByRole('button', { name: 'Run Payments API alone' }).click();
  await expect(page.getByRole('dialog').filter({ hasText: 'Run on QA' })).toBeVisible();
});
