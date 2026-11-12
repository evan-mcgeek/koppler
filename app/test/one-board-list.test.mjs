import './sandbox.mjs';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { test } from 'node:test';
import { fileURLToPath } from 'node:url';

const entry = path.join(path.dirname(fileURLToPath(import.meta.url)), '..', 'dist', 'koppler.mjs');
const app = (name, port) => ({ name, kind: 'node', slug: `acme/${name.toLowerCase()}`, url: `http://localhost:${port}` });

test('a team board is one board: board edit and delete change it in the stack, with no copy of your own', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'koppler-one-list-'));
  const config = path.join(dir, 'config'), temp = path.join(dir, 'temp'), code = path.join(dir, 'code');
  const shop = path.join(config, 'stacks', 'acme-shop');
  for (const folder of [shop, temp, code]) fs.mkdirSync(folder, { recursive: true });
  const stackFile = path.join(shop, 'stack.json');
  fs.writeFileSync(
    stackFile,
    JSON.stringify({
      name: 'Acme Shop',
      envs: ['qa'],
      apps: { web: app('Web', 3000), orders: app('Orders', 5000) },
      presets: [{ name: 'Checkout', version: 1, nodes: {}, edges: [], feature: { request: 'Pay', cards: [], phases: [] } }],
    }),
  );
  const env = { ...process.env, HOME: dir, KOPPLER_STATE: dir, KOPPLER_TEMP: temp, KOPPLER_CONFIG_DIR: config };
  delete env.CLAUDE_CODE_SESSION_ID;
  const koppler = (...args) => spawnSync('node', [entry, ...args], { encoding: 'utf8', env, cwd: dir });
  const team = () => JSON.parse(fs.readFileSync(stackFile, 'utf8')).presets ?? [];
  const state = () => {
    const file = path.join(temp, 'state.json');
    return fs.existsSync(file) ? JSON.parse(fs.readFileSync(file, 'utf8')) : {};
  };
  try {
    assert.equal(koppler('init', '--root', code, '--stack', shop, '--no-fetch').status, 0);
    const edited = koppler('board', 'edit', 'Checkout', '--phase', 'Order', '--step', 'web:orders');
    assert.equal(edited.status, 0, edited.stderr);
    const [board] = team();
    assert.deepEqual(
      board.feature.phases.map(phase => [phase.name, phase.steps.map(step => `${step.from}>${step.to}`)]),
      [['Order', ['web>orders']]],
    );
    assert.equal((state().presets ?? []).length, 0);

    const listed = koppler('use', '--boards');
    assert.equal(listed.stdout.trim().split('\n').length, 1, listed.stdout);
    assert.match(listed.stdout, /^Checkout {2}\(team/);

    const deleted = koppler('board', 'delete', 'Checkout');
    assert.equal(deleted.status, 0, deleted.stderr);
    assert.deepEqual(team(), []);
    assert.equal(state().trash?.[0]?.name, 'Checkout');
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});
