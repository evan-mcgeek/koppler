// A long name wraps to two lines, then is cut; its kind tag sits under it and the buttons stay inside the card.
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

test('a database with a long name wraps to two lines, its tag under it, its buttons inside the card', async ({
  page,
}) => {
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
  const name = await card.locator('.name').boundingBox();
  if (!name) throw new Error('not drawn');
  // Two lines of 19px, and the kind tag below them, not beside.
  expect(Math.round(name.height)).toBe(38);
  expect(label.y).toBeGreaterThan(name.y + name.height);
  await card.screenshot({ path: 'test-results/long-card-name.png' });
});
