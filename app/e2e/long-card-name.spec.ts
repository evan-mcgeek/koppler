// A long name is cut short on a card: its tag and buttons stay inside the card's edge.
import { at, expect, STACK, test } from './canvas.ts';

test.use({
  stack: {
    ...STACK,
    databases: {
      'notes-db': {
        name: 'Acme Shop Notifications DB (local)',
        kind: 'postgres',
        tunnel: 'aurora.qa.acme.example',
        port: 5432,
      },
    },
    apps: { ...STACK.apps, orders: { ...STACK.apps.orders, prereqs: [], envs: {}, uses: { 'notes-db': {} } } },
  },
  board: { env: 'qa', mode: 'auto', zoom: 1, pan: { x: 60, y: 40 }, nodes: { orders: at(0, 0) }, edges: [] },
});

test('a database with a long name keeps its tag and settings button inside the card', async ({ page }) => {
  const card = page.locator('.svelte-flow__node-database .infra');
  const button = page.getByRole('button', { name: 'Settings for Acme Shop Notifications DB (local)' });
  const tag = card.locator('.tag');
  await expect(button).toBeVisible();
  const [box, cog, label] = await Promise.all([card.boundingBox(), button.boundingBox(), tag.boundingBox()]);
  if (!box || !cog || !label) throw new Error('not drawn');
  for (const inner of [cog, label]) {
    expect(inner.x).toBeGreaterThanOrEqual(box.x);
    expect(inner.x + inner.width).toBeLessThanOrEqual(box.x + box.width);
  }
  await expect(card).toHaveAttribute('title', 'Acme Shop Notifications DB (local)');
  await card.screenshot({ path: 'test-results/long-card-name.png' });
});
