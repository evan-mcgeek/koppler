import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { cableTest, declaredSecrets, fromKoppler } from '../dist/status-watch.mjs';
import { githubFile } from '../dist/github.js';
import { presetsIn, sanitizeLayout, sanitizePrompt } from '../dist/server/sanitize.js';
import { tail } from '../dist/server/logs.js';

const file = path.join(os.tmpdir(), `ls-tail-${process.pid}.log`);
fs.writeFileSync(file, Array.from({ length: 1000 }, (_, i) => `line ${i}`).join('\n') + '\n');
const lines = tail(file).split('\n');
assert.equal(lines.length, 600);
assert.equal(lines.at(-1), 'line 999');
assert.equal(tail(file + '.missing'), null);
fs.rmSync(file);
assert.equal(sanitizeLayout(null), null);
assert.equal(sanitizeLayout({ nodes: [], edges: [] }), null);
assert.equal(sanitizeLayout({ nodes: {} }), null);
assert.deepEqual(
  sanitizeLayout({
    env: 'qa', mode: 'auto', zoom: 0.8, pan: { x: -10, y: 'x' }, evil: '<script>',
    nodes: { 'mobile-api': { x: 1, y: 2, branch: 'develop', run: 'cli', extra: 1 }, '../bad': { x: 0, y: 0 }, 'mobile-app': { x: NaN, y: 3, branch: 5, run: 'ide', platform: 'ios' } },
    edges: [{ from: 'mobile-app', to: 'mobile-api', fromSide: 'right', toSide: 'left', x: 1 }, { from: 'a b', to: 'mobile-api' }, null],
  }),
  {
    env: 'qa', mode: 'auto', zoom: 0.8, pan: { x: -10, y: 0 },
    nodes: { 'mobile-api': { x: 1, y: 2, branch: 'develop', run: 'cli' }, 'mobile-app': { x: 0, y: 3, branch: '', run: 'ide', platform: 'ios' } },
    edges: [{ from: 'mobile-app', to: 'mobile-api', fromSide: 'right', toSide: 'left' }],
  },
);
assert.deepEqual(sanitizeLayout({ infra: { 'tunnel:db.internal:5432': { x: 5, y: 'y', z: 1 }, 'tunnel:<x>:1': { x: 1, y: 1 }, evil: { x: 1 } }, nodes: {}, edges: [] }).infra, { 'tunnel:db.internal:5432': { x: 5, y: 0 } });
assert.equal(sanitizeLayout({ nodes: { a: { hideTunnels: true } }, edges: [] }).nodes.a.hideTunnels, true);
// A board keeps where its cards sit; anything else in its layout is dropped.
assert.deepEqual(sanitizeLayout({ nodes: {}, edges: [], presets: [{ name: 'B', nodes: { a: { run: 'cli' }, b: { run: 'cli' } }, edges: [{ from: 'a', to: 'b' }],
  layout: { nodes: { a: { x: 10, y: 20, z: 1 }, 'bad id': { x: 1, y: 1 } }, infra: { 'tunnel:db.internal:5432': { x: 3, y: 'q' }, evil: { x: 1, y: 1 } }, sides: { 'a>b': ['bottom', 'top'], 'a>c': ['up', 'top'] }, tidy: 'down', extra: 1 } }] }).presets[0].layout,
  { nodes: { a: { x: 10, y: 20 } }, infra: { 'tunnel:db.internal:5432': { x: 3, y: 0 } }, sides: { 'a>b': ['bottom', 'top'] }, tidy: 'down' });
assert.equal('layout' in sanitizeLayout({ nodes: {}, edges: [], presets: [{ name: 'B', nodes: { a: { run: 'cli' } }, edges: [], layout: { nodes: {} } }] }).presets[0], false);
assert.deepEqual(sanitizeLayout({ trash: [{ name: 'Old', nodes: { a: { run: 'cli' } }, edges: [], deleted: '2026-10-07T10:00:00.000Z' }, { name: 'No date', nodes: {}, edges: [] }], nodes: {}, edges: [] }).trash, [{ name: 'Old', nodes: { a: { run: 'cli' } }, edges: [], deleted: '2026-10-07T10:00:00.000Z' }]);
assert.equal('hideTunnels' in sanitizeLayout({ nodes: { a: { hideTunnels: 'yes' } }, edges: [] }).nodes.a, false);
assert.deepEqual(githubFile('https://github.com/acme/stacks/blob/main/presets/pr-12.json'), { owner: 'acme', repo: 'stacks', ref: 'main', path: 'presets/pr-12.json' });
assert.deepEqual(githubFile('https://raw.githubusercontent.com/acme/stacks/refs/heads/main/p.json'), { owner: 'acme', repo: 'stacks', ref: 'main', path: 'p.json' });
for (const bad of ['https://github.com/a/b/blob/main/100%-done.json', 'http://github.com/a/b/blob/main/p.json', 'https://evil.test/a/b/blob/main/p.json', 'https://github.com/a/b/blob/main/../../x', 'https://u:p@github.com/a/b/blob/main/p.json', 'file:///etc/passwd', 'https://github.com/a/b', 'https://127.0.0.1/a/b/blob/m/p.json']) assert.equal(githubFile(bad), null, bad);
const one = { name: 'PR 12', version: 1, source: 'pr-12.json', evil: 1, nodes: { api: { run: 'cli', branch: 'feat/x', extra: 1 }, '../x': { run: 'cli' } }, edges: [{ from: 'api', to: 'db', x: 1 }, { from: 'a b', to: 'api' }] };
const clean = { name: 'PR 12', version: 1, nodes: { api: { run: 'cli', branch: 'feat/x' } }, edges: [{ from: 'api', to: 'db' }], source: 'pr-12.json' };
assert.deepEqual(presetsIn(one), [clean]);
assert.deepEqual(presetsIn([one, { nodes: {} }, null]), [clean]);
assert.deepEqual(presetsIn({ name: 'Stack', apps: {}, presets: [one] }), [clean]);
assert.deepEqual(presetsIn('nope'), []);
const withNotes = sanitizeLayout({ note: 'use test student', nodes: { 'mobile-api': { x: 0, y: 0, run: 'cli', note: 'flag on' + 'x'.repeat(5000) } }, edges: [] });
assert.equal(withNotes.note, 'use test student');
assert.equal(withNotes.nodes['mobile-api'].note.length, 4000);
const badNotes = sanitizeLayout({ note: 5, nodes: { a: { note: { evil: 1 } } }, edges: [] });
assert.equal('note' in badNotes, false);
assert.equal('note' in badNotes.nodes.a, false);
const withPresets = sanitizeLayout({ nodes: {}, edges: [], presets: [{ name: 'App + API', nodes: { 'mobile-app': { run: 'ide', evil: 1 }, '../x': {} }, edges: [{ from: 'mobile-app', to: 'mobile-api', x: 1 }] }, { nodes: {} }, 'junk'] });
assert.deepEqual(withPresets.presets, [{ name: 'App + API', nodes: { 'mobile-app': { run: 'ide' } }, edges: [{ from: 'mobile-app', to: 'mobile-api' }] }]);
assert.equal('presets' in sanitizeLayout({ nodes: {}, edges: [] }), false);
assert.equal(sanitizeLayout({ nodes: {}, edges: [], preset: 'Mobile App + Wallet' }).preset, 'Mobile App + Wallet');
assert.equal('preset' in sanitizeLayout({ nodes: {}, edges: [], preset: { x: 1 } }), false);
console.log('ok');

// Recently opened boards are kept, newest first, bounded; anything malformed is dropped.
assert.deepEqual(sanitizeLayout({ nodes: {}, edges: [], recent: [{ name: 'Checkout', at: '2026-10-09T10:00:00.000Z' }, { name: 'x', at: 'yesterday' }, 'junk', { at: '2026-10-09T10:00:00Z' }] }).recent, [{ name: 'Checkout', at: '2026-10-09T10:00:00.000Z' }]);
assert.equal(sanitizeLayout({ nodes: {}, edges: [], recent: Array.from({ length: 30 }, (_, n) => ({ name: `b${n}`, at: '2026-10-09T10:00:00Z' })) }).recent.length, 20);
assert.equal(sanitizePrompt({ tag: 'rm -rf', text: 'x' }), null);
assert.equal(sanitizePrompt({ tag: 'koppler' }), null);
assert.equal(sanitizePrompt({ tag: 'koppler-stop', text: 'stop', data: [1] }).data.constructor, Object);
assert.equal(sanitizePrompt({ tag: 'koppler-fix', text: 'fix', data: { failures: [] } }).tag, 'koppler-fix');
assert.equal(sanitizePrompt({ tag: 'koppler', text: 'y'.repeat(30000) }).text.length, 20000);
// Credentials for the panel: per app and environment, names and fetch steps; an environment without its own list inherits the first one's.
const declared = declaredSecrets({ envs: ['qa', 'prod'], apps: {
  api: { secrets: [{ env: 'DB', when: 'always', fetch: { cli: '<skill>/bin/secret-set api DB', ui: 'Console → Lambda → copy DB, change Host to localhost, then run <skill>/bin/secret-set api DB' } }, { file: 'x.json' }, { env: 'bad name' }], envs: { prod: { secrets: [{ env: 'DB_PROD' }] } } },
  web: { secrets: [{ env: 'KEY' }] }, none: {} } });
assert.deepEqual(Object.keys(declared), ['api', 'web']);
assert.deepEqual(declared.api.qa.map(x => x.name), ['DB']);
assert.equal(declared.api.qa[0].fetchCli.endsWith('/bin/secret-set api DB'), true);
assert.equal(declared.api.qa[0].fetchCli.includes('<skill>'), false);
assert.deepEqual(declared.api.prod.map(x => x.name), ['DB_PROD']);
assert.deepEqual(declared.web.prod.map(x => x.name), ['KEY']);
assert.equal(declared.api.qa[0].fetchUi, 'Console → Lambda → copy DB, change Host to localhost');
assert.equal(declaredSecrets({ envs: ['qa'], apps: { a: { secrets: [{ env: 'K', fetch: { ui: 'Copy it, then run: <skill>/bin/secret-set a K' } }] } } }).a.qa[0].fetchUi, 'Copy it');
// A Flutter app started by Koppler shows its flavor from Koppler's record; one with flutter run attached keeps what was seen.
assert.deepEqual(fromKoppler('app', [{ platform: 'ios', deviceId: 'SIM-1', pid: 1 }], { command: 'with-secrets app -- sh -c fvm flutter run --no-resident --flavor qa -d SIM-1 && exec fvm flutter logs -d SIM-1' }), [{ platform: 'ios', deviceId: 'SIM-1', pid: 1, flavor: 'qa', source: 'cli' }]);
assert.deepEqual(fromKoppler('app', [{ deviceId: 'SIM-2', pid: 1 }], { command: 'flutter run --flavor qa -d SIM-1' }), [{ deviceId: 'SIM-2', pid: 1 }]);
assert.deepEqual(fromKoppler('app', [{ deviceId: 'SIM-1', pid: 1, flavor: 'prod', source: 'ide' }], { command: 'flutter run --flavor qa -d SIM-1' }), [{ deviceId: 'SIM-1', pid: 1, flavor: 'prod', source: 'ide' }]);
assert.deepEqual(fromKoppler('app', [{ deviceId: 'SIM-1', pid: 1 }], null), [{ deviceId: 'SIM-1', pid: 1 }]);
// The test on a cable follows the whole path, and only ever tries this Mac's addresses.
{
  const reg = { envs: ['qa', 'prod'], apps: {
    api: { name: 'Orders', kind: 'dotnet', url: 'http://localhost:5001', secrets: [{ env: 'ConnectionStrings__DB', type: 'postgres' }], prereqs: [{ hosts: 'cache.acme.internal' }] },
    web: { name: 'Shop', kind: 'dotnet', consumes: { api: { how: 'env', env: ['OrdersUrl'] }, far: { how: 'edit' } } }, far: { name: 'Far', url: 'https://orders.acme.test' }, bare: { name: 'Bare' } } };
  const tried = [], probe = (over = {}) => ({ answers: async u => (tried.push(u.host), { status: 404, ms: 7 }), opens: async () => true, speaks: async () => true, leadsHere: async () => true, login: async () => ({ ok: true }),
    profile: () => ({ name: 'QA-LOCAL', env: { OrdersUrl: 'http://localhost:5001/' } }), ...over });
  const t = async (body, over) => { const r = await cableTest(reg, body, probe(over)); return r.unsure ? `${r.text}?` : r.text; };
  // An app cable: the callee answers and the caller's local profile points at it.
  assert.deepEqual(await cableTest(reg, { env: 'qa', from: 'web', to: 'api' }, probe()), { ok: true, text: 'Answers, 7 ms', detail: "Orders answers on localhost:5001 (HTTP 404), and Shop's QA-LOCAL profile points at it." });
  assert.equal(await t({ from: 'web', to: 'api' }, { profile: () => ({ name: 'QA-LOCAL', env: { OrdersUrl: 'http://localhost:9/' } }) }), 'Not pointed at it');
  assert.equal(await t({ from: 'web', to: 'api' }, { profile: () => ({ name: 'QA-LOCAL', env: {} }) }), 'Not pointed at it');
  assert.equal(await t({ from: 'web', to: 'api' }, { profile: () => ({ name: 'QA-LOCAL', env: null }) }), 'Not pointed at it');
  assert.match((await cableTest(reg, { from: 'bare', to: 'api' }, probe())).detail, /could not be checked here/);
  // A setting written after the caller started has not been picked up yet.
  assert.equal(await t({ from: 'web', to: 'api' }, { profile: () => ({ name: 'QA-LOCAL', env: { OrdersUrl: 'http://localhost:5001/' }, changed: 200, started: 100 }) }), 'Restart needed');
  assert.equal(await t({ from: 'web', to: 'api' }, { profile: () => ({ name: 'QA-LOCAL', env: { OrdersUrl: 'http://localhost:5001/' }, changed: 100, started: 200 }) }), 'Answers, 7 ms');
  assert.equal(await t({ to: 'api' }, { answers: async () => null }), 'No answer');
  assert.deepEqual([await t({ to: 'far' }), await t({ to: 'bare' }), await t({ to: '__proto__' })], ['Cannot test?', 'Cannot test?', 'Cannot test?']);
  assert.ok(tried.every(h => h === 'localhost:5001'));
  // A tunnel link: port, a real server behind it, the name the app dials, then the login.
  const link = { app: 'api', host: '127.0.0.1', port: 5432 };
  assert.equal(await t({ ...link, host: '10.0.0.5' }), 'Cannot test?');
  assert.equal(await t(link, { opens: async () => false }), 'Port closed');
  assert.equal(await t(link, { speaks: async () => false }), 'Nothing behind it');
  assert.equal(await t(link, { leadsHere: async () => false }), 'Name not redirected');
  assert.equal(await t({ ...link, port: 5433, original: 5432 }), 'Logged in');
  assert.equal(await t({ ...link, port: 6379 }), 'Reachable');
  assert.equal(await t({ ...link, port: 9999 }), 'Port open?');
  assert.equal(await t(link, { login: async () => ({ ok: false, message: 'failed: not stored' }) }), 'Not stored');
  assert.equal(await t(link, { login: async () => ({ ok: false, message: 'cannot test: no psql' }) }), 'Reachable');
  const bad = await cableTest(reg, link, probe({ login: async () => ({ ok: false, message: 'failed: password authentication failed' }) }));
  assert.deepEqual([bad.ok, bad.text], [false, 'Login failed']);
  assert.match(bad.detail, /rejected: password authentication failed$/);
  // An app by itself; a Lambda reports its function and queue trigger.
  reg.apps.fn = { name: 'Dispatcher', kind: 'lambda', url: 'http://localhost:5080' };
  assert.equal(await t({ node: 'api' }), 'Answers, 7 ms');
  assert.equal(await t({ node: 'bare' }), 'Cannot test?');
  assert.equal(await t({ node: 'fn' }, { answers: async () => ({ status: 200, ms: 3, body: '{"koppler":"lambda","ok":true,"function":"Active","trigger":"Enabled"}' }) }), 'Function ready');
  assert.equal(await t({ node: 'fn' }, { answers: async () => ({ status: 503, ms: 3, body: '{"koppler":"lambda","ok":false,"function":"Failed","trigger":"Enabled"}' }) }), 'Function not ready');
  assert.equal(await t({ node: 'fn' }, { answers: async () => ({ status: 404, ms: 3, body: '' }) }), 'Answers');
  // By itself the canvas never reads a production credential.
  let read = 0;
  assert.equal(await t({ ...link, env: 'prod', auto: true }, { login: async () => (read++, { ok: true }) }), 'Reachable');
  assert.equal(await t({ ...link, env: 'prod' }, { login: async () => (read++, { ok: true }) }), 'Logged in');
  assert.equal(read, 1);
}
assert.deepEqual(sanitizeLayout({ nodes: {}, edges: [], dismissed: ['unwired:a>b', 7] }).dismissed, ['unwired:a>b']);
{ const f = path.join(os.tmpdir(), `koppler-tail-${process.pid}.log`); fs.writeFileSync(f, 'flutter: \\^[[36mBlocObserver: onCreate\\^[[0m\n\x1b[31mred\x1b[0m\n'); assert.equal(tail(f), 'flutter: BlocObserver: onCreate\nred'); fs.rmSync(f); }

// Debug log entries keep only known fields, short texts, and secrets masked.
{
  const { cleanDebugEntry } = await import('../dist/server/logs.js');
  assert.deepEqual(cleanDebugEntry({ at: 't', kind: 'click', what: 'button#send "Send to agent"', board: { apps: 8, cables: 16, view: 'edit', env: 'qa', zoom: 0.5, name: 'B', extra: 1 }, evil: 'x' }),
    { at: 't', kind: 'click', what: 'button#send "Send to agent"', board: { apps: 8, cables: 16, view: 'edit', env: 'qa', zoom: 0.5, name: 'B' } });
  assert.equal(cleanDebugEntry({ kind: 'warning', what: 'Login failed: password=hunter2' }).what, 'Login failed: password=***');
  assert.equal(cleanDebugEntry({ kind: 'click' }), null);
  assert.equal(cleanDebugEntry('nope'), null);
}
