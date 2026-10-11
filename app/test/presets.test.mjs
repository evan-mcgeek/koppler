import assert from 'node:assert/strict';
import presets from '../dist/presets.cjs';

const stack = {
  known: id => ['app', 'api', 'db-api', 'far'].includes(id), cloned: id => id !== 'far',
  runIn: id => id === 'app' ? ['ide', 'cli'] : ['cli', 'ide'], platforms: id => id === 'app' ? ['ios', 'android', 'phone'] : [],
  canCall: (from, to) => `${from}>${to}` !== 'db-api>api', branches: id => id === 'api' ? ['main', 'develop'] : null,
};

// Reading: what cannot be a preset is refused with a reason.
for (const [bad, why] of [[null, /not a preset/], [[], /not a preset/], [{ nodes: { api: {} } }, /no name/], [{ name: 'x' }, /no apps/], [{ name: 'x', nodes: {} }, /no apps/], [{ name: 'x', version: 99, nodes: { api: {} } }, /newer Koppler/]])
  assert.match(presets.migrate(bad).error, why);

// Migration: a version 0 preset (no version, no cables, no run) is brought to the current format; a current one is left alone.
const old = presets.migrate({ name: 'Old', nodes: { api: {}, app: { run: 'ide' } } });
assert.deepEqual(old, { preset: { name: 'Old', nodes: { api: { run: 'cli' }, app: { run: 'ide' } }, edges: [], version: presets.VERSION }, migratedFrom: 0 });
const current = { name: 'Now', version: presets.VERSION, nodes: { api: { run: 'cli' } }, edges: [] };
assert.deepEqual(presets.migrate(current), { preset: current, migratedFrom: null });
// Every version below the current one has a step.
for (let v = 0; v < presets.VERSION; v++) assert.equal(typeof presets.MIGRATIONS[v], 'function', `no migration from version ${v}`);

// Checking against the stack: only what can run opens, and every change is noted.
const result = presets.check({ name: '  PR 12  ', source: 'pr.json', nodes: {
  app: { run: 'cli', platform: 'windows' }, api: { run: 'docker', branch: 'feat/x', note: 'flag on', tunnels: false }, 'db-api': { run: 'cli', platform: 'ios' }, far: { run: 'cli' }, gone: { run: 'cli' },
}, edges: [{ from: 'app', to: 'api' }, { from: 'app', to: 'api' }, { from: 'db-api', to: 'api' }, { from: 'api', to: 'far' }, { from: 'api', to: 'gone' }, null] }, stack);
assert.deepEqual(result.preset, { name: 'PR 12', version: presets.VERSION, source: 'pr.json',
  nodes: { app: { run: 'cli', platform: 'ios' }, api: { run: 'cli', branch: 'feat/x', note: 'flag on', tunnels: false }, 'db-api': { run: 'cli' } }, edges: [{ from: 'app', to: 'api' }] });
assert.deepEqual(result.notes, ['it had no version, read as the oldest format', 'not in this stack: gone', 'not cloned: far', 'app has no "windows" platform, using ios', 'api cannot run in "docker", using cli',
  'api has no branch feat/x in your clone (fetch it first)', 'db-api does not call api, cable left out', '1 cable left out with their apps']);

// A clean preset opens with nothing to say.
assert.deepEqual(presets.check({ name: 'Ok', version: 1, nodes: { app: { run: 'ide' }, api: { run: 'cli', branch: 'main' } }, edges: [{ from: 'app', to: 'api' }] }, stack),
  { preset: { name: 'Ok', version: 1, nodes: { app: { run: 'ide' }, api: { run: 'cli', branch: 'main' } }, edges: [{ from: 'app', to: 'api' }] }, notes: [] });
// Nothing left to open is an error, not an empty board.
assert.match(presets.check({ name: 'x', nodes: { gone: {} } }, stack).error, /None of its apps are in this stack/);
assert.match(presets.check({ name: 'x', nodes: { far: {} } }, stack).error, /None of its apps are cloned here/);
// A preset of the current format written by hand: an app without settings, cables that are not a list, a cable naming something every object has.
assert.deepEqual(presets.check({ name: 'Odd', version: 1, nodes: { app: null, api: {} }, edges: { from: 'app', to: 'api' } }, stack).preset.edges, []);
assert.deepEqual(presets.check({ name: 'Odd', version: 1, nodes: { app: {}, api: {} }, edges: [null, { from: 'constructor', to: 'api' }, { from: 'app', to: 'api' }] }, stack).preset.edges, [{ from: 'app', to: 'api' }]);
console.log('presets tests ok');
