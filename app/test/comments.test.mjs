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

test('board edit comments on a team feature board in the stack, the agent replies, and no copy of your own is made', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'koppler-comments-'));
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
      presets: [
        {
          name: 'Team flow',
          version: 1,
          nodes: {},
          edges: [],
          feature: { request: 'Ordering', cards: [], phases: [{ name: 'Order', steps: [{ from: 'web', to: 'orders', kind: 'call' }] }] },
        },
      ],
    }),
  );
  const env = { ...process.env, HOME: dir, KOPPLER_STATE: dir, KOPPLER_TEMP: temp, KOPPLER_CONFIG_DIR: config };
  delete env.CLAUDE_CODE_SESSION_ID;
  const koppler = (...args) => spawnSync('node', [entry, ...args], { encoding: 'utf8', env, cwd: dir });
  const comments = () =>
    JSON.parse(fs.readFileSync(stackFile, 'utf8')).presets.find(one => one.name === 'Team flow').feature.comments ?? [];
  try {
    assert.equal(koppler('init', '--root', code, '--stack', shop, '--no-fetch').status, 0);
    const opened = koppler('board', 'edit', 'Team flow', '--comment', 'Order:web:orders=Which route?');
    assert.equal(opened.status, 0, opened.stderr);
    assert.match(opened.stdout, /commented on Web to Orders/);
    const [thread] = comments();
    assert.deepEqual(thread.on, { step: { from: 'web', to: 'orders', phase: 'Order' } });
    const replied = koppler('board', 'edit', 'Team flow', '--reply', `${thread.id}=POST /orders, from the basket page.`);
    assert.equal(replied.status, 0, replied.stderr);
    assert.deepEqual(
      comments()[0].thread.map(said => [said.by, said.text]),
      [
        ['you', 'Which route?'],
        ['agent', 'POST /orders, from the basket page.'],
      ],
    );
    assert.equal(koppler('board', 'edit', 'Team flow', '--resolve', thread.id).status, 0);
    assert.equal(comments()[0].resolved, true);
    // Talking about it is no change to the team's board: nothing of yours by its name.
    const state = path.join(temp, 'state.json');
    const own = fs.existsSync(state) ? (JSON.parse(fs.readFileSync(state, 'utf8')).presets ?? []) : [];
    assert.equal(own.some(one => one.name === 'Team flow'), false);
    assert.match(koppler('board', 'edit', 'Team flow', '--comment', 'nope="x"').stderr, /nope is not in the stack/);
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});
