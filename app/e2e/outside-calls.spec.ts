// A call between two outside systems on the board is drawn: a Lambda that pushes through a push service, say.
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
      // Calls the push service too, but touches nothing on the board: no card of its own.
      reports: { name: 'Acme Reports', kind: 'other', outside: 'Lambda', consumes: { 'push-service': {} } },
    },
  },
  board: { env: 'qa', mode: 'auto', nodes: { web: { ...at(0, 0), showQueues: true } }, edges: [] },
});

test('a call between two outside systems on the board is drawn, and pulls in no other outside system', async ({
  page,
}) => {
  const outside = page.locator('.svelte-flow__node-outside');
  await expect(outside.filter({ hasText: 'Acme Pusher' })).toBeVisible();
  await expect(outside.filter({ hasText: 'Acme Push' }).filter({ hasNotText: 'Pusher' })).toBeVisible();
  await expect(outside).toHaveCount(2);
  // Web to the queue, the queue to the pusher, the pusher to the push service, the push service to Web.
  await expect(page.locator('.links .flow')).toHaveCount(4);
  await page.screenshot({ path: 'test-results/outside-calls.png' });
});
