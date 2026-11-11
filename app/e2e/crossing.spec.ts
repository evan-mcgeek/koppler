// Crossing over: apps picked in Discover go to a run board, which keeps the flow it came from and leads back to it.
import type { Page } from '@playwright/test';
import { actions, at, card, expect, overlapping, STACK, test } from './canvas.ts';

const paying = {
  name: 'Paying',
  version: 1,
  nodes: {},
  edges: [],
  feature: {
    request: 'How does paying work',
    cards: [],
    phases: [
      {
        name: 'Pay',
        steps: [
          { from: 'web', to: 'orders', kind: 'call' },
          { from: 'orders', to: 'payments', kind: 'call' },
        ],
      },
    ],
  },
};
test.use({
  stack: { ...STACK, presets: [...(STACK.presets ?? []), paying] },
  board: {
    env: 'qa',
    mode: 'auto',
    zoom: 1,
    pan: { x: 60, y: 60 },
    nodes: { catalog: at(0, 0) },
    edges: [],
    presets: [
      { name: 'Payments debugging', version: 1, nodes: { payments: { run: 'cli' } }, edges: [] },
      { name: 'Catalog', version: 1, nodes: { catalog: { run: 'cli' } }, edges: [] },
    ],
  },
});

const bar = (page: Page) => page.getByRole('banner');
const toFlow = async (page: Page) => {
  await expect(card(page, 'catalog')).toBeVisible();
  await page.keyboard.press('ControlOrMeta+1');
  await page.getByRole('complementary', { name: 'Discover' }).locator('.row').filter({ hasText: 'Paying' }).click();
  await expect(bar(page).getByRole('button', { name: 'Board: Paying' })).toBeVisible();
  // A step's apps, picked from the panel.
  await page.getByRole('button', { name: 'Pick the apps of step 1.1' }).click();
  await expect(page.locator('.pickbar')).toContainText('2 picked: Web Shop, Orders API');
  await page.getByRole('button', { name: 'Plan a run with these' }).click();
  return page.getByRole('dialog', { name: 'Plan a run with 2 apps' });
};

test('the picked apps go to a new run board named after the flow, whose chip leads back to it', async ({ page }) => {
  const ask = await toFlow(page);
  await expect(ask).toContainText('From the Paying flow. The rest stay deployed.');
  await expect(ask.getByRole('radio', { name: /New run board/ })).toBeChecked();
  await expect(ask).toContainText('Paying run');
  await page.screenshot({ path: 'test-results/crossing-ask.png' });
  await ask.getByRole('button', { name: 'Open in Run' }).click();

  await expect(bar(page).getByRole('radio', { name: 'Run' })).toBeChecked();
  await expect(bar(page).getByRole('button', { name: 'Board: Paying run' })).toBeVisible();
  await expect(card(page, 'web')).toBeVisible();
  await expect(card(page, 'orders')).toBeVisible();
  await expect(card(page, 'catalog')).toHaveCount(0);
  // Laid out, side by side: no card on another.
  await expect.poll(() => overlapping(page)).toEqual([]);
  const chip = page.getByRole('note', { name: 'Flow' });
  await expect(chip).toContainText(/Flow\s*Paying/);
  await page.screenshot({ path: 'test-results/crossing-run.png' });
  // Run's menu says where it came from.
  await bar(page)
    .getByRole('button', { name: /^Board:/ })
    .click();
  await expect(
    page.getByRole('dialog', { name: 'Boards' }).locator('.row').filter({ hasText: 'Paying run' }),
  ).toContainText('from Paying');
  await page.keyboard.press('Escape');
  // Back to the flow, with the run board's apps picked.
  await chip.getByRole('button', { name: 'Open in Discover' }).click();
  await expect(bar(page).getByRole('button', { name: 'Board: Paying' })).toBeVisible();
  await expect(page.locator('.lean.picked')).toHaveCount(2);
});

test('the picked apps can join a run board instead, and a card there shows itself in Discover', async ({ page }) => {
  const ask = await toFlow(page);
  await ask.getByRole('radio', { name: /Add to a run board/ }).check();
  await ask.getByRole('combobox', { name: 'Run board to add to' }).selectOption('Payments debugging');
  await ask.getByRole('button', { name: 'Open in Run' }).click();
  await expect(bar(page).getByRole('button', { name: 'Board: Payments debugging' })).toBeVisible();
  for (const id of ['payments', 'web', 'orders']) await expect(card(page, id)).toBeVisible();
  await expect(page.getByRole('note', { name: 'Flow' })).toContainText('Paying');
  // The cards just added are picked, their tool bars open: a click on the empty board lets go of them.
  const pane = await page.locator('.svelte-flow__pane').boundingBox();
  if (!pane) throw new Error('no board');
  await page.mouse.click(pane.x + pane.width - 40, pane.y + pane.height / 2);
  await (await actions(page, 'web')).getByRole('button', { name: 'Show Web Shop in Discover' }).click();
  await expect(bar(page).getByRole('button', { name: 'Board: Paying' })).toBeVisible();
  await expect(page.locator('.svelte-flow__node[data-id="web"] .lean')).toHaveClass(/picked/);
});
