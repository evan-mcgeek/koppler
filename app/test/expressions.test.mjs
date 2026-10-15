import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { test } from 'node:test';
import { fileURLToPath } from 'node:url';
import { resolveExpressions } from '../dist/core/expressions.js';
import { allowStack } from './allow.mjs';
import { until } from './helpers.mjs';

const entry = path.join(path.dirname(fileURLToPath(import.meta.url)), '..', 'dist', 'koppler.mjs');

test("an app starts with another app's fact filled in, and a stack check names an expression that points nowhere", async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'koppler-expressions-'));
  const env = { ...process.env, KOPPLER_STATE: dir, KOPPLER_TEMP: dir, KOPPLER_CONFIG_DIR: dir };
  const koppler = (...args) => spawnSync('node', [entry, ...args], { encoding: 'utf8', env });
  process.on('exit', () => koppler('stop', '--all', '--yes'));
  const repo = path.join(dir, 'worker');
  fs.mkdirSync(repo);
  const stack = {
    envs: ['qa'],
    apps: {
      'orders-api': { name: 'Orders API', kind: 'other', url: 'http://localhost:5001' },
      worker: { name: 'Worker', kind: 'other', start: 'echo calls {{orders-api.host}}:{{orders-api.port}}; exec sleep 30' },
    },
  };
  fs.writeFileSync(path.join(dir, 'registry.json'), JSON.stringify(stack));
  allowStack(dir, resolveExpressions(stack));
  fs.writeFileSync(path.join(dir, 'local.json'), JSON.stringify({ apps: { worker: { path: repo } } }));

  const ran = koppler('run', 'worker');
  assert.equal(ran.status, 0, ran.stdout + ran.stderr);
  await until('it says where it calls', () => koppler('logs', 'worker').stdout.includes('calls localhost:5001'));
  // The stack keeps the expression.
  assert.match(fs.readFileSync(path.join(dir, 'registry.json'), 'utf8'), /\{\{orders-api\.port\}\}/);

  const file = path.join(dir, 'stack.json');
  fs.writeFileSync(file, JSON.stringify({ ...stack, apps: { ...stack.apps, worker: { name: 'Worker', url: 'http://localhost:{{orders.port}}' } } }));
  const checked = koppler('stack', 'check', file);
  assert.equal(checked.status, 1);
  assert.match(checked.stdout + checked.stderr, /apps\.worker\.url: \{\{orders\.port\}\} names no field of an app/);
});
