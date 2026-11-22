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

// A run never stops an app it cannot wire again: one whose new cable the stack only found, with no way to point it.
const entry = path.join(path.dirname(fileURLToPath(import.meta.url)), '..', 'dist', 'koppler.mjs');
const [webPort, apiPort, payPort] = await freePorts(3);
const server = port => ({ kind: 'other', start: `python3 -m http.server ${port} --bind 127.0.0.1`, url: `http://localhost:${port}` });
const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'koppler-unwired-'));
const env = { ...process.env, KOPPLER_STATE: dir, KOPPLER_TEMP: dir, KOPPLER_CONFIG_DIR: dir };
const koppler = (...args) => spawnSync('node', [entry, ...args], { encoding: 'utf8', env });
process.on('exit', () => {
  koppler('stop', '--all', '--yes');
  fs.rmSync(dir, { recursive: true, force: true });
});
const stack = {
  envs: ['qa'],
  apps: {
    web: { name: 'Web', ...server(webPort), consumes: { api: { how: 'env', env: 'API_URL' } } },
    api: { name: 'API', ...server(apiPort), deployedUrl: 'https://api.qa.acme.example' },
    pay: { name: 'Payments', ...server(payPort), deployedUrl: 'https://pay.qa.acme.example' },
  },
  // API's call to Payments was found in its code, but how a local run points it elsewhere is not recorded.
  found: { api: { pay: '.env:1' } },
};
fs.writeFileSync(path.join(dir, 'registry.json'), JSON.stringify(stack));
allowStack(dir, stack);
fs.writeFileSync(path.join(dir, 'local.json'), JSON.stringify({ apps: { web: { path: dir }, api: { path: dir }, pay: { path: dir } } }));
const pid = name => Number(JSON.parse(fs.readFileSync(path.join(dir, 'procs', `${name}.json`), 'utf8')).pid);

test('a restart whose new cable cannot be wired keeps the app running and says what is missing', () => {
  assert.equal(koppler('up', 'web', 'api', '--cable', 'web:api').status, 0);
  const before = pid('api');
  const up = koppler('up', 'web', 'api', 'pay', '--cable', 'web:api', '--cable', 'api:pay');
  assert.equal(up.status, 3, up.stdout + up.stderr);
  assert.match(up.stdout, /started pay/);
  assert.doesNotMatch(up.stdout, /api: stopped/);
  assert.equal(pid('api'), before);
  assert.match(up.stdout, /API -> local Payments: point it at http:\/\/localhost:\d+ \(how it picks the address is not recorded yet\); API runs without it: restart it after the change/);
});
