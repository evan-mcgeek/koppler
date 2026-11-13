// Discover's Show menu: whole kinds of card hidden from the map, a queue type on its own, the links through them kept.
import { card, expect, STACK, test } from './canvas.ts';

const { orders, payments } = STACK.apps;
test.use({
  stack: {
    ...STACK,
    queues: {
      'order-events': { name: 'Order events', type: 'sqs', queue: 'order-events-qa' },
      receipts: { name: 'Receipts', type: 'kafka', queue: 'receipts-qa' },
    },
    apps: {
      ...STACK.apps,
      orders: { ...orders, publishes: { 'order-events': {}, receipts: {} }, consumes: { billing: {} } },
      payments: { ...payments, reads: { 'order-events': {} } },
      billing: {
        name: 'Billing',
        kind: 'other',
        outside: 'a hosted service',
        deployedUrl: 'https://api.billing.example',
      },
      sync: {
        name: 'Sync keys',
        kind: 'workflow',
        deployedUrl: 'https://github.com/acme/web/actions/workflows/sync.yml',
      },
    },
  },
  board: { env: 'qa', mode: 'auto', nodes: {}, edges: [] },
});

test('the Show menu hides whole kinds of card, a queue type on its own, and keeps the links that ran through them', async ({
  page,
}) => {
  await page.getByRole('radio', { name: 'Discover' }).check();
  await expect(card(page, 'queue:order-events')).toBeVisible();
  await expect(page.getByRole('complementary', { name: 'Discover' }).locator('.row.whole')).toContainText(
    /services · 1 job · 1 outside system · 2 queues/,
  );

  const show = page.getByRole('button', { name: 'Show: All' });
  await show.click();
  const menu = page.getByRole('dialog', { name: 'Kinds of card to see' });
  await expect(menu.getByRole('checkbox', { name: /Jobs and functions/ })).toBeVisible();
  await expect(menu.getByRole('checkbox', { name: /^SQS/ })).toBeVisible();
  await page.screenshot({ path: 'test-results/show-menu.png' });

  // SQS off: its queue goes, and Orders API to Payments API is drawn dotted through it; Kafka stays.
  await menu.getByRole('checkbox', { name: /^SQS/ }).uncheck();
  await expect(card(page, 'queue:order-events')).toHaveCount(0);
  await expect(card(page, 'queue:receipts')).toBeVisible();
  await expect(page.locator('.link.through[data-link="orders>payments>publish"]')).toHaveCount(1);
  await expect(page.getByLabel('Legend', { exact: true })).toContainText('Through hidden cards');

  // Outside systems off as well: Billing goes, and the button says how many kinds show.
  await menu.getByRole('checkbox', { name: /Outside systems/ }).uncheck();
  await expect(card(page, 'billing')).toHaveCount(0);
  await expect(page.getByRole('button', { name: 'Show: 3 of 4' })).toBeVisible();
  await page.keyboard.press('Escape');
  await expect(page.locator('.map[data-moving]')).toHaveCount(0);
  await expect(card(page, 'payments')).toBeInViewport();
  await page.screenshot({ path: 'test-results/show-hidden.png' });

  // Kept in this browser.
  await page.reload();
  await page.getByRole('radio', { name: 'Discover' }).check();
  await expect(card(page, 'billing')).toHaveCount(0);
  await expect(card(page, 'queue:order-events')).toHaveCount(0);

  // Everything back.
  await page.getByRole('button', { name: 'Show: 3 of 4' }).click();
  await page
    .getByRole('dialog', { name: 'Kinds of card to see' })
    .getByRole('checkbox', { name: 'Everything' })
    .check();
  await expect(card(page, 'billing')).toBeVisible();
  await expect(card(page, 'queue:order-events')).toBeVisible();
  await expect(page.locator('.link.through')).toHaveCount(0);
});
