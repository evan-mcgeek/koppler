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
const feature = (request, from, to) => ({
  request,
  cards: [],
  phases: [{ name: 'Look', steps: [{ from, to, kind: 'call', note: 'Asks for the list' }] }],
});

test('export --board writes one board of your own, or the team one by that name, and refuses one that is no feature board', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'koppler-export-'));
  const config = path.join(dir, 'config'), temp = path.join(dir, 'temp'), code = path.join(dir, 'code');
  const shop = path.join(config, 'stacks', 'acme-shop');
  for (const folder of [shop, temp, code]) fs.mkdirSync(folder, { recursive: true });
  const write = (file, value) => fs.writeFileSync(file, JSON.stringify(value));
  write(path.join(shop, 'stack.json'), {
    name: 'Acme Shop',
    envs: ['qa'],
    apps: { web: app('Web', 3000), orders: app('Orders', 5000) },
    presets: [
      { name: 'Team flow', version: 1, nodes: {}, edges: [], feature: feature('Team request', 'web', 'orders') },
      { name: 'Everyday', version: 1, nodes: { web: { run: 'cli' } }, edges: [] },
    ],
  });
  const env = { ...process.env, HOME: dir, KOPPLER_STATE: dir, KOPPLER_TEMP: temp, KOPPLER_CONFIG_DIR: config };
  delete env.CLAUDE_CODE_SESSION_ID;
  const koppler = (...args) => spawnSync('node', [entry, ...args], { encoding: 'utf8', env, cwd: dir });
  try {
    assert.equal(koppler('init', '--root', code, '--stack', shop, '--no-fetch').status, 0);
    const mine = { name: 'My look', version: 1, nodes: {}, edges: [], feature: feature('Mine only', 'orders', 'web') };
    write(path.join(temp, 'state.json'), { presets: [mine] });

    const own = koppler('export', 'mine.html', '--board', 'my look');
    assert.equal(own.status, 0, own.stderr);
    assert.match(own.stdout, /WROTE .*mine\.html: 1 flow\n/);
    const page = fs.readFileSync(path.join(dir, 'mine.html'), 'utf8');
    assert.match(page, /Mine only/);
    assert.doesNotMatch(page, /Team request/);

    const team = koppler('export', '--board', 'Team flow');
    assert.equal(team.status, 0, team.stderr);
    assert.match(fs.readFileSync(path.join(dir, 'acme-shop-team-flow-flows.html'), 'utf8'), /Team request/);

    // --env prints the environment it is about on the page; one the stack does not have is refused.
    const onQa = koppler('export', 'qa.html', '--board', 'Team flow', '--env', 'qa');
    assert.equal(onQa.status, 0, onQa.stderr);
    assert.match(fs.readFileSync(path.join(dir, 'qa.html'), 'utf8'), /"env":"qa"/);
    assert.match(koppler('export', '--board', 'Team flow', '--env', 'prod').stderr, /prod is not an environment of the stack: qa/);

    assert.match(koppler('export', '--board', 'Everyday').stderr, /Everyday is not a feature board/);
    assert.match(koppler('export', '--board', 'Nope').stderr, /No board called "Nope"\. Boards with a feature: My look, Team flow/);
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});
