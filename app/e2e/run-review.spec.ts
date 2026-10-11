// The Run review: what will happen is shown first, and nothing is sent before it is confirmed.
import type { Page } from '@playwright/test';
import { test, expect, nextEdit } from './canvas.ts';

const cards = (page: Page) => page.getByRole('main').getByRole('group', { name: /Arrow keys move it/ });
const openCheckout = async (page: Page) => {
  await page.getByRole('button', { name: /^Checkout/ }).click();
  await expect(cards(page)).toHaveCount(3);
};
// Runs are caught before they reach the engine: the test stack has nothing to start.
type Sent = { tag: string; data: { env: string; nodes: { id: string }[]; edges: { from: string; to: string }[] } };
const catchRuns = async (page: Page) => {
  const sent: Sent[] = [];
  await page.route('**/prompt?*', route => {
    sent.push(route.request().postDataJSON() as Sent);
    return route.fulfill({ status: 204 });
  });
  return sent;
};

test('Run shows the plan, and sends it only when confirmed', async ({ page }) => {
  const sent = await catchRuns(page);
  await openCheckout(page);
  await page.getByRole('button', { name: 'Run', exact: true }).click();
  const review = page.getByRole('dialog', { name: 'Run on QA' });
  await expect(review).toContainText('Starts');
  for (const name of ['Web Shop', 'Orders API', 'Payments API']) await expect(review).toContainText(name);
  await expect(review).toContainText('Calls deployed QA');
  await expect(review).toContainText('db.qa.acme.example');
  await review.getByRole('button', { name: 'Cancel' }).click();
  await expect(review).toBeHidden();
  expect(sent).toEqual([]);

  await page.getByRole('button', { name: 'Run', exact: true }).click();
  await review.getByRole('button', { name: 'Run', exact: true }).click();
  await expect.poll(() => sent.length).toBe(1);
  const [run] = sent;
  if (!run) throw new Error('nothing was sent');
  expect(run.tag).toBe('koppler');
  expect(run.data.env).toBe('qa');
  expect(run.data.nodes.map(n => n.id).sort()).toEqual(['orders', 'payments', 'web']);
  expect(run.data.edges.map(e => `${e.from}>${e.to}`).sort()).toEqual(['orders>payments', 'web>orders']);
});

test('a protected environment is named in the review, with its own tunnel', async ({ page }) => {
  await openCheckout(page);
  await page.getByRole('radiogroup', { name: 'Environment' }).getByText('PROD').click();
  await page.getByRole('button', { name: /^Run/ }).first().click();
  const review = page.getByRole('dialog', { name: 'Run on PROD' });
  await expect(review).toContainText('real PROD data');
  await expect(review).toContainText('db.prod.acme.example');
  await expect(review.getByRole('button', { name: 'Run on PROD' })).toBeVisible();
});

test('shortcuts leave the board alone while the review is open', async ({ page }) => {
  await openCheckout(page);
  await nextEdit(page);
  await page.getByRole('button', { name: 'Remove Payments API', exact: true }).click();
  await expect(cards(page)).toHaveCount(2);
  await page.getByRole('button', { name: 'Run', exact: true }).click();
  const review = page.getByRole('dialog', { name: 'Run on QA' });
  await expect(review).toBeVisible();
  await page.keyboard.press('ControlOrMeta+z');
  await page.keyboard.press('l');
  await review.getByRole('button', { name: 'Cancel' }).click();
  await expect(cards(page)).toHaveCount(2);
  await expect(page.getByRole('radio', { name: 'Edit' })).toBeChecked();
  // Once it is closed, undo works again.
  await page.keyboard.press('ControlOrMeta+z');
  await expect(cards(page)).toHaveCount(3);
});
