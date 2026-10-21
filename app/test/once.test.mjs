import './sandbox.mjs';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { test } from 'node:test';
import { fileURLToPath } from 'node:url';
import { allowStack } from './allow.mjs';
import { freePorts } from './helpers.mjs';

const entry = path.join(path.dirname(fileURLToPath(import.meta.url)), '..', 'dist', 'koppler.mjs');
const [port] = await freePorts(1);

/** A stack whose API starts after its migration, which runs to completion. */
function sandbox(migrate) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'koppler-once-'));
  const env = { ...process.env, KOPPLER_STATE: dir, KOPPLER_TEMP: dir, KOPPLER_CONFIG_DIR: dir };
  const koppler = (...args) => spawnSync('node', [entry, ...args], { encoding: 'utf8', env });
  process.on('exit', () => koppler('stop', '--all', '--yes'));
  const stack = {
    envs: ['qa'],
    apps: {
      api: { name: 'API', kind: 'other', start: `python3 -m http.server ${port} --bind 127.0.0.1`, url: `http://localhost:${port}`, after: ['migrate'] },
      migrate: { name: 'Migrations', kind: 'other', start: migrate, once: { timeout: 20 } },
    },
  };
  fs.writeFileSync(path.join(dir, 'registry.json'), JSON.stringify(stack));
  allowStack(dir, stack);
  fs.writeFileSync(path.join(dir, 'local.json'), JSON.stringify({ apps: { api: { path: dir }, migrate: { path: dir } } }));
  return { dir, koppler };
}

test('a step that runs to completion finishes before the app that comes after it starts', () => {
  const { dir, koppler } = sandbox('sleep 1; echo migrated > done.txt');
  const up = koppler('up', 'api', 'migrate');
  const out = up.stdout + up.stderr;
  assert.equal(up.status, 0, out);
  assert.ok(out.indexOf('finished migrate (exit code 0)') >= 0, out);
  assert.ok(out.indexOf('finished migrate') < out.indexOf('started api'), out);
  assert.equal(fs.readFileSync(path.join(dir, 'done.txt'), 'utf8'), 'migrated\n');
  assert.doesNotMatch(koppler('status').stdout, /migrate/);
  koppler('stop', '--all', '--yes');
});

test('a step that ends with another exit code stops the run, and the app after it never starts', () => {
  const { koppler } = sandbox('echo "no database"; exit 3');
  const up = koppler('up', 'api', 'migrate');
  assert.notEqual(up.status, 0);
  assert.match(up.stderr, /migrate ended with exit code 3, not 0[\s\S]*no database/);
  assert.doesNotMatch(up.stdout, /started api/);
  assert.match(koppler('status').stdout, /nothing started by koppler/);
});

test('the stack refuses an after that names no app', async () => {
  const { validateStack } = await import('../dist/core/stack.js');
  const problems = validateStack({ envs: ['qa'], apps: { api: { name: 'API', kind: 'other', after: ['nope'] } } });
  assert.ok(problems.includes('apps.api.after[0]: no such app'), problems.join('\n'));
});
