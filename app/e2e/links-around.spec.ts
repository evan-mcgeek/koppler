// A link between two cards goes round the cards between them, never across them.
import type { Page } from '@playwright/test';
import { at, expect, STACK, test } from './canvas.ts';

test.use({
  stack: {
    ...STACK,
    queues: { pushes: { name: 'Push queue', type: 'sqs' } },
    apps: {
      ...STACK.apps,
      web: { ...STACK.apps.web, publishes: { pushes: {} } },
      payments: { ...STACK.apps.payments, reads: { pushes: {} } },
    },
  },
  board: {
    env: 'qa',
    mode: 'auto',
    nodes: {
      web: { ...at(0, 0), showQueues: true },
      orders: at(500, 0),
      payments: { ...at(1000, 0), showQueues: true },
    },
    edges: [
      { from: 'web', to: 'orders' },
      { from: 'orders', to: 'payments' },
    ],
  },
});

/** For each link, the cards other than its own two that its drawn line passes through. */
const crossed = (page: Page) =>
  page.locator('.links .flow').evaluateAll(groups =>
    groups.flatMap(group => {
      const key = group.getAttribute('data-link') ?? '';
      const ends = key.split('>');
      const wire = group.querySelector<SVGPathElement>('path.wire');
      const matrix = wire?.getScreenCTM();
      if (!wire || !matrix) return [];
      const cards = [...document.querySelectorAll<HTMLElement>('.svelte-flow__node')]
        .filter(node => !ends.includes(node.dataset['id'] ?? ''))
        .map(node => ({ id: node.dataset['id'] ?? '', box: node.getBoundingClientRect() }));
      const hit = new Set<string>();
      for (let at = 0; at <= wire.getTotalLength(); at += 4) {
        const p = new DOMPoint(wire.getPointAtLength(at).x, wire.getPointAtLength(at).y).matrixTransform(matrix);
        for (const { id, box } of cards)
          if (p.x > box.left + 2 && p.x < box.right - 2 && p.y > box.top + 2 && p.y < box.bottom - 2) hit.add(id);
      }
      return hit.size ? [`${key} crosses ${[...hit].join(', ')}`] : [];
    }),
  );

test('after Arrange, a message link goes round the cards between its two ends', async ({ page }) => {
  await expect(page.locator('.svelte-flow__node-queue')).toHaveCount(1);
  await page
    .getByRole('button', { name: /^Arrange/ })
    .first()
    .click();
  await expect.poll(() => page.locator('.links .flow').count()).toBe(2);
  await expect.poll(() => crossed(page)).toEqual([]);
  await page.screenshot({ path: 'test-results/links-around.png' });
});

test.describe('an app with its database and queue stacked under it', () => {
  test.use({
    stack: {
      ...STACK,
      queues: { events: { name: 'Order events', type: 'sqs' } },
      databases: { 'orders-db': { name: 'Orders', kind: 'postgres', tunnel: 'aurora.qa.acme.example', port: 5432 } },
      apps: {
        ...STACK.apps,
        orders: { ...STACK.apps.orders, prereqs: [], envs: {}, publishes: { events: {} }, uses: { 'orders-db': {} } },
        payments: { ...STACK.apps.payments, reads: { events: {} } },
      },
    },
    board: {
      env: 'qa',
      mode: 'auto',
      nodes: { orders: { ...at(0, 0), showQueues: true }, payments: { ...at(600, 0), showQueues: true } },
      queues: { events: 'local' },
      edges: [{ from: 'orders', to: 'payments' }],
    },
  });

  test('its publish link goes round the database, and the read link goes straight across', async ({ page }) => {
    await expect(page.locator('.svelte-flow__node-queue')).toHaveCount(1);
    await expect(page.locator('.svelte-flow__node-database')).toHaveCount(1);
    await expect.poll(() => page.locator('.links .flow').count()).toBe(3);
    await expect.poll(() => crossed(page)).toEqual([]);
    // It lands on the reader's near side, the left, not round its far one.
    const payments = await page.locator('.svelte-flow__node[data-id="payments"]').boundingBox();
    const end = await page
      .locator('.links .flow[data-link="queue:events>payments"] path.wire')
      .evaluate((wire: SVGPathElement) => {
        const p = wire.getPointAtLength(wire.getTotalLength());
        return new DOMPoint(p.x, p.y).matrixTransform(wire.getScreenCTM() ?? undefined).x;
      });
    expect(Math.abs(end - (payments?.x ?? 0))).toBeLessThan(30);
  });
});
