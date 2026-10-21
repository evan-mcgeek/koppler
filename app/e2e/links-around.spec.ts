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
      pusher: {
        name: 'Acme Pusher',
        kind: 'other',
        outside: 'Lambda',
        reads: { pushes: {} },
        consumes: { 'push-service': {} },
      },
      'push-service': { name: 'Acme Push', kind: 'other', outside: 'SaaS', consumes: { web: {} } },
    },
  },
  board: { env: 'qa', mode: 'auto', nodes: { web: { ...at(0, 0), showQueues: true } }, edges: [] },
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

test('after Arrange, the link back up a chain goes round the cards in between', async ({ page }) => {
  await expect(page.locator('.svelte-flow__node-outside')).toHaveCount(2);
  await page
    .getByRole('button', { name: /^Arrange/ })
    .first()
    .click();
  await expect.poll(() => page.locator('.links .flow').count()).toBeGreaterThan(2);
  await expect.poll(() => crossed(page)).toEqual([]);
  await page.screenshot({ path: 'test-results/links-around.png' });
});
