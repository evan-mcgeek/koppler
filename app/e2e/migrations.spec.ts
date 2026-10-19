// A stack written for an older Koppler: read in this Koppler's format and written back with its version, by Koppler
// itself.
import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { at, expect, STACK, test } from './canvas.ts';

const here = path.dirname(fileURLToPath(import.meta.url));
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

test('an older stack is read in this format and written back with its version, with nothing to click', async ({
  page,
  canvas,
}) => {
  const copy = path.join(canvas.temp, 'registry.json');
  const read = (file: string) => JSON.parse(fs.readFileSync(file, 'utf8')) as Record<string, unknown>;
  const named = {
    orders: {
      name: 'Orders',
      kind: 'postgres',
      tunnel: 'aurora.qa.acme.example',
      port: 5432,
      envs: { prod: { tunnel: 'aurora.prod.acme.example', port: 5432 } },
    },
  };
  await expect(page.locator('.svelte-flow__node-database')).toHaveText([/Orders/]);
  await expect(page.getByRole('note')).not.toContainText(['older Koppler']);
  expect(read(copy)).toMatchObject({ koppler: '0.2.0', databases: named });

  // The stack file itself, as the next stack command reads it.
  const file = path.join(canvas.dir, 'stack', 'stack.json');
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.mkdirSync(path.join(canvas.dir, 'config'), { recursive: true });
  fs.writeFileSync(file, JSON.stringify(older));
  fs.writeFileSync(path.join(canvas.dir, 'config', 'config.json'), JSON.stringify({ stack: path.dirname(file) }));
  execFileSync('node', [path.join(here, '..', 'dist', 'koppler.mjs'), 'stack', 'get', 'name'], {
    env: { ...process.env, KOPPLER_CONFIG_DIR: path.join(canvas.dir, 'config'), KOPPLER_TEMP: canvas.temp },
  });
  expect(read(file)).toMatchObject({ koppler: '0.2.0', databases: named });
  expect((read(file)['presets'] as { koppler?: string }[]).map(one => one.koppler)).toEqual(['0.1.0', '0.1.0']);
});

test('the board file says the format it is written in', async ({ page, canvas }) => {
  const saved = path.join(canvas.temp, 'state.json');
  await page.getByRole('button', { name: 'Arrange' }).click();
  await expect
    .poll(() => (fs.existsSync(saved) ? (JSON.parse(fs.readFileSync(saved, 'utf8')) as { koppler?: string }) : {}))
    .toMatchObject({ koppler: '0.2.0' });
});
