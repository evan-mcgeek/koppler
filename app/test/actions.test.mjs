import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { execFileSync, spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { readActions, updateActions } from '../dist/actions.mjs';

const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'koppler-actions-')), file = path.join(dir, 'actions.json');

// No log yet, or an empty one, is an empty list; entries are added under the lock and written whole.
assert.deepEqual(readActions(file), []);
updateActions(file, log => { log.push({ kind: 'edit', app: 'a' }); });
updateActions(file, log => { log.push({ kind: 'edit', app: 'b' }); });
assert.deepEqual(readActions(file).map(a => a.app), ['a', 'b']);
assert.equal(fs.existsSync(`${file}.lock`), false);
assert.deepEqual(fs.readdirSync(dir).filter(f => f.endsWith('.tmp')), []);

// A damaged log is never taken as empty: reading throws, a copy is kept, and nothing is written over it.
const damaged = '[{"kind":"edit","app":"a"},{"kind":"env-fi';
fs.writeFileSync(file, damaged);
assert.throws(() => updateActions(file, log => { log.push({ kind: 'checkout' }); }), /damaged/);
assert.equal(fs.readFileSync(file, 'utf8'), damaged);
assert.ok(fs.readdirSync(dir).some(f => f.startsWith('actions.json.damaged-')));
assert.equal(fs.existsSync(`${file}.lock`), false);

// A lock left by a process that died is taken over.
fs.writeFileSync(file, '[]');
fs.mkdirSync(`${file}.lock`); const old = new Date(Date.now() - 60000); fs.utimesSync(`${file}.lock`, old, old);
updateActions(file, log => { log.push({ kind: 'edit', app: 'c' }); });
assert.deepEqual(readActions(file).map(a => a.app), ['c']);

// End to end: koppler switch with a damaged log refuses, keeps the log and the branch as they were.
const repo = path.join(dir, 'repo'), git = (...a) => execFileSync('git', ['-C', repo, ...a], { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] }).trim();
fs.mkdirSync(repo); git('init', '-q', '-b', 'develop'); git('config', 'user.email', 't@t'); git('config', 'user.name', 't');
fs.writeFileSync(path.join(repo, 'f'), 'a'); git('add', '.'); git('commit', '-qm', 'one'); git('branch', 'feature');
fs.writeFileSync(path.join(dir, 'registry.json'), JSON.stringify({ envs: ['qa'], apps: { api: { name: 'API' } } }));
fs.writeFileSync(path.join(dir, 'local.json'), JSON.stringify({ apps: { api: { path: repo } } }));
fs.writeFileSync(file, damaged);
const r = spawnSync('node', [path.join(path.dirname(fileURLToPath(import.meta.url)), '..', 'dist', 'koppler.mjs'), 'switch', 'api', 'feature'], { encoding: 'utf8', env: { ...process.env, KOPPLER_STATE: dir, KOPPLER_TEMP: dir, KOPPLER_CONFIG_DIR: dir } });
assert.equal(r.status, 1);
assert.match(r.stderr, /^koppler: the action log .* is damaged/);
assert.equal(fs.readFileSync(file, 'utf8'), damaged);
assert.equal(git('branch', '--show-current'), 'develop');
console.log('actions tests ok');
