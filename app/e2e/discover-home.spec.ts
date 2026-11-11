// Discover's home: the whole stack, the feature boards, the team's and yours, and a question to the agent.
import type { Page } from '@playwright/test';
import { at, card, expect, sent, STACK, test } from './canvas.ts';

const flow = (name: string, steps: [string, string][]) => ({
  name,
  version: 1,
  nodes: {},
  edges: [],
  feature: {
    request: `How does ${name} work`,
    cards: [],
    phases: [{ name: 'Place the order', steps: steps.map(([from, to]) => ({ from, to, kind: 'call' })) }],
  },
});
test.use({
  stack: {
    ...STACK,
    presets: [
      ...(STACK.presets ?? []),
      flow('Checkout flow', [
        ['web', 'orders'],
        ['orders', 'payments'],
      ]),
    ],
  },
  board: {
    env: 'qa',
    mode: 'auto',
    zoom: 1,
    pan: { x: 60, y: 60 },
    nodes: { web: at(0, 0) },
    edges: [],
    presets: [flow('Browse flow', [['web', 'catalog']])],
  },
});

const home = (page: Page) => page.getByRole('complementary', { name: 'Discover' });

test('the home lists the whole stack first, then the feature boards, and opens each', async ({ page }) => {
  await expect(card(page, 'web')).toBeVisible();
  await page.keyboard.press('ControlOrMeta+1');
  const rows = home(page).locator('.row');
  await expect(rows).toHaveText([
    /^Whole stack\s*4 apps and resources$/,
    /^Checkout flow\s*1 phase · 2 steps$/,
    /^Browse flow\s*1 phase · 1 step$/,
  ]);
  await expect(home(page).locator('.head')).toHaveText(['Team feature boards', 'Your feature boards']);
  await expect(rows.first()).toHaveAttribute('aria-current', 'true');
  await expect(page.locator('.svelte-flow__node.unplaced')).toHaveCount(0);
  await expect(page.locator('.svelte-flow__node')).toHaveCount(4);
  await expect(page.locator('.map[data-moving]')).toHaveCount(0);
  await page.screenshot({ path: 'test-results/discover-home.png' });
  await rows.filter({ hasText: 'Checkout flow' }).click();
  await expect(page.getByRole('button', { name: /^Board: Checkout flow/ })).toBeVisible();
  await expect(rows.filter({ hasText: 'Checkout flow' })).toHaveAttribute('aria-current', 'true');
  await rows.filter({ hasText: 'Whole stack' }).click();
  await expect(page.getByRole('button', { name: 'Board: Whole stack' })).toBeVisible();
});

test('a question to the agent becomes a feature board of your own, named after it', async ({ page, canvas }) => {
  await expect(card(page, 'web')).toBeVisible();
  await page.keyboard.press('ControlOrMeta+1');
  const box = home(page).getByRole('textbox', { name: 'Ask about Acme Shop' });
  await box.fill('What listens to Orders API?');
  await home(page).getByRole('button', { name: 'Ask', exact: true }).click();
  await expect(page.getByRole('button', { name: /^Board: What listens to Orders API/ })).toBeVisible();
  await expect(home(page).locator('.row[aria-current="true"]')).toContainText('What listens to Orders API');
  await expect(box).toHaveValue('');
  await expect
    .poll(() => sent(canvas.temp).find(one => one.tag === 'koppler-feature')?.data)
    .toEqual({ board: 'What listens to Orders API', request: 'What listens to Orders API?' });
});
