import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { test } from 'node:test';
import { fileURLToPath } from 'node:url';

const entry = path.join(path.dirname(fileURLToPath(import.meta.url)), '..', 'dist', 'koppler.mjs');

test('koppler restart stops a process and starts it again the way it was started', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'koppler-restart-'));
  const env = { ...process.env, KOPPLER_STATE: dir, KOPPLER_TEMP: dir, KOPPLER_CONFIG_DIR: dir };
  const koppler = (...args) => spawnSync('node', [entry, ...args], { encoding: 'utf8', env });
  process.on('exit', () => koppler('stop', '--all', '--yes'));
  const record = () => JSON.parse(fs.readFileSync(path.join(dir, 'procs', 'tunnel-db-5432.json'), 'utf8'));

  const ran = koppler('run', 'tunnel-db-5432', '--keep-alive', '--', 'sleep', '60');
  assert.equal(ran.status, 0, ran.stdout + ran.stderr);
  const before = record();

  const again = koppler('restart', 'tunnel-db-5432');
  assert.equal(again.status, 0, again.stdout + again.stderr);
  assert.match(again.stdout, /tunnel-db-5432: stopped, started again/);
  const after = record();
  assert.notEqual(after.pid, before.pid);
  assert.deepEqual(after.start.command, before.start.command);
  assert.equal(after.restart, true);
  assert.throws(() => process.kill(-before.pid, 0));

  assert.match(koppler('restart', 'nothing-here').stderr, /nothing-here is not started by koppler/);
});
