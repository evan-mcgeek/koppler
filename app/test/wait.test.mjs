import assert from 'node:assert/strict';
import { spawn, spawnSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { test } from 'node:test';
import { fileURLToPath } from 'node:url';
import { freePorts } from './helpers.mjs';

const entry = path.join(path.dirname(fileURLToPath(import.meta.url)), '..', 'dist', 'koppler.mjs');
const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'koppler-wait-'));
const env = { ...process.env, KOPPLER_STATE: dir, KOPPLER_TEMP: dir, KOPPLER_CONFIG_DIR: dir };
const koppler = (...args) => spawnSync('node', [entry, ...args], { encoding: 'utf8', env });
process.on('exit', () => koppler('stop', '--all', '--yes'));
const [port] = await freePorts(1);
const server = `setTimeout(() => require('http').createServer((q, s) => s.end('ok')).listen(${port}), 1500)`;

test('wait names each app that is not there yet, and fails at its timeout', () => {
  const waited = koppler('wait', 'web', '--healthy', '--timeout', '1');
  assert.equal(waited.status, 1);
  assert.match(waited.stdout, /web: not started/);
  assert.match(waited.stderr, /not healthy: timed out after 1s/);
  assert.match(koppler('wait', 'web', '--up', '--down').stderr, /usage: koppler wait/);
});

test('wait holds until an app answers on its port, then until it is down', async () => {
  const started = spawn('node', [entry, 'run', 'web', '--port', String(port), '--', 'node', '-e', server], { env, stdio: 'ignore' });
  const waited = koppler('wait', 'web', '--healthy', '--timeout', '30', '--json');
  assert.equal(waited.status, 0, waited.stderr);
  assert.deepEqual(JSON.parse(waited.stdout), { goal: 'healthy', met: true, why: null, apps: { web: 'healthy' } });
  await new Promise(resolve => started.once('exit', resolve));
  koppler('stop', 'web');
  const down = koppler('wait', 'web', '--down', '--timeout', '10');
  assert.equal(down.status, 0, down.stderr);
  assert.match(down.stdout, /web: (exited|not started)/);
});

test('an app that exits while waited for fails the wait at once, with its last lines', () => {
  assert.equal(koppler('run', 'crashy', '--', 'sh', '-c', 'sleep 1; echo boom; exit 1').status, 0);
  const begun = Date.now();
  const waited = koppler('wait', 'crashy', '--healthy', '--timeout', '60');
  assert.equal(waited.status, 1);
  assert.ok(Date.now() - begun < 15000);
  assert.match(waited.stdout, /crashy: exited/);
  assert.match(waited.stderr, /not healthy: crashy exited[\s\S]*boom/);
});
