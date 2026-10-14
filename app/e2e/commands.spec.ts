// An app's commands from the stack (Seed, Migrate) are buttons on its card; one that asks for values or a yes opens a dialog.
import fs from 'node:fs';
import path from 'node:path';
import { actions, at, expect, STACK, test } from './canvas.ts';

const { orders } = STACK.apps;
test.use({
  stack: {
    ...STACK,
    apps: {
      ...STACK.apps,
      orders: {
        ...orders,
        commands: {
          seed: {
            label: 'Seed',
            icon: 'sprout',
            run: 'echo seeding',
            args: [{ name: 'COUNT', label: 'How many orders', type: 'number', required: true }],
          },
          reset: { label: 'Reset', icon: 'trash', run: 'echo reset', confirm: 'Delete every order?' },
          cli: { label: 'Only here', run: 'true', show: 'cli' },
        },
      },
    },
  },
  board: { env: 'qa', mode: 'auto', zoom: 1, pan: { x: 60, y: 120 }, nodes: { orders: at(0, 0) }, edges: [] },
});

test("a card offers its app's commands; a command asks for its values, and the inbox says how it ended", async ({
  page,
  canvas,
}) => {
  const bar = await actions(page, 'orders');
  await expect(bar.getByRole('button', { name: 'Reset on Orders API' })).toBeVisible();
  await expect(bar.getByRole('button', { name: 'Only here on Orders API' })).toHaveCount(0);
  await bar.getByRole('button', { name: 'Seed on Orders API' }).click();
  const dialog = page.getByRole('dialog', { name: 'Seed on Orders API' });
  await dialog.getByLabel('How many orders').fill('25');
  await page.screenshot({ path: 'test-results/next-command.png' });
  const sent = page.waitForRequest(request => request.url().includes('/app-command'));
  await dialog.getByRole('button', { name: 'Seed' }).click();
  expect((await sent).postDataJSON()).toEqual({ app: 'orders', command: 'seed', args: { COUNT: '25' } });
  await expect(page.getByRole('status').filter({ hasText: 'Seed started on Orders API' })).toBeVisible();
  // The stack's commands are not allowed in this test: koppler do refuses, and says so in the inbox.
  const inbox = path.join(canvas.temp, 'messages.jsonl');
  await expect
    .poll(() => (fs.existsSync(inbox) ? fs.readFileSync(inbox, 'utf8') : ''), { timeout: 15_000 })
    .toMatch(/Seed is a command from the stack that you have not allowed yet/);
});
