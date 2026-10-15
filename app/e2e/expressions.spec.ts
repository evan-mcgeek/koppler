// `{{<app>.<field>}}` in the stack: the board shows the fact it names, and Settings keeps the expression as written.
import fs from 'node:fs';
import path from 'node:path';
import { actions, at, expect, STACK, test } from './canvas.ts';

const { orders } = STACK.apps;
// stack.json holds it as text; the stack's types describe it once filled in.
const port = '{{orders.dbPort}}' as unknown as number;
const stack = {
  ...STACK,
  apps: {
    ...STACK.apps,
    orders: { ...orders, dbPort: 6543, prereqs: [{ tunnel: 'db.qa.acme.example', port, what: 'Database (Postgres)' }] },
  },
};
test.use({
  stack,
  board: { env: 'qa', mode: 'auto', zoom: 1, pan: { x: 120, y: 80 }, nodes: { orders: at(0, 0) }, edges: [] },
});

test('the board fills an expression in, and Settings shows and saves it as written', async ({ page, canvas }) => {
  // The stack file the panel saves to.
  fs.mkdirSync(path.join(canvas.dir, 'stack'), { recursive: true });
  fs.mkdirSync(path.join(canvas.dir, 'config'), { recursive: true });
  const file = path.join(canvas.dir, 'stack', 'stack.json');
  fs.writeFileSync(file, JSON.stringify(stack));
  fs.writeFileSync(path.join(canvas.dir, 'config', 'config.json'), JSON.stringify({ stack: path.dirname(file) }));
  await expect(page.locator('.svelte-flow__node-tunnel')).toContainText('localhost:6543');
  await (await actions(page, 'orders')).getByRole('button', { name: 'Settings for Orders API' }).click();
  const panel = page.getByRole('dialog', { name: 'Orders API' });
  await panel.getByRole('tab', { name: 'Needs first' }).click();
  await panel.getByText('Database (Postgres)').first().click();
  await expect(panel.getByLabel('Port', { exact: true })).toHaveValue('{{orders.dbPort}}');
  await panel.screenshot({ path: 'test-results/expressions-settings.png' });
  const field = panel.getByLabel('Port', { exact: true });
  await field.fill('{{orders.nope}}');
  await field.press('Tab');
  await panel.getByRole('button', { name: 'Save' }).click();
  await expect(panel.getByRole('alert')).toContainText('{{orders.nope}} names no field of an app');
  await field.fill('{{orders.url}}');
  await field.press('Tab');
  await panel.getByRole('button', { name: 'Save' }).click();
  await expect(panel.getByRole('alert')).toContainText('a port number');
  await field.fill('{{orders.port}}');
  await field.press('Tab');
  await panel.getByRole('button', { name: 'Save' }).click();
  await expect(panel.getByRole('status')).toHaveText('Saved');
  const saved = JSON.parse(fs.readFileSync(file, 'utf8')) as typeof stack;
  expect(saved.apps.orders.prereqs).toMatchObject([{ port: '{{orders.port}}' }]);
});
