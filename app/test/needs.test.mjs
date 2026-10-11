import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { stepsFor, isDone } from '../dist/needs.mjs';

// The stack a command reads is the one in the run folder.
process.env.KOPPLER_TEMP = fs.mkdtempSync(path.join(os.tmpdir(), 'koppler-needs-'));
const useStack = stack => fs.writeFileSync(path.join(process.env.KOPPLER_TEMP, 'registry.json'), JSON.stringify(stack));

const steps = stepsFor('Orders API', [{ sso: 'acme-qa' }, { hosts: 'db.cluster.acme.dev' }, { devCerts: true }, { tunnel: 'x', port: 1 }],
  { appId: 'orders-api', skill: '/skill', repo: '/repo', secrets: [{ env: 'ConnectionStrings__DB', when: 'always', fetch: { cli: 'aws ... | <skill>/bin/secret-set orders-api ConnectionStrings__DB --stdin', ui: 'console' } }, { file: 'src/app.secrets.json' }] });
assert.deepEqual(steps.map(s => s.title), ['Sign in to AWS (acme-qa)', 'Point the database address at your Mac', 'Trust the local HTTPS certificate', 'Store ConnectionStrings__DB for Orders API', 'Put app.secrets.json in place for Orders API']);
assert.equal(steps[0].command, 'aws sso login --profile acme-qa');
assert.equal(steps[1].command, 'echo "127.0.0.1 db.cluster.acme.dev" | sudo tee -a /etc/hosts');
assert.equal(steps[3].command, 'aws ... | /skill/bin/secret-set orders-api ConnectionStrings__DB --stdin');
assert.match(steps[3].where, /not the agent/);
assert.equal(steps[4].check.file, '/repo/src/app.secrets.json');
assert.equal(stepsFor('X', [{ tunnel: 'h', port: 5432 }]).length, 0);

const hosts = path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'koppler-')), 'hosts');
fs.writeFileSync(hosts, '127.0.0.1 localhost a.example.com\n# 127.0.0.1 b.example.com\n');
assert.equal(isDone({ hosts: 'a.example.com' }, { hostsFile: hosts }), true);
assert.equal(isDone({ hosts: 'b.example.com' }, { hostsFile: hosts }), false);
assert.equal(isDone({ manual: true }), null);
console.log('ok');
// Another environment keeps its values in its own store, so storing PROD never replaces QA.
const prodStep = stepsFor('Orders API', [], { appId: 'orders-api', store: 'orders-api@prod', skill: '/skill', secrets: [{ env: 'ConnectionStrings__DB' }] })[0];
assert.equal(prodStep.command, 'koppler secret set orders-api@prod ConnectionStrings__DB');
assert.deepEqual(prodStep.check, { secret: ['orders-api@prod', 'ConnectionStrings__DB'] });
// On PROD a secret whose fetch steps are only QA's asks for the value by hand, never with QA's command.
const { needs } = await import('../dist/needs.mjs');
const registry = { envs: ['qa', 'prod'], apps: { o: { name: 'Orders', secrets: [{ env: 'KEY', fetch: { cli: 'aws --profile qa-ops', ui: 'QA console' } }] } } };
const out = []; const log = console.log; console.log = s => out.push(s);
useStack(registry); needs(['o', '--env', 'prod', '--json'], { skill: '/skill', fail: e => { throw new Error(e); } });
console.log = log;
const store = JSON.parse(out[0]).steps.find(s => s.id.startsWith('secret:'));
assert.equal(store.command, 'koppler secret set o@prod KEY');
assert.equal(store.alt, undefined);
// Run without tunnels: no tunnel, no hosts entry and no missing-tunnel gap; the sign-in stays.
{
  const reg = { envs: ['qa', 'prod'], apps: { o: { name: 'Orders', prereqs: [{ sso: 'qa-ops' }, { hosts: 'db.acme.dev' }, { tunnel: 'db.acme.dev', port: 5432 }], envs: { prod: { prereqs: [{ sso: 'prod-ops' }, { hosts: 'db.prod' }, { tunnel: 'db.prod', port: 5432 }] } } } } };
  const out = []; const log = console.log; console.log = s => out.push(s);
  useStack(reg); needs(['o', '--env', 'prod', '--no-tunnels', 'o', '--json'], { skill: '/skill', fail: e => { throw new Error(e); } });
  console.log = log;
  assert.deepEqual(JSON.parse(out[0]).steps.map(s => s.id), ['sso:prod-ops']);
}
// An own environment list missing the sign-in keeps its own tunnel; the sign-in shows as a gap first.
{
  const reg = { envs: ['qa', 'prod'], apps: { w: { name: 'Wallet', prereqs: [{ sso: 'qa-ops' }, { tunnel: 'qa-db', port: 5432 }], envs: { prod: { prereqs: [{ tunnel: 'prod-db', port: 5432 }] } } } } };
  const out = []; const log = console.log; console.log = s => out.push(s);
  useStack(reg); needs(['w', '--env', 'prod', '--json'], { skill: '/skill', fail: e => { throw new Error(e); } });
  console.log = log;
  const r = JSON.parse(out[0]);
  assert.deepEqual(r.steps.map(s => s.gap ? 'gap' : s.id), ['gap']);
  assert.deepEqual(r.koppler, ['tunnel to prod-db on localhost:5432', 'start Wallet']);
}
// A tunnel already listening is reported as open, not as something Koppler will start.
{
  const net = await import('node:net');
  const srv = net.createServer().listen(0, '127.0.0.1'); await new Promise(r => srv.on('listening', r));
  const port = srv.address().port;
  const reg = { envs: ['qa'], apps: { w: { name: 'Wallet', prereqs: [{ tunnel: 'db.acme', port }] } } };
  const out = []; const log = console.log; console.log = s => out.push(s);
  useStack(reg); needs(['w', '--json'], { skill: '/skill', fail: e => { throw new Error(e); } });
  console.log = log; srv.close();
  assert.deepEqual(JSON.parse(out[0]).koppler, [`tunnel to db on localhost:${port} (already open)`, 'start Wallet']);
}
