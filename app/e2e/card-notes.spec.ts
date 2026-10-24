// A note for the agent on a card that is not an app: kept with the board, and handed to the agent with the run.
import fs from 'node:fs';
import path from 'node:path';
import { expect, sent, STACK, test } from './canvas.ts';

const at = (x: number, y: number) => ({ x, y, run: 'cli', branch: 'main', showQueues: true });
test.use({
  stack: {
    ...STACK,
    queues: { 'order-events': { name: 'Order events', type: 'sqs', queue: 'order-events-qa' } },
    apps: {
      ...STACK.apps,
      orders: { ...STACK.apps.orders, publishes: { 'order-events': {} } },
      payments: { ...STACK.apps.payments, reads: { 'order-events': {} } },
    },
  },
  board: { env: 'qa', mode: 'auto', nodes: { orders: at(0, 0), payments: at(700, 0) }, edges: [] },
});

test('a note on a queue card is kept with the board and goes to the agent with the run', async ({ page, canvas }) => {
  const queue = page.locator('.svelte-flow__node-queue').filter({ hasText: 'Order events' });
  await queue.getByRole('button', { name: 'Add a note for the agent' }).click();
  await queue.getByLabel('Note for the agent').fill('Purge it before the run');
  await page.locator('.svelte-flow__pane').click({ position: { x: 5, y: 5 } });
  await expect(queue.getByLabel('Note for the agent')).toHaveValue('Purge it before the run');
  const kept = () =>
    (JSON.parse(fs.readFileSync(path.join(canvas.temp, 'state.json'), 'utf8')) as { cardNotes?: object }).cardNotes;
  await expect.poll(kept).toEqual({ 'queue:order-events': 'Purge it before the run' });
  await page.screenshot({ path: 'test-results/card-notes.png' });

  await page.getByRole('button', { name: 'Run', exact: true }).click();
  await page.getByRole('dialog').getByRole('button', { name: 'Run', exact: true }).click();
  await expect
    .poll(() => sent(canvas.temp).at(-1)?.text ?? '')
    .toContain('NOTE on the queue Order events: Purge it before the run');
});
