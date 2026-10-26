// A note for the agent on a card that is not an app: offered while the card is picked, read as text once written, kept with
// the board and handed to the agent with the run.
import fs from 'node:fs';
import path from 'node:path';
import { expect, nextEdit, sent, STACK, test } from './canvas.ts';

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

test('a queue card offers a note only while picked; written, it reads as text, is kept and goes with the run', async ({
  page,
  canvas,
}) => {
  const queue = page.locator('.svelte-flow__node-queue').filter({ hasText: 'Order events' });
  const add = queue.getByRole('button', { name: 'Add note' });
  await expect(queue).toBeVisible();
  await expect(add).toBeHidden();
  await queue.click({ position: { x: 40, y: 12 } });
  await add.click();
  await nextEdit(page);
  await queue.getByLabel('Note for the agent').fill('Purge it before the run');
  await queue.getByRole('button', { name: 'Done' }).click();
  const written = queue.getByRole('button', { name: /Note for the agent\s*Purge it before the run/ });
  await expect(written).toBeVisible();
  await expect(add).toBeHidden();
  const kept = () =>
    (JSON.parse(fs.readFileSync(path.join(canvas.temp, 'state.json'), 'utf8')) as { cardNotes?: object }).cardNotes;
  await expect.poll(kept).toEqual({ 'queue:order-events': 'Purge it before the run' });
  await page.getByRole('button', { name: 'Undo', exact: true }).click();
  await expect(written).toHaveCount(0);
  await expect.poll(kept).toBeUndefined();
  await page.getByRole('button', { name: 'Redo', exact: true }).click();
  await expect(written).toBeVisible();
  await expect.poll(kept).toEqual({ 'queue:order-events': 'Purge it before the run' });
  await page.screenshot({ path: 'test-results/card-notes.png' });

  // Esc puts back what was there; Remove note takes it off.
  await written.click();
  await queue.getByLabel('Note for the agent').fill('Something else');
  await queue.getByLabel('Note for the agent').press('Escape');
  await expect(written).toBeVisible();
  await page.getByRole('button', { name: 'Run', exact: true }).click();
  await page.getByRole('dialog').getByRole('button', { name: 'Run', exact: true }).click();
  await expect
    .poll(() => sent(canvas.temp).at(-1)?.text ?? '')
    .toContain('NOTE on the queue Order events: Purge it before the run');
  await written.click();
  await queue.getByRole('button', { name: 'Remove note' }).click();
  await expect(written).toHaveCount(0);
  await expect.poll(kept).toBeUndefined();
});
