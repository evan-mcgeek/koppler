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
const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'koppler-watch-'));
const repo = path.join(dir, 'repo');
fs.mkdirSync(path.join(repo, 'src'), { recursive: true });
fs.mkdirSync(path.join(repo, 'generated'));
const env = { ...process.env, KOPPLER_STATE: dir, KOPPLER_TEMP: dir, KOPPLER_CONFIG_DIR: dir };
const koppler = (...args) => spawnSync('node', [entry, ...args], { encoding: 'utf8', env });
process.on('exit', () => koppler('stop', '--all', '--yes'));
const stack = {
  envs: ['qa'],
  apps: { web: { name: 'Web', kind: 'other', start: 'echo "started with $GREETING"; exec sleep 60', watch: { ignore: ['generated'] } } },
};
fs.writeFileSync(path.join(dir, 'registry.json'), JSON.stringify(stack));
allowStack(dir, stack);
fs.writeFileSync(path.join(dir, 'local.json'), JSON.stringify({ apps: { web: { path: repo } } }));
const pid = () => JSON.parse(fs.readFileSync(path.join(dir, 'procs', 'web.json'), 'utf8')).pid;
const record = (id, watch) =>
  fs.appendFileSync(
    path.join(dir, 'history.jsonl'),
    `${JSON.stringify({ id, at: new Date().toISOString(), kind: 'run', env: 'qa', mode: 'auto', nodes: { web: { branch: '', run: 'cli', ...(watch && { watch: true }) } }, edges: [], plan: {} })}\n`,
  );

test('a card set to restart on change restarts its app when a file in its clone changes, as it was started', async () => {
  record('watch001', true);
  const up = koppler('up', '--run', 'watch001');
  assert.equal(up.status, 0, up.stdout + up.stderr);
  assert.match(koppler('status').stdout, /web-watch\s+running/);
  const first = pid();
  // A change under an ignored path, and in the tools' own folders, leaves it running.
  fs.writeFileSync(path.join(repo, 'generated', 'out.txt'), 'x');
  await new Promise(resolve => setTimeout(resolve, 2500));
  assert.equal(pid(), first);
  fs.writeFileSync(path.join(repo, 'src', 'main.txt'), 'changed');
  await until('the app restarts', () => fs.existsSync(path.join(dir, 'procs', 'web.json')) && pid() !== first, 20000);
  assert.match(koppler('logs', 'web-watch').stdout, /src\/main\.txt changed: restarting web/);

  // Set back on the card, the next run stops the watcher and keeps the app.
  record('watch002', false);
  assert.equal(koppler('up', '--run', 'watch002').status, 0);
  assert.doesNotMatch(koppler('status').stdout, /web-watch\s+running/);
  assert.match(koppler('status').stdout, /web\s+running/);
});
