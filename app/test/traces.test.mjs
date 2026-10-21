import './sandbox.mjs';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { test } from 'node:test';
import { fileURLToPath } from 'node:url';
import { allowStack } from './allow.mjs';
import { until } from './helpers.mjs';

const entry = path.join(path.dirname(fileURLToPath(import.meta.url)), '..', 'dist', 'koppler.mjs');

test('while traces are collected, an app Koppler starts is told where to send them, under its own name', async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'koppler-traces-'));
  const env = { ...process.env, KOPPLER_STATE: dir, KOPPLER_TEMP: dir, KOPPLER_CONFIG_DIR: dir };
  const koppler = (...args) => spawnSync('node', [entry, ...args], { encoding: 'utf8', env });
  process.on('exit', () => koppler('stop', '--all', '--yes'));
  const stack = { envs: ['qa'], apps: { web: { name: 'Web', kind: 'other', start: 'env > env.txt; exec sleep 60' } } };
  fs.writeFileSync(path.join(dir, 'registry.json'), JSON.stringify(stack));
  allowStack(dir, stack);
  fs.writeFileSync(path.join(dir, 'local.json'), JSON.stringify({ apps: { web: { path: dir } } }));
  const settings = () => fs.readFileSync(path.join(dir, 'env.txt'), 'utf8');

  assert.equal(koppler('run', 'web').status, 0);
  await until('web has started', () => fs.existsSync(path.join(dir, 'env.txt')) && settings().length > 0);
  assert.doesNotMatch(settings(), /OTEL_/);
  assert.match(koppler('traces', 'open').stderr, /traces are not being collected: koppler traces start/);
  koppler('stop', 'web');
  fs.rmSync(path.join(dir, 'env.txt'));

  // A stand-in for the collector: what counts is that it runs.
  assert.equal(koppler('run', 'koppler-traces', '--', 'sleep', '60').status, 0);
  assert.equal(koppler('run', 'web').status, 0);
  await until('web has started again', () => fs.existsSync(path.join(dir, 'env.txt')) && settings().includes('OTEL_'));
  assert.match(settings(), /^OTEL_EXPORTER_OTLP_ENDPOINT=http:\/\/localhost:4318$/m);
  assert.match(settings(), /^OTEL_EXPORTER_OTLP_PROTOCOL=http\/protobuf$/m);
  assert.match(settings(), /^OTEL_SERVICE_NAME=web$/m);
});
