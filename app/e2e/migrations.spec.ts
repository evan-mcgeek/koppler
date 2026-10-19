// A stack written for an older Koppler: read in this Koppler's format straight away, and its file updated only when
// the user asks.
import fs from 'node:fs';
import path from 'node:path';
import { at, expect, STACK, test } from './canvas.ts';

const { koppler: _current, ...rest } = STACK;
const { orders, payments } = STACK.apps;
// Before 0.2.0: each app states its own tunnel to the database.
const older = {
  ...rest,
  apps: {
    ...STACK.apps,
    orders: {
      ...orders,
      prereqs: [{ tunnel: 'aurora.qa.acme.example', port: 5432, what: 'Orders (Postgres)' }],
      envs: { prod: { prereqs: [{ tunnel: 'aurora.prod.acme.example', port: 5432 }] } },
    },
    payments: {
      ...payments,
      prereqs: [{ tunnel: 'aurora.qa.acme.example', port: 5432 }],
      envs: { prod: { prereqs: [{ tunnel: 'aurora.prod.acme.example', port: 5432 }] } },
    },
  },
};
test.use({
  stack: older,
  board: {
    env: 'qa',
    mode: 'auto',
    zoom: 0.8,
    pan: { x: 60, y: 40 },
    nodes: { orders: at(0, 0), payments: at(700, 0) },
    edges: [],
  },
});

test('an older stack shows its databases at once, and its file is updated only from the note', async ({
  page,
  canvas,
}) => {
  const file = path.join(canvas.dir, 'stack', 'stack.json');
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.mkdirSync(path.join(canvas.dir, 'config'), { recursive: true });
  fs.writeFileSync(file, JSON.stringify(older));
  fs.writeFileSync(path.join(canvas.dir, 'config', 'config.json'), JSON.stringify({ stack: path.dirname(file) }));
  const read = () => JSON.parse(fs.readFileSync(file, 'utf8')) as Record<string, unknown>;

  await expect(page.locator('.svelte-flow__node-database')).toHaveText([/Orders/]);
  const note = page.getByRole('note').filter({ hasText: 'written for an older Koppler' });
  await expect(note).toContainText('Teammates then need Koppler 0.2.0 or later');
  await page.screenshot({ path: 'test-results/migrations-note.png' });
  // Read that way, the file is as it was.
  expect(read()['databases']).toBeUndefined();

  await note.getByRole('button', { name: 'Update the file' }).click();
  await expect(note).toBeHidden();
  await expect.poll(() => read()['koppler']).toBe('0.2.0');
  expect(read()['databases']).toEqual({
    orders: {
      name: 'Orders',
      kind: 'postgres',
      tunnel: 'aurora.qa.acme.example',
      port: 5432,
      envs: { prod: { tunnel: 'aurora.prod.acme.example', port: 5432 } },
    },
  });
  await expect(page.locator('.svelte-flow__node-database')).toHaveText([/Orders/]);
});

test('the board file says the format it is written in', async ({ page, canvas }) => {
  const saved = path.join(canvas.temp, 'state.json');
  await page.getByRole('button', { name: 'Arrange' }).click();
  await expect
    .poll(() => (fs.existsSync(saved) ? (JSON.parse(fs.readFileSync(saved, 'utf8')) as { koppler?: string }) : {}))
    .toMatchObject({ koppler: '0.2.0' });
});
