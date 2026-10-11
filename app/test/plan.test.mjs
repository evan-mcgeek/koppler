import assert from 'node:assert/strict';
import kp from '../src/plan.cjs';

const ids = p => Object.fromEntries(['starts', 'restarts', 'stops', 'keeps'].map(k => [k, p[k].map(x => x.id)]));
const want = { env: 'qa', nodes: [{ id: 'app', run: 'ide', branch: null }, { id: 'api', run: 'cli', branch: null }, { id: 'db-api', run: 'cli', branch: 'main' }], edges: [{ from: 'app', to: 'api' }, { from: 'api', to: 'db-api' }] };

// Nothing applied yet: everything starts.
const first = kp.plan(null, want);
assert.deepEqual(ids(first), { starts: ['app', 'api', 'db-api'], restarts: [], stops: [], keeps: [] });
assert.equal(first.nothing, false);

// The same board again: nothing to do.
const live = kp.board(want);
assert.deepEqual(live.nodes.api, { branch: '', run: 'cli' });
const again = kp.plan(live, want, { running: () => true });
assert.deepEqual(ids(again), { starts: [], restarts: [], stops: [], keeps: ['app', 'api', 'db-api'] });
assert.equal(again.nothing, true);
assert.deepEqual(kp.describe(again), ['KEEP RUNNING: app, api, db-api']);

// One app leaves, one arrives, one changes branch: only the difference, each with its reason.
const next = { env: 'qa', nodes: { app: { run: 'ide' }, api: { run: 'cli' }, wallet: { run: 'cli' }, 'db-api': { run: 'cli', branch: 'main' } }, edges: [{ from: 'app', to: 'api' }, { from: 'api', to: 'wallet' }] };
const change = kp.plan(live, next, { name: id => id.toUpperCase(), running: () => true });
assert.deepEqual(ids(change), { starts: ['wallet'], restarts: ['api'], stops: [], keeps: ['app', 'db-api'] });
assert.deepEqual(change.restarts[0].why, ['it starts calling your local WALLET', 'it goes back to the deployed DB-API']);
const less = kp.plan(live, { env: 'qa', nodes: { app: { run: 'ide' }, api: { run: 'cli' } }, edges: [{ from: 'app', to: 'api' }] }, { running: () => true });
assert.deepEqual(ids(less), { starts: [], restarts: ['api'], stops: ['db-api'], keeps: ['app'] });

// A completely different board: stop everything, start the new ones.
assert.deepEqual(ids(kp.plan(live, { env: 'qa', nodes: { wallet: { run: 'cli' } }, edges: [] })), { starts: ['wallet'], restarts: [], stops: ['app', 'api', 'db-api'], keeps: [] });

// Another environment restarts what stays; branch, device and note changes restart too.
const prod = kp.plan(live, { ...want, env: 'prod' }, { running: () => true });
assert.deepEqual(ids(prod).restarts, ['app', 'api', 'db-api']);
assert.deepEqual(prod.envChange, { from: 'qa', to: 'prod' });
assert.match(prod.restarts[0].why[0], /from QA to PROD/);
assert.deepEqual(kp.plan(live, { ...want, nodes: want.nodes.map(n => n.id === 'db-api' ? { ...n, branch: 'feat/x' } : n) }, { running: () => true }).restarts, [{ id: 'db-api', why: ['its branch changes from main to feat/x'] }]);
assert.deepEqual(kp.plan(live, { ...want, nodes: want.nodes.map(n => n.id === 'api' ? { ...n, note: 'flag on' } : n) }, { running: () => true }).restarts, [{ id: 'api', why: ['its note changed'] }]);

// Reality corrects the record: something that died starts again, something unexplained is restarted or stopped.
assert.deepEqual(kp.plan(live, want, { running: id => id !== 'api' }).starts, [{ id: 'api', why: ['it was started before but is not running now'] }]);
assert.deepEqual(kp.plan(live, want, { running: id => id !== 'app' }).starts, []); // an IDE app is the user's to start
const stray = kp.plan(null, { env: 'qa', nodes: { api: { run: 'cli' } }, edges: [] }, { strays: ['api', 'wallet'] });
assert.deepEqual(ids(stray), { starts: [], restarts: ['api'], stops: ['wallet'], keeps: [] });

assert.equal(kp.same(change, JSON.parse(JSON.stringify(change))), true);
assert.equal(kp.same(change, less), false);
assert.deepEqual(kp.describe(kp.plan(live, { env: 'qa', nodes: {}, edges: [] })), ['STOP AND REVERT: app, api, db-api']);
// Protected environments come from the stack, or are every one but the first: never from a name.
assert.deepEqual(kp.protectedEnvs({ envs: ['qa', 'staging', 'live-eu'] }), ['staging', 'live-eu']);
assert.deepEqual(kp.protectedEnvs({ envs: ['prod'] }), []);
assert.deepEqual(kp.protectedEnvs({ envs: ['prod', 'qa'], protected: ['prod'] }), ['prod']);
assert.deepEqual(kp.protectedEnvs({ envs: ['qa', 'prod'], protected: [] }), []);
assert.equal(kp.isProtected({ envs: ['qa', 'prd'] }, 'prd'), true);
console.log('plan tests ok');
// Started by id with koppler run on the same environment, current branch, no local calls: kept, not restarted.
{
  const opts = { strays: ['api'], startedOn: () => 'prod' };
  assert.deepEqual(kp.plan(null, { env: 'prod', nodes: { api: { run: 'cli' } }, edges: [] }, opts).keeps.map(k => k.id), ['api']);
  assert.deepEqual(kp.plan(null, { env: 'qa', nodes: { api: { run: 'cli' } }, edges: [] }, opts).restarts.map(k => k.id), ['api']);
  assert.deepEqual(kp.plan(null, { env: 'prod', nodes: { api: { run: 'cli', branch: 'feat/x' } }, edges: [] }, opts).restarts.map(k => k.id), ['api']);
}

// A queue moving to local restarts only the apps on it, with the reason.
{
  const reg = { apps: { api: { publishes: { thumbs: {} } }, worker: { reads: { thumbs: {} } }, web: {} } };
  const b = queues => ({ env: 'qa', nodes: { api: { run: 'cli' }, worker: { run: 'cli' }, web: { run: 'cli' } }, edges: [], queues });
  const p = kp.plan(b({}), b({ thumbs: 'local', ghost: 'deployed' }), { queuesOf: id => kp.queuesOf(reg, id) });
  assert.deepEqual(ids(p), { starts: [], restarts: ['api', 'worker'], stops: [], keeps: ['web'] });
  assert.deepEqual(p.restarts[0].why, ['it moves to the local thumbs queue']);
}

// Switching an app to a local library (or back) restarts it, saying which.
{
  const b = libs => ({ env: 'qa', nodes: { app: { run: 'cli', ...(libs && { libraries: libs }) } }, edges: [] });
  assert.deepEqual(kp.plan(b(null), b(['acme_design'])).restarts[0].why, ['it uses your local acme_design']);
  assert.deepEqual(kp.plan(b(['acme_design']), b(null)).restarts[0].why, ['it goes back to the published acme_design']);
  assert.deepEqual(kp.plan(b(['a', 'b']), b(['b', 'a'])).keeps.map(k => k.id), ['app']);
}
