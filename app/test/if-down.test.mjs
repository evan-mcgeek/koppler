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
const [webPort, otherPort] = await freePorts(2);
const server = port => ({ kind: 'other', start: `python3 -m http.server ${port} --bind 127.0.0.1`, url: `http://localhost:${port}` });

/** Web calls an API that cannot start; another app has nothing to do with either. */
function sandbox(call) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'koppler-ifdown-'));
  const env = { ...process.env, KOPPLER_STATE: dir, KOPPLER_TEMP: dir, KOPPLER_CONFIG_DIR: dir };
  const koppler = (...args) => spawnSync('node', [entry, ...args], { encoding: 'utf8', env });
  process.on('exit', () => koppler('stop', '--all', '--yes'));
  const stack = {
    envs: ['qa'],
    apps: {
      web: { name: 'Web', ...server(webPort), consumes: { api: { how: 'env', env: 'API_URL', ...call } } },
      api: { name: 'API', kind: 'other', start: 'echo "no config"; exit 1', url: 'http://localhost:1' },
      other: { name: 'Other', ...server(otherPort) },
    },
  };
  fs.writeFileSync(path.join(dir, 'registry.json'), JSON.stringify(stack));
  allowStack(dir, stack);
  fs.writeFileSync(path.join(dir, 'local.json'), JSON.stringify({ apps: { web: { path: dir }, api: { path: dir }, other: { path: dir } } }));
  return koppler;
}

test('an app that fails to start keeps only the apps that need it from starting; the rest of the run goes on', () => {
  const koppler = sandbox({});
  const up = koppler('up', 'web', 'api', 'other', '--cable', 'web:api');
  assert.equal(up.status, 1);
  assert.match(up.stdout, /started other/);
  assert.doesNotMatch(up.stdout, /started web/);
  assert.match(up.stderr, /Not everything started:\n {2}API: api exited[^\n]*\n {2}Web: Not started: API did not start\./);
  koppler('stop', '--all', '--yes');
});

test('a call set to start anyway starts its caller when the app it calls does not start', () => {
  const koppler = sandbox({ ifDown: 'start' });
  const up = koppler('up', 'web', 'api', 'other', '--cable', 'web:api');
  assert.equal(up.status, 1);
  assert.match(up.stdout, /started web/);
  assert.match(up.stderr, /Not everything started:\n {2}API: /);
  assert.doesNotMatch(up.stderr, /Web: Not started/);
  koppler('stop', '--all', '--yes');
});
