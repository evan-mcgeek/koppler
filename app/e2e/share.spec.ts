// Share in Discover: a feature board as a view-only page, a snapshot for one environment, opened in any browser.
import { at, card, expect, STACK, test } from './canvas.ts';

const step = (from: string, to: string) => ({ from, to, kind: 'call' });
test.use({
  stack: {
    ...STACK,
    apps: {
      ...STACK.apps,
      orders: {
        ...STACK.apps.orders,
        description: 'Takes the order and keeps it',
        deployedUrl: 'https://orders.prod.acme.example',
      },
    },
  },
  board: {
    env: 'qa',
    mode: 'auto',
    zoom: 1,
    pan: { x: 60, y: 60 },
    nodes: { web: at(0, 0) },
    edges: [],
    presets: [
      {
        name: 'Checkout flow',
        version: 1,
        nodes: {},
        edges: [],
        feature: {
          request: 'How a customer checks out',
          cards: [],
          phases: [{ name: 'Order', steps: [step('web', 'orders'), step('orders', 'payments')] }],
        },
      },
    ],
  },
});

test('Share is off on the whole stack, and saves a feature board as a view-only page for the environment picked', async ({
  page,
}, testInfo) => {
  await expect(card(page, 'web')).toBeVisible();
  await page.keyboard.press('ControlOrMeta+1');
  const share = page.getByRole('banner').getByRole('button', { name: 'Share', exact: true });
  await expect(share).toBeDisabled();
  await page
    .getByRole('complementary', { name: 'Discover' })
    .locator('.row')
    .filter({ hasText: 'Checkout flow' })
    .click();
  await expect(share).toBeEnabled();
  await share.click();
  const pop = page.getByRole('dialog', { name: 'Share Checkout flow, view only' });
  await expect(pop).toContainText('No hosts, routes or settings.');
  await pop.getByRole('radio', { name: 'PROD' }).check();
  await expect(pop).toContainText('on PROD');
  await page.screenshot({ path: 'test-results/share.png' });
  const saving = page.waitForEvent('download');
  await pop.getByRole('button', { name: 'Save the page' }).click();
  const download = await saving;
  const file = testInfo.outputPath(download.suggestedFilename());
  await download.saveAs(file);
  // The sharer sees when it was shared.
  await share.click();
  await expect(pop).toContainText(/Shared \w/);
  await page.keyboard.press('Escape');

  // The page: view only, the environment and the date printed, made with Koppler, and nothing loaded from anywhere.
  await page.route('**/*', route => (route.request().url().startsWith('file:') ? route.continue() : route.abort()));
  await page.goto(`file://${file}`);
  const header = page.getByRole('banner');
  await expect(header).toContainText('View only');
  await expect(header).toContainText(/PROD · \w/);
  await expect(header).toContainText('Made with koppler');
  // A picked card says what it is and its part in the flow, with no host.
  await page.locator('.card[data-id="orders"]').click();
  const about = page.getByRole('region', { name: 'Orders API' });
  await expect(about).toContainText('Takes the order and keeps it');
  await expect(about.locator('li')).toHaveText(['Step 1.1: called by Web Shop', 'Step 1.2: calls Payments API']);
  await expect(page.locator('body')).not.toContainText('orders.prod.acme.example');
  await page.screenshot({ path: 'test-results/share-viewer.png' });
});
