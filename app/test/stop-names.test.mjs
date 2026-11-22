import './sandbox.mjs';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { test } from 'node:test';

// koppler stop with names: what runs stops, even when one of the names does not run.
const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'koppler-stop-'));
const env = { ...process.env, KOPPLER_STATE: dir, KOPPLER_TEMP: dir, KOPPLER_CONFIG_DIR: dir };
const entry = path.join(path.dirname(fileURLToPath(import.meta.url)), '..', 'dist', 'koppler.mjs');
const koppler = (...args) => {
  const r = spawnSync('node', [entry, ...args], { encoding: 'utf8', env });
  return { out: (r.stdout + r.stderr).trim(), code: r.status };
};
fs.writeFileSync(path.join(dir, 'registry.json'), JSON.stringify({ envs: ['qa'], apps: {} }));
process.on('exit', () => {
  koppler('stop', '--all', '--yes');
  fs.rmSync(dir, { recursive: true, force: true });
});

test('stop stops every name that runs and says which did not, instead of stopping none', () => {
  koppler('run', 'one', '--', 'sleep', '30');
  koppler('run', 'two', '--', 'sleep', '30');
  const stopped = koppler('stop', 'one', 'nope', 'two');
  assert.match(stopped.out, /one: stopped/);
  assert.match(stopped.out, /two: stopped/);
  assert.match(stopped.out, /nope is not started by koppler/);
  // A name that did not run is still an error for a script that checks.
  assert.notEqual(stopped.code, 0);
  assert.doesNotMatch(koppler('status').out, /\bone\b|\btwo\b/);
});
