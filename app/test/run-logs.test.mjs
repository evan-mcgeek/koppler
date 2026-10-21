import './sandbox.mjs';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { test } from 'node:test';
import { fileURLToPath } from 'node:url';
import { allowStack } from './allow.mjs';

const entry = path.join(path.dirname(fileURLToPath(import.meta.url)), '..', 'dist', 'koppler.mjs');
const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'koppler-runlogs-'));
const env = { ...process.env, KOPPLER_STATE: dir, KOPPLER_TEMP: dir, KOPPLER_CONFIG_DIR: dir };
const koppler = (...args) => spawnSync('node', [entry, ...args], { encoding: 'utf8', env });
process.on('exit', () => koppler('stop', '--all', '--yes'));
const stack = { envs: ['qa'], apps: { web: { name: 'Web', kind: 'other', start: 'echo "serving the first run"; exec sleep 60' } } };
fs.writeFileSync(path.join(dir, 'registry.json'), JSON.stringify(stack));
allowStack(dir, stack);
fs.writeFileSync(path.join(dir, 'local.json'), JSON.stringify({ apps: { web: { path: dir } } }));
const record = id =>
  fs.appendFileSync(
    path.join(dir, 'history.jsonl'),
    `${JSON.stringify({ id, at: new Date().toISOString(), kind: 'run', env: 'qa', mode: 'auto', nodes: { web: { branch: '', run: 'cli' } }, edges: [], plan: {} })}\n`,
  );

test("a run's app logs are kept when the next run takes its place, shown by run, and pinned to stay", () => {
  record('runone01');
  assert.equal(koppler('up', '--run', 'runone01').status, 0);
  record('runtwo02');
  assert.equal(koppler('up', '--run', 'runtwo02').status, 0);
  const kept = koppler('logs', 'web', '--run', 'runone01');
  assert.equal(kept.status, 0, kept.stderr);
  assert.match(kept.stdout, /serving the first run/);
  assert.match(koppler('logs', 'web', '--run', 'runtwo02').stderr, /run runtwo02 kept no log of web/);
  const told = JSON.parse(koppler('history', '--json').stdout);
  assert.deepEqual(told.find(run => run.id === 'runone01').logs, ['web']);

  assert.match(koppler('history', 'pin', 'runone01').stdout, /Kept: run runone01's logs stay/);
  // The newest 20 runs keep their logs; a pinned one stays among the oldest.
  const runs = path.join(dir, 'runs');
  const old = new Date(Date.now() - 86_400_000);
  fs.utimesSync(path.join(runs, 'runone01'), old, old);
  for (let n = 0; n < 21; n++) fs.mkdirSync(path.join(runs, `filler${String(n).padStart(2, '0')}`));
  fs.mkdirSync(path.join(runs, 'oldest99'));
  fs.utimesSync(path.join(runs, 'oldest99'), old, old);
  koppler('history', 'unpin', 'runtwo02');
  assert.ok(fs.existsSync(path.join(runs, 'runone01')));
  assert.equal(fs.existsSync(path.join(runs, 'oldest99')), false);
  assert.match(koppler('history', 'pin', 'nope0000').stderr, /no run nope0000/);
});
