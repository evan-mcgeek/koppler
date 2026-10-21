// A board for one flow: a queue between two outside cards shows, and what a board hides stays hidden with it.
import fs from 'node:fs';
import path from 'node:path';
import { at, expect, STACK, test } from './canvas.ts';

const stack = {
  ...STACK,
  queues: {
    'event-a': { name: 'Event A', type: 'eventbridge' },
    'event-b': { name: 'Event B', type: 'eventbridge' },
  },
  apps: {
    ...STACK.apps,
    payments: { ...STACK.apps.payments, reads: { 'event-a': {}, 'event-b': {} } },
    crm: { name: 'Acme CRM', kind: 'other', outside: 'SaaS', publishes: { 'event-a': {}, 'event-b': {} } },
    handler: {
      name: 'Acme Handler',
      kind: 'other',
      outside: 'Lambda',
      reads: { 'event-a': {} },
      consumes: { orders: {} },
    },
  },
};
const flowA = { name: 'Flow A', version: 1, nodes: { orders: { run: 'cli' } }, edges: [], outside: ['crm', 'handler'] };

test.describe('a queue between two outside cards', () => {
  test.use({
    stack,
    board: {
      env: 'qa',
      mode: 'auto',
      zoom: 1,
      pan: { x: 60, y: 60 },
      nodes: { orders: at(0, 0) },
      edges: [],
      outside: ['crm', 'handler'],
    },
  });

  test('shows with its two links, and one with no reader on the board does not', async ({ page }) => {
    const queues = page.locator('.svelte-flow__node-queue');
    await expect(queues.filter({ hasText: 'Event A' })).toBeVisible();
    await expect(queues).toHaveCount(1);
    // The CRM to Event A, Event A to the handler, the handler to Orders API.
    await expect(page.locator('.links .flow')).toHaveCount(3);
    // Each lands on the board in view, not behind the side panel.
    const board = await page.locator('.svelte-flow').boundingBox();
    for (const card of await page.locator('.svelte-flow__node-queue, .svelte-flow__node-outside').all()) {
      const box = await card.boundingBox();
      expect(board && box && box.x >= board.x && box.x + box.width <= board.x + board.width).toBe(true);
    }
    await page.screenshot({ path: 'test-results/flow-boards.png' });
  });
});

test.describe('what a board hides', () => {
  test.use({
    stack,
    board: {
      env: 'qa',
      mode: 'auto',
      nodes: { orders: at(0, 0) },
      edges: [],
      preset: 'Flow A',
      outside: ['crm', 'handler'],
      presets: [flowA, { ...flowA, name: 'Flow B' }],
    },
  });

  test('stays hidden on that board only, after opening another and coming back', async ({ page, canvas }) => {
    const queue = page.locator('.svelte-flow__node-queue').filter({ hasText: 'Event A' });
    await expect(queue).toBeVisible();
    await page.getByRole('button', { name: 'Hide Event A' }).click();
    await expect(queue).toHaveCount(0);
    const hidden = () => {
      const kept = JSON.parse(fs.readFileSync(path.join(canvas.temp, 'state.json'), 'utf8')) as {
        presets: { name: string; hiddenQueues?: string[] }[];
      };
      return kept.presets.find(one => one.name === 'Flow A')?.hiddenQueues;
    };
    await expect.poll(hidden).toEqual(['event-a']);
    const picker = page.getByRole('button', { name: /^Board:/ });
    await picker.click();
    await page
      .getByRole('dialog', { name: 'Boards' })
      .getByRole('button', { name: /^Flow B/ })
      .click();
    await expect(queue).toBeVisible();
    await picker.click();
    await page
      .getByRole('dialog', { name: 'Boards' })
      .getByRole('button', { name: /^Flow A/ })
      .click();
    await expect(page.locator('.svelte-flow__node-outside')).toHaveCount(2);
    await expect(queue).toHaveCount(0);
  });
});
