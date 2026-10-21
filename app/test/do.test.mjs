import './sandbox.mjs';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { test } from 'node:test';
import { fileURLToPath } from 'node:url';
import { allowStack } from './allow.mjs';

const entry = path.join(path.dirname(fileURLToPath(import.meta.url)), '..', 'dist', 'koppler.mjs');
const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'koppler-do-'));
const env = { ...process.env, KOPPLER_STATE: dir, KOPPLER_TEMP: dir, KOPPLER_CONFIG_DIR: dir };
const koppler = (...args) => spawnSync('node', [entry, ...args], { encoding: 'utf8', env, stdio: ['ignore', 'pipe', 'pipe'] });
const stackWith = seed => ({
  envs: ['qa'],
  apps: {
    web: {
      name: 'Web',
      kind: 'other',
      commands: {
        seed: { label: 'Seed', run: seed, args: [{ name: 'COUNT', type: 'number', required: true }] },
        wipe: { label: 'Wipe', run: 'echo wiped', confirm: 'Delete every order?' },
        tour: { label: 'Tour', run: 'true', show: 'canvas' },
        fails: { label: 'Fails', run: 'echo "no database"; exit 2' },
      },
    },
  },
});
const write = stack => fs.writeFileSync(path.join(dir, 'registry.json'), JSON.stringify(stack));
fs.writeFileSync(path.join(dir, 'local.json'), JSON.stringify({ apps: { web: { path: dir } } }));

test("an app's command runs only once the stack's commands are allowed, and again after it changes", () => {
  write(stackWith('echo "seeding $COUNT" > seeded.txt'));
  assert.match(koppler('do', 'web', 'seed', '--arg', 'COUNT=3').stderr, /not allowed yet[\s\S]*koppler doctor --approve/);
  allowStack(dir, stackWith('echo "seeding $COUNT" > seeded.txt'));
  const seeded = koppler('do', 'web', 'seed', '--arg', 'COUNT=3');
  assert.equal(seeded.status, 0, seeded.stderr);
  assert.match(seeded.stdout, /finished web-seed \(exit code 0\)/);
  assert.equal(fs.readFileSync(path.join(dir, 'seeded.txt'), 'utf8'), 'seeding 3\n');
  write(stackWith('echo changed'));
  assert.match(koppler('do', 'web', 'seed', '--arg', 'COUNT=3').stderr, /not allowed yet, or that changed since/);
});

test('what a command asks for is checked, a question needs a yes, and a canvas-only one stays on the canvas', () => {
  write(stackWith('true'));
  allowStack(dir, stackWith('true'));
  assert.match(koppler('do', 'web', 'seed').stderr, /it needs COUNT/);
  assert.match(koppler('do', 'web', 'seed', '--arg', 'COUNT=many').stderr, /COUNT is a number/);
  assert.match(koppler('do', 'web', 'seed', '--arg', 'COUNT=1', '--arg', 'NODE_OPTIONS=x').stderr, /it takes no NODE_OPTIONS/);
  assert.match(koppler('do', 'web', 'wipe').stderr, /not run: Delete every order\? Pass --yes/);
  assert.equal(koppler('do', 'web', 'wipe', '--yes').status, 0);
  assert.match(koppler('do', 'web', 'tour').stderr, /Tour is offered on the canvas only/);
  assert.match(koppler('do', 'web', 'nope').stderr, /Web has no command nope; it has seed, wipe, tour, fails/);
});

test('from the canvas, a command that fails says so in the inbox, with its last lines', () => {
  write(stackWith('true'));
  allowStack(dir, stackWith('true'));
  const failed = koppler('do', 'web', 'fails', '--from-canvas', '--yes');
  assert.equal(failed.status, 1);
  const said = fs.readFileSync(path.join(dir, 'messages.jsonl'), 'utf8').trim().split('\n').map(line => JSON.parse(line));
  const last = said.at(-1).message ?? said.at(-1);
  assert.equal(last.kind, 'failure');
  assert.match(last.title, /web-fails ended with exit code 2, not 0/);
  assert.match(JSON.stringify(last.sections), /no database/);
});
