// Discover and Run: two front doors on one base, each with its own bar, its own boards, and its own last board.
import type { Page } from '@playwright/test';
import { at, card, expect, STACK, test } from './canvas.ts';

const flow = {
  name: 'Checkout flow',
  version: 1,
  nodes: {},
  edges: [],
  feature: {
    request: 'How does checkout work',
    cards: [],
    phases: [{ name: 'Place the order', steps: [{ from: 'web', to: 'orders', kind: 'call' }] }],
  },
};
test.use({
  stack: { ...STACK, presets: [...(STACK.presets ?? []), flow] },
  board: { env: 'qa', mode: 'auto', zoom: 1, pan: { x: 60, y: 60 }, nodes: { web: at(0, 0) }, edges: [] },
});

const bar = (page: Page) => page.getByRole('banner');
const door = (page: Page, name: 'Discover' | 'Run') =>
  bar(page).getByRole('radiogroup', { name: 'Door' }).getByRole('radio', { name });
const menuOf = async (page: Page) => {
  await bar(page)
    .getByRole('button', { name: /^Board:/ })
    .click();
  return page.getByRole('dialog', { name: 'Boards' });
};
const rows = (menu: ReturnType<Page['locator']>) => menu.locator('.row:not(.gone) > button:first-child');

test('the door decides the bar: Discover has nothing to run, Run has Plan, Live, status, Activity, Stop and Run', async ({
  page,
}) => {
  await expect(card(page, 'web')).toBeVisible();
  await expect(door(page, 'Run')).toBeChecked();
  // The door is the first control after the mark.
  const order = await bar(page)
    .locator('.brand, .door, .names')
    .evaluateAll(all => all.map(one => one.classList[0]));
  expect(order).toEqual(['brand', 'door', 'names']);
  for (const name of ['Activity', 'Stop', 'Run'])
    await expect(bar(page).getByRole('button', { name, exact: true })).toBeVisible();
  await expect(bar(page).getByRole('radio', { name: 'Plan' })).toBeChecked();
  await page.screenshot({ path: 'test-results/door-run.png' });

  await page.keyboard.press('ControlOrMeta+1');
  await expect(door(page, 'Discover')).toBeChecked();
  await expect(bar(page).getByRole('button', { name: 'Board: Whole stack' })).toBeVisible();
  for (const name of ['Activity', 'Stop', 'Run'])
    await expect(bar(page).getByRole('button', { name, exact: true })).toHaveCount(0);
  await expect(bar(page).getByRole('radio', { name: 'Plan' })).toHaveCount(0);
  await expect(bar(page).getByRole('button', { name: '0 running' })).toHaveCount(0);
  await expect(page.locator('.map[data-moving]')).toHaveCount(0);
  await page.screenshot({ path: 'test-results/door-discover.png' });
});

test('each door lists its own boards and comes back to the last one it was on', async ({ page }) => {
  await expect(card(page, 'web')).toBeVisible();
  // Run: run boards only.
  let menu = await menuOf(page);
  await expect(rows(menu)).not.toContainText(['Checkout flow']);
  await expect(menu.getByRole('button', { name: 'New board' })).toBeVisible();
  await expect(menu.getByRole('button', { name: 'New feature board' })).toHaveCount(0);
  await menu.getByRole('button', { name: /^Checkout/ }).click();
  await expect(bar(page).getByRole('button', { name: /^Board: Checkout$/ })).toBeVisible();

  // Discover: the whole stack, then feature boards, and asking the agent for a new one.
  await door(page, 'Discover').check();
  menu = await menuOf(page);
  await expect(rows(menu)).toHaveText([/^Whole stack\s*$/, /^Checkout flow\s*Team\s*$/]);
  await expect(menu.getByRole('button', { name: 'Ask the agent for a new one…' })).toBeVisible();
  await expect(menu.getByRole('button', { name: 'New board' })).toHaveCount(0);
  await page.screenshot({ path: 'test-results/door-discover-menu.png' });
  await menu.getByRole('button', { name: /^Checkout flow/ }).click();
  await expect(bar(page).getByRole('button', { name: /^Board: Checkout flow/ })).toBeVisible();

  // Each door is where it was left.
  await page.keyboard.press('ControlOrMeta+2');
  await expect(bar(page).getByRole('button', { name: /^Board: Checkout$/ })).toBeVisible();
  await expect(card(page, 'payments')).toBeVisible();
  await page.keyboard.press('ControlOrMeta+1');
  await expect(bar(page).getByRole('button', { name: /^Board: Checkout flow/ })).toBeVisible();
  // Whole stack leaves the feature board; Run still has its board.
  menu = await menuOf(page);
  await menu.getByRole('button', { name: /^Whole stack/ }).click();
  await expect(bar(page).getByRole('button', { name: 'Board: Whole stack' })).toBeVisible();
  await page.keyboard.press('ControlOrMeta+2');
  await expect(bar(page).getByRole('button', { name: /^Board: Checkout$/ })).toBeVisible();
});
