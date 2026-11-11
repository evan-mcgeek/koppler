import './sandbox.mjs';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import net from 'node:net';
import os from 'node:os';
import path from 'node:path';
import { test } from 'node:test';
import { fileURLToPath } from 'node:url';

const entry = path.join(path.dirname(fileURLToPath(import.meta.url)), '..', 'dist', 'koppler.mjs');

test('koppler alone starts the canvas, as koppler canvas does; koppler --help still lists the commands', async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'koppler-bare-'));
  // A port already held: the canvas says so and stops there, opening nothing.
  const held = net.createServer();
  await new Promise(done => held.listen(0, '127.0.0.1', done));
  const port = String(held.address().port);
  const env = { ...process.env, HOME: dir, KOPPLER_STATE: dir, KOPPLER_TEMP: dir, KOPPLER_CONFIG_DIR: dir, KOPPLER_PORT: port };
  delete env.CLAUDE_CODE_SESSION_ID;
  const koppler = (...args) => spawnSync('node', [entry, ...args], { encoding: 'utf8', env, cwd: dir });
  try {
    const bare = koppler();
    const canvas = koppler('canvas');
    assert.match(bare.stderr + bare.stdout, new RegExp(`port ${port} is already held`));
    assert.equal(bare.stderr + bare.stdout, canvas.stderr + canvas.stdout);
    assert.equal(bare.status, canvas.status);
    assert.doesNotMatch(bare.stdout, /usage: koppler <command>/);
    assert.match(koppler('--help').stdout, /usage: koppler <command> \[options\]\n\s+koppler alone starts the canvas/);
  } finally {
    held.close();
    fs.rmSync(dir, { recursive: true, force: true });
  }
});
