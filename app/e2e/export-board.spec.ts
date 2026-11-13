// Export in the board menu: one feature board of your own, as the page `koppler export --board` writes, saved here.
import { expect, fromBoardMenu, STACK, test } from './canvas.ts';

const step = (from: string, to: string, note: string) => ({ from, to, kind: 'call', note });
test.use({
  stack: STACK,
  board: {
    env: 'qa',
    mode: 'auto',
    nodes: { web: { x: 0, y: 0, run: 'cli' } },
    edges: [],
    presets: [
      {
        name: 'My checkout',
        version: 1,
        nodes: {},
        edges: [],
        feature: {
          request: 'How a customer pays, for the write-up.',
          cards: [],
          phases: [
            { name: 'Order', steps: [step('web', 'orders', 'Sends the order')] },
            { name: 'Pay', steps: [step('orders', 'payments', 'Takes the money')] },
          ],
        },
      },
    ],
  },
});

test('a board of your own exports from its row menu as a page with its phases and steps', async ({
  page,
}, testInfo) => {
  // Feature boards are Discover's: once the board is up, ⌘1 goes there.
  await expect(page.locator('.svelte-flow__node[data-id="web"]')).toBeVisible();
  await page.keyboard.press('ControlOrMeta+1');
  await expect(page.getByRole('radio', { name: 'Discover' })).toBeChecked();
  await page
    .getByRole('banner')
    .getByRole('button', { name: /^Board:/ })
    .click();
  const saving = page.waitForEvent('download');
  await fromBoardMenu(page, 'My checkout', 'Export');
  const download = await saving;
  expect(download.suggestedFilename()).toBe('acme-shop-my-checkout-flows.html');
  await expect(page.getByRole('status').filter({ hasText: 'Exported My checkout' })).toBeVisible();
  const file = testInfo.outputPath(download.suggestedFilename());
  await download.saveAs(file);

  // Opened on its own, it loads nothing else.
  await page.route('**/*', route => (route.request().url().startsWith('file:') ? route.continue() : route.abort()));
  await page.goto(`file://${file}`);
  const steps = page.getByRole('complementary', { name: 'My checkout' });
  await expect(steps).toContainText('How a customer pays, for the write-up.');
  await expect(steps).toContainText('Order');
  await expect(steps).toContainText('Pay');
  // One flow: the bar names it, with no other to pick.
  await expect(page.getByRole('banner').getByRole('button', { name: 'Flows' })).toHaveCount(0);
  await steps.getByRole('button', { name: 'Walk through the steps' }).click();
  await expect(page.getByRole('status', { name: 'Step 1.1' })).toContainText('Web Shop → Orders API');
  await page.keyboard.press('ArrowRight');
  await expect(page.getByRole('status', { name: 'Step 2.1' })).toContainText('Takes the money');
});

test('a board that is no feature board has no Export', async ({ page }) => {
  await page
    .getByRole('banner')
    .getByRole('button', { name: /^Board:/ })
    .click();
  const menu = page.getByRole('dialog', { name: 'Boards' });
  await menu.locator('.row').filter({ hasText: 'Checkout' }).first().hover();
  await menu.getByRole('button', { name: 'More for Checkout', exact: true }).click();
  await expect(page.getByRole('menu', { name: 'Checkout' }).getByRole('menuitem')).not.toContainText(['Export']);
});
