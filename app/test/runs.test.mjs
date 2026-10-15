import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { readRuns, runRecord } from '../dist/engine/history.js';
import { strays } from '../dist/engine/runs.js';
import { test } from 'node:test';

const here = path.dirname(fileURLToPath(import.meta.url));
const send = (id, nodes, edges = [], extra = {}) => ({ tag: 'koppler', at: `2026-01-01T00:00:0${id.at(-1)}Z`, data: { id, env: 'qa', mode: 'auto', nodes, edges, evil: '<script>', plan: { starts: nodes.map(n => ({ id: n.id, why: [] })), restarts: [], stops: [], keeps: [{ id: '../bad' }] }, ...extra } });

let add, dir, done, env, koppler, lines, rec;
test('Only known fields are kept, and a prompt without a run id is not a run.', async () => {
  rec = runRecord(send('run0001', [{ id: 'api', run: 'cli', branch: null, extra: 1 }, { id: 'bad id', run: 'cli' }], [{ from: 'api', to: 'ghost' }]));
  assert.deepEqual(rec, { id: 'run0001', at: '2026-01-01T00:00:01Z', kind: 'run', env: 'qa', mode: 'auto', nodes: { api: { branch: '', run: 'cli' } }, edges: [], plan: { starts: [{ id: 'api', why: [] }], restarts: [], stops: [], keeps: [] } });
  assert.equal(runRecord({ tag: 'koppler', data: { nodes: [] } }), null);
});

test('The card\'s choices koppler up acts on are kept: tunnels off, how uncommitted changes move, queues run locally.', async () => {
  assert.deepEqual(runRecord(send('run0009', [{ id: 'api', run: 'cli', tunnels: false, changes: 'take-along' }, { id: 'web', run: 'cli', tunnels: true, changes: 'rm -rf' }], [], { queues: { thumbs: 'local', other: 'deployed', 'bad id': 'local' } })).nodes, { api: { branch: '', run: 'cli', tunnels: false, changes: 'take-along' }, web: { branch: '', run: 'cli' } });
});

test('An app that keeps the deployed queues, or was asked to restart, is stored as such: the engine reads the stored run.', async () => {
  assert.deepEqual(runRecord(send('run0009', [{ id: 'api', run: 'cli', queues: true, restart: true }, { id: 'web', run: 'cli', queues: 'yes', restart: 'yes' }], [])).nodes, { api: { branch: '', run: 'cli', queues: true, restart: true }, web: { branch: '', run: 'cli' } });
  assert.deepEqual(runRecord(send('run0009', [], [], { queues: { thumbs: 'local', other: 'deployed', 'bad id': 'local' } })).queues, { thumbs: 'local' });
  assert.deepEqual(runRecord({ tag: 'koppler-stop', at: 't', data: { id: 'stop0001', action: 'stop' } }), { id: 'stop0001', at: 't', kind: 'stop', env: null, mode: null, nodes: {}, edges: [], plan: { starts: [], restarts: [], stops: [], keeps: [] } });
});

test('States: waiting until picked up, then applying, done or failed; replaced by a newer Send arriving first, or picked up after it.', async () => {
  lines = [rec, runRecord(send('run0002', [{ id: 'api', run: 'cli' }])), { id: 'run0002', event: 'picked', at: 't1' }, runRecord(send('run0003', [{ id: 'web', run: 'cli' }])), { id: 'run0003', event: 'picked', at: 't2' }, { id: 'run0003', event: 'failed', at: 't3', reason: 'port held' }, 'garbage', { id: 'nope', event: 'done' }]
    .map(l => typeof l === 'string' ? l : JSON.stringify(l)).join('\n');
  assert.deepEqual(readRuns(lines).map(r => [r.id, r.state, r.reason]), [['run0001', 'replaced', undefined], ['run0002', 'replaced', undefined], ['run0003', 'failed', 'port held']]);
  const waitingAfter = [runRecord(send('run0004', [])), { id: 'run0004', event: 'picked', at: 't4' }, runRecord(send('run0005', []))].map(l => JSON.stringify(l)).join('\n');
  assert.deepEqual(readRuns(waitingAfter).map(r => r.state), ['applying', 'waiting']);
  assert.deepEqual(strays({ nodes: { api: {} } }, ['api', 'web', 'canvas', 'tunnel-db'], ['api', 'web']), ['web']);
});

test('The commands, end to end in a throwaway folder: plan, applied, a changed board, stop.', async () => {
  dir = fs.mkdtempSync(path.join(os.tmpdir(), 'koppler-runs-'));
  fs.writeFileSync(path.join(dir, 'registry.json'), JSON.stringify({ envs: ['qa'], apps: { api: { name: 'Orders API' }, web: { name: 'Web' }, docs: { name: 'Docs', outside: 'a library, nothing to run' } } }));
  env = { ...process.env, KOPPLER_TEMP: dir, KOPPLER_STATE: path.join(dir, 'state') };
  koppler = (...args) => { const r = spawnSync('node', [path.join(here, '..', 'dist', 'koppler.mjs'), ...args], { encoding: 'utf8', env }); return (r.stdout + r.stderr).trim(); };
  add = o => fs.appendFileSync(path.join(dir, 'history.jsonl'), JSON.stringify(o) + '\n');
  assert.equal(koppler('plan'), 'No Send is waiting to be applied.');
});

test('An app with nothing to run never makes it into a run, and koppler up refuses it by name.', async () => {
  process.env.KOPPLER_TEMP = dir;
  assert.deepEqual(Object.keys(runRecord(send('run0003', [{ id: 'api', run: 'cli' }, { id: 'docs', run: 'cli' }])).nodes), ['api']);
  delete process.env.KOPPLER_TEMP;
  assert.match(koppler('up', 'docs'), /Docs does not run on this Mac: a library, nothing to run/);
  add(runRecord(send('run0004', [{ id: 'api', run: 'cli' }, { id: 'web', run: 'cli' }, { id: 'app', run: 'ide' }])));
  assert.match(koppler('plan'), /START: Orders API, Web, app\n {2}This is what the user confirmed on the canvas\./);
});

test('Only what really runs is recorded: api runs, the user starts app in the IDE, web never started and is named.', async () => {
  koppler('run', 'api', '--', 'sleep', '30');
  done = koppler('history', 'done');
  assert.match(done, /Run run0004: done; live state is now api, app/);
  assert.match(done, /Not running: Web/);
  assert.deepEqual(Object.keys(JSON.parse(fs.readFileSync(path.join(dir, 'live.json'), 'utf8')).nodes), ['api', 'app']);
  assert.equal(koppler('plan'), 'No Send is waiting to be applied.');
  koppler('stop', 'api');
});

test('The next Send was confirmed as "keep api, start web", but api has died since: the plan differs and says so.', async () => {
  const second = send('run0005', [{ id: 'api', run: 'cli' }, { id: 'web', run: 'cli' }, { id: 'app', run: 'ide' }]);
  second.data.plan = { starts: [{ id: 'web', why: [] }], restarts: [], stops: [], keeps: [{ id: 'api', why: [] }, { id: 'app', why: [] }] };
  add(runRecord(second));
  assert.match(koppler('plan'), /START: Orders API \(it was started before but is not running now\), Web\n {2}KEEP RUNNING: app\n {2}DIFFERS from what the user confirmed/);
  assert.match(koppler('history', 'done', '--failed', 'web would not build'), /failed \(web would not build\)/);
  add(runRecord({ tag: 'koppler-stop', at: 't', data: { id: 'stop0006' } }));
  assert.match(koppler('history', 'done', 'stop0006'), /Stop stop0006: done; live state is now empty/);
  assert.deepEqual(JSON.parse(fs.readFileSync(path.join(dir, 'live.json'), 'utf8')).nodes, {});
  assert.match(koppler('history'), /run0005 .*\[failed: web would not build\]\n.*stop0006 +stop and revert +\[done\]/);
  fs.rmSync(dir, { recursive: true });
});

test('Code changes for the History: removed and added lines per app and file, bounded and cleaned.', async () => {
  const { codeChanges } = await import('../dist/engine/history.js');
  const got = codeChanges([
    { kind: 'process', name: 'api', command: 'dotnet run' },
    { kind: 'edit', app: 'api', file: 'appsettings.json', before: '"Url": "https://qa"', after: '"Url": "http://localhost:5001" // koppler: do not commit' },
    { kind: 'profile', app: 'api', file: 'Properties/launchSettings.json', name: 'QA-LOCAL', created: true },
    { kind: 'env-file', app: 'web', file: '.env.local', created: true, lines: ['API=http://localhost:5001', 'token=abc123'] },
    { kind: 'checkout', repo: 'web', from: 'main', to: 'feature/x' },
    { kind: 'secret', app: 'api', env: 'DB' },
  ], { clean: l => l.replace(/token=\S+/, 'token=***'), profileEnv: () => ({ Wallet__Url: 'http://localhost:5002' }) });
  assert.deepEqual(got.map(c => c.kind), ['edit', 'profile', 'env-file', 'checkout']);
  assert.deepEqual(got[0], { app: 'api', kind: 'edit', file: 'appsettings.json', title: 'Temporary edit', removed: ['"Url": "https://qa"'], added: ['"Url": "http://localhost:5001" // koppler: do not commit'] });
  assert.deepEqual(got[1].added, ['Wallet__Url=http://localhost:5002']);
  assert.equal(got[1].title, 'New launch profile QA-LOCAL');
  assert.deepEqual(got[2].added, ['API=http://localhost:5001', 'token=***']);
  assert.deepEqual([got[3].app, got[3].removed, got[3].added], ['web', ['main'], ['feature/x']]);
  assert.deepEqual(codeChanges(null), []);
  // A finished run carries its changes in the history.
  const withChanges = readRuns([rec, { id: 'run0001', event: 'done', at: 't9', changes: got }].map(l => JSON.stringify(l)).join('\n'));
  assert.equal(withChanges[0].changes.length, 4);
});

test('A queue with several Stops and Sends: only the newest board action goes out, answers stay, each says how long it waited.', async () => {
  const { pickPrompts } = await import('../dist/engine/listen.js');
  const at = m => new Date(Date.parse('2026-01-01T10:00:00Z') + m * 60000).toISOString();
  const q = [{ tag: 'koppler-stop', at: at(0), data: { id: 's1' } }, { tag: 'koppler', at: at(5), data: { id: 'r1' } }, { tag: 'koppler-reply', at: at(6), data: {} }, { tag: 'koppler-stop', at: at(28), data: { id: 's2' } }].map(p => JSON.stringify(p));
  const out = pickPrompts([...q, 'junk'], Date.parse(at(30)));
  assert.deepEqual(out.map(p => [p.tag, p.waited]), [['koppler-reply', 24], ['koppler-stop', 2]]);
});
