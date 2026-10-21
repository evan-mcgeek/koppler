// An outside system brought onto the board goes on a free spot in view, never behind the side panel.
import { at, expect, STACK, test } from './canvas.ts';

test.use({
  stack: {
    ...STACK,
    apps: { ...STACK.apps, hooks: { name: 'Acme Hooks', kind: 'other', outside: 'SaaS', consumes: { web: {} } } },
  },
  // Web near the left edge: the spot before it, where a caller goes first, is off the board.
  board: { env: 'qa', mode: 'auto', zoom: 1, pan: { x: 40, y: 120 }, nodes: { web: at(0, 0) }, edges: [] },
});

test('an outside system that calls a card near the edge gets a card in view', async ({ page }) => {
  const card = page.locator('.svelte-flow__node-outside').filter({ hasText: 'Acme Hooks' });
  await expect(card).toBeVisible();
  const board = await page.locator('.svelte-flow').boundingBox();
  const box = await card.boundingBox();
  if (!board || !box) throw new Error('not drawn');
  expect(box.x).toBeGreaterThanOrEqual(board.x);
  expect(box.y).toBeGreaterThanOrEqual(board.y);
  expect(box.x + box.width).toBeLessThanOrEqual(board.x + board.width);
  expect(box.y + box.height).toBeLessThanOrEqual(board.y + board.height);
  await page.screenshot({ path: 'test-results/outside-in-view.png' });
});
