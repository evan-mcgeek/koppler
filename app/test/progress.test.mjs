import './sandbox.mjs';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { allowStack } from './allow.mjs';
import { test } from 'node:test';

let dir, here, koppler, progress;
test('koppler up writes each app\'s steps for its card as it goes; the step a failed run stopped on is marked failed.', async () => {
  here = path.dirname(fileURLToPath(import.meta.url)), dir = fs.mkdtempSync(path.join(os.tmpdir(), 'koppler-progress-'));
  const env = { ...process.env, KOPPLER_STATE: dir, KOPPLER_TEMP: dir, KOPPLER_CONFIG_DIR: dir, KOPPLER_EARLY_LOG: '1' };
  koppler = (...args) => { const r = spawnSync('node', [path.join(here, '..', 'dist', 'koppler.mjs'), ...args], { encoding: 'utf8', env, timeout: 60000 }); return { out: (r.stdout + r.stderr).trim(), code: r.status }; };
  fs.mkdirSync(path.join(dir, 'repo'));
  const serve = port => `node -e "require('http').createServer((q,s)=>s.end('ok')).listen(${port})"`;
  const stack = { envs: ['qa'], apps: {
    api: { name: 'API', kind: 'other', slug: 'x/api', url: 'http://localhost:5811', start: serve(5811) },
    web: { name: 'Web', kind: 'other', slug: 'x/web', url: 'http://localhost:5812', start: 'exit 1' },
    app: { name: 'App', kind: 'other', slug: 'x/app', start: 'true' },
  } };
  fs.writeFileSync(path.join(dir, 'registry.json'), JSON.stringify(stack));
  allowStack(dir, stack);
  fs.writeFileSync(path.join(dir, 'local.json'), JSON.stringify({ apps: { api: { path: path.join(dir, 'repo') }, web: { path: path.join(dir, 'repo') } } }));
  fs.writeFileSync(path.join(dir, 'history.jsonl'), JSON.stringify({ id: 'prog0001', at: new Date().toISOString(), kind: 'run', env: 'qa', mode: 'auto', nodes: { api: { branch: '', run: 'cli' }, web: { branch: '', run: 'cli' }, app: { branch: '', run: 'ide' } }, edges: [], plan: {} }) + '\n');

  const r = koppler('up', '--run', 'prog0001');
  process.on('exit', () => { koppler('down'); fs.rmSync(dir, { recursive: true, force: true }); });
  assert.notEqual(r.code, 0, r.out);
  progress = JSON.parse(fs.readFileSync(path.join(dir, 'progress.json'), 'utf8'));
  assert.equal(progress.run, 'prog0001');
  // Started, then its first seconds read: nothing wrong in them.
  assert.deepEqual(progress.apps.api, [
    { label: 'Start', state: 'done', detail: 'Running.' },
    { label: 'First 1 s', state: 'done', detail: 'No errors in its first 1 s.' },
  ]);
  assert.equal(progress.apps.web[0].state, 'failed');
  assert.match(progress.apps.web[0].detail, /web exited right away/);
  assert.deepEqual(progress.apps.app, [{ label: 'Start', state: 'user', detail: 'Start it in your IDE.' }]);
});

test('A Stop clears it.', async () => {
  koppler('down');
  assert.equal(fs.existsSync(path.join(dir, 'progress.json')), false);
});

test('An app whose first seconds log an error says so on its card, with the line, and is left for the agent.', async () => {
  const d = fs.mkdtempSync(path.join(os.tmpdir(), 'koppler-early-'));
  const env = { ...process.env, KOPPLER_STATE: d, KOPPLER_TEMP: d, KOPPLER_CONFIG_DIR: d, KOPPLER_EARLY_LOG: '1' };
  const run = (...args) => { const r = spawnSync('node', [path.join(here, '..', 'dist', 'koppler.mjs'), ...args], { encoding: 'utf8', env, timeout: 60000 }); return { out: (r.stdout + r.stderr).trim(), code: r.status }; };
  fs.mkdirSync(path.join(d, 'repo'));
  const stack = { envs: ['qa'], apps: {
    api: { name: 'API', kind: 'other', slug: 'x/api', url: 'http://localhost:5813', start: `node -e "require('http').createServer((q,s)=>s.end('ok')).listen(5813); console.error('Unhandled exception: no connection string named DB')"` },
  } };
  fs.writeFileSync(path.join(d, 'registry.json'), JSON.stringify(stack));
  allowStack(d, stack);
  fs.writeFileSync(path.join(d, 'local.json'), JSON.stringify({ apps: { api: { path: path.join(d, 'repo') } } }));
  fs.writeFileSync(path.join(d, 'history.jsonl'), JSON.stringify({ id: 'early001', at: new Date().toISOString(), kind: 'run', env: 'qa', mode: 'auto', nodes: { api: { branch: '', run: 'cli' } }, edges: [], plan: {} }) + '\n');
  const r = run('up', '--run', 'early001');
  try {
    assert.equal(r.code, 3, r.out);
    assert.match(r.out, /API: Its log shows problems in its first 1 s\.[\s\S]*Unhandled exception: no connection string named DB/);
    const steps = JSON.parse(fs.readFileSync(path.join(d, 'progress.json'), 'utf8')).apps.api;
    assert.equal(steps.at(-1).label, 'First 1 s');
    assert.equal(steps.at(-1).state, 'failed');
    assert.match(steps.at(-1).detail, /no connection string named DB/);
  } finally {
    run('down');
    fs.rmSync(d, { recursive: true, force: true });
  }
});
