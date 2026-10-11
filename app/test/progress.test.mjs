import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { allowStack } from './allow.mjs';

// koppler up writes each app's steps for its card as it goes; the step a failed run stopped on is marked failed.
const here = path.dirname(fileURLToPath(import.meta.url)), dir = fs.mkdtempSync(path.join(os.tmpdir(), 'koppler-progress-'));
const env = { ...process.env, KOPPLER_STATE: dir, KOPPLER_TEMP: dir, KOPPLER_CONFIG_DIR: dir };
const koppler = (...args) => { const r = spawnSync('node', [path.join(here, '..', 'dist', 'koppler.mjs'), ...args], { encoding: 'utf8', env, timeout: 60000 }); return { out: (r.stdout + r.stderr).trim(), code: r.status }; };
fs.mkdirSync(path.join(dir, 'repo'));
const serve = port => `node -e "require('http').createServer((q,s)=>s.end('ok')).listen(${port})"`;
const stack = { envs: ['qa'], apps: {
  api: { name: 'API', kind: 'other', slug: 'x/api', url: 'http://localhost:5811', start: serve(5811) },
  web: { name: 'Web', kind: 'other', slug: 'x/web', url: 'http://localhost:5812', start: 'exit 1' },
  app: { name: 'App', kind: 'other', slug: 'x/app', start: 'true' },
} };
fs.writeFileSync(path.join(dir, 'registry.js'), `window.REGISTRY = ${JSON.stringify(stack)};`);
allowStack(dir, stack);
fs.writeFileSync(path.join(dir, 'local.js'), `window.LOCAL = ${JSON.stringify({ apps: { api: { path: path.join(dir, 'repo') }, web: { path: path.join(dir, 'repo') } } })};`);
fs.writeFileSync(path.join(dir, 'history.jsonl'), JSON.stringify({ id: 'prog0001', at: new Date().toISOString(), kind: 'run', env: 'qa', mode: 'auto', nodes: { api: { branch: '', run: 'cli' }, web: { branch: '', run: 'cli' }, app: { branch: '', run: 'ide' } }, edges: [], plan: {} }) + '\n');

const r = koppler('up', '--run', 'prog0001');
process.on('exit', () => { koppler('down'); fs.rmSync(dir, { recursive: true, force: true }); });
assert.notEqual(r.code, 0, r.out);
const progress = JSON.parse(fs.readFileSync(path.join(dir, 'progress.json'), 'utf8'));
assert.equal(progress.run, 'prog0001');
assert.deepEqual(progress.apps.api, [{ label: 'Start', state: 'done', detail: 'Running.' }]);
assert.equal(progress.apps.web[0].state, 'failed');
assert.match(progress.apps.web[0].detail, /stopped here/);
assert.deepEqual(progress.apps.app, [{ label: 'Start', state: 'user', detail: 'Start it in your IDE.' }]);
// A Stop clears it.
koppler('down');
assert.equal(fs.existsSync(path.join(dir, 'progress.json')), false);
console.log('progress tests ok');
