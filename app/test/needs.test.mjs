import './sandbox.mjs';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { stepsFor, isDone } from '../dist/engine/needs.js';
import { freePorts } from './helpers.mjs';
import { test } from 'node:test';

let hosts, needs, out, steps, useStack;
test('The stack a command reads is the one in the run folder.', async () => {
  process.env.KOPPLER_TEMP = fs.mkdtempSync(path.join(os.tmpdir(), 'koppler-needs-'));
  useStack = stack => fs.writeFileSync(path.join(process.env.KOPPLER_TEMP, 'registry.json'), JSON.stringify(stack));

  steps = stepsFor('Orders API', [{ sso: 'acme-qa' }, { hosts: 'db.cluster.acme.dev' }, { devCerts: true }, { tunnel: 'x', port: 1 }],
    { appId: 'orders-api', skill: '/skill', repo: '/repo', secrets: [{ env: 'ConnectionStrings__DB', when: 'always', fetch: { cli: 'aws ... | <skill>/bin/secret-set orders-api ConnectionStrings__DB --stdin', ui: 'console' } }, { file: 'src/app.secrets.json' }] });
  assert.deepEqual(steps.map(s => s.title), ['Sign in to AWS (acme-qa)', 'Point the database address at your Mac', 'Trust the local HTTPS certificate', 'Store ConnectionStrings__DB for Orders API', 'Put app.secrets.json in place for Orders API']);
  assert.equal(steps[0].command, 'aws sso login --profile acme-qa');
});

test('A sign-in the stack declares itself reads the same way, with its own command.', async () => {
  {
    const signIns = { 'acme-cloud': { what: 'Acme Cloud', check: 'acme whoami', login: 'acme login --tenant shop' } };
    const [own] = stepsFor('Orders API', [{ signIn: 'acme-cloud' }], { signIns });
    assert.equal(own.title, 'Sign in to Acme Cloud');
    assert.equal(own.command, 'acme login --tenant shop');
    assert.equal(own.id, 'sign-in:acme-cloud');
  }
  assert.equal(steps[1].command, 'echo "127.0.0.1 db.cluster.acme.dev" | sudo tee -a /etc/hosts');
  assert.equal(steps[3].command, 'aws ... | /skill/bin/secret-set orders-api ConnectionStrings__DB --stdin');
  assert.match(steps[3].where, /not the agent/);
  assert.equal(steps[4].check.file, '/repo/src/app.secrets.json');
  assert.equal(stepsFor('X', [{ tunnel: 'h', port: 5432 }]).length, 0);

  hosts = path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'koppler-')), 'hosts');
  fs.writeFileSync(hosts, '127.0.0.1 localhost a.example.com\n# 127.0.0.1 b.example.com\n');
  assert.equal(isDone({ hosts: 'a.example.com' }, { hostsFile: hosts }), true);
  assert.equal(isDone({ hosts: 'b.example.com' }, { hostsFile: hosts }), false);
  assert.equal(isDone({ manual: true }), null);
  console.log('ok');
});

test('Another environment keeps its values in its own store, so storing PROD never replaces QA.', async () => {
  const prodStep = stepsFor('Orders API', [], { appId: 'orders-api', store: 'orders-api@prod', skill: '/skill', secrets: [{ env: 'ConnectionStrings__DB' }] })[0];
  assert.equal(prodStep.command, 'koppler secret set orders-api@prod ConnectionStrings__DB');
  assert.deepEqual(prodStep.check, { secret: ['orders-api@prod', 'ConnectionStrings__DB'] });
});

test('On PROD a secret whose fetch steps are only QA\'s asks for the value by hand, never with QA\'s command.', async () => {
  ({ needs } = await import('../dist/engine/needs.js'));
  const registry = { envs: ['qa', 'prod'], apps: { o: { name: 'Orders', secrets: [{ env: 'KEY', fetch: { cli: 'aws --profile qa-ops', ui: 'QA console' } }] } } };
  out = []; const log = console.log; console.log = s => out.push(s);
  useStack(registry); needs(['o', '--env', 'prod', '--json'], { skill: '/skill', fail: e => { throw new Error(e); } });
  console.log = log;
  const store = JSON.parse(out[0]).steps.find(s => s.id.startsWith('secret:'));
  assert.equal(store.command, 'koppler secret set o@prod KEY');
  assert.equal(store.alt, undefined);
});

test('Run without tunnels: no tunnel, no hosts entry and no missing-tunnel gap; the sign-in stays.', async () => {
  const reg = { envs: ['qa', 'prod'], apps: { o: { name: 'Orders', prereqs: [{ sso: 'qa-ops' }, { hosts: 'db.acme.dev' }, { tunnel: 'db.acme.dev', port: 5432 }], envs: { prod: { prereqs: [{ sso: 'prod-ops' }, { hosts: 'db.prod' }, { tunnel: 'db.prod', port: 5432 }] } } } } };
  const out = []; const log = console.log; console.log = s => out.push(s);
  useStack(reg); needs(['o', '--env', 'prod', '--no-tunnels', 'o', '--json'], { skill: '/skill', fail: e => { throw new Error(e); } });
  console.log = log;
  assert.deepEqual(JSON.parse(out[0]).steps.map(s => s.id), ['sso:prod-ops']);
});

test('An own environment list missing the sign-in keeps its own tunnel; the sign-in shows as a gap first.', async () => {
  // A port nothing listens on, whatever runs on this machine.
  const [free] = await freePorts(1);
  const reg = { envs: ['qa', 'prod'], apps: { w: { name: 'Wallet', prereqs: [{ sso: 'qa-ops' }, { tunnel: 'qa-db', port: free }], envs: { prod: { prereqs: [{ tunnel: 'prod-db', port: free }] } } } } };
  const out = []; const log = console.log; console.log = s => out.push(s);
  useStack(reg); needs(['w', '--env', 'prod', '--json'], { skill: '/skill', fail: e => { throw new Error(e); } });
  console.log = log;
  const r = JSON.parse(out[0]);
  assert.deepEqual(r.steps.map(s => s.gap ? 'gap' : s.id), ['gap']);
  assert.deepEqual(r.koppler, [`tunnel to prod-db on localhost:${free}`, 'start Wallet']);
});

test("A port held by this tunnel is open already; held by another host's tunnel or another program, it is named, as koppler up will stop on it.", async () => {
  const { spawnSync } = await import('node:child_process');
  const koppler = (...args) => spawnSync('node', [path.join(import.meta.dirname, '..', 'dist', 'koppler.mjs'), ...args], { encoding: 'utf8', env: process.env });
  const [port] = await freePorts(1);
  const serve = `require('net').createServer().listen(${String(port)}, '127.0.0.1')`;
  // Orders API's database is db-a; Web API's, on the same port, is db-b.
  const reg = { envs: ['qa'], apps: { o: { name: 'Orders API', prereqs: [{ tunnel: 'db-a.example', port }] }, w: { name: 'Web API', prereqs: [{ tunnel: 'db-b.example', port }] } } };
  const plan = () => {
    const out = []; const log = console.log; console.log = s => out.push(s);
    try { useStack(reg); needs(['o', '--json'], { skill: '/skill', fail: e => { throw new Error(e); } }); } finally { console.log = log; }
    return JSON.parse(out[0]).koppler[0];
  };
  try {
    const other = `tunnel-db-b-example-${String(port)}`;
    assert.equal(koppler('run', other, '--port', String(port), '--', 'node', '-e', serve).status, 0);
    assert.equal(plan(), `tunnel to db-a on localhost:${String(port)} (the port is held by ${other}, not this tunnel: koppler stop ${other} first)`);
    koppler('stop', other);
    const own = `tunnel-db-a-example-${String(port)}`;
    assert.equal(koppler('run', own, '--port', String(port), '--', 'node', '-e', serve).status, 0);
    assert.equal(plan(), `tunnel to db-a on localhost:${String(port)} (already open)`);
    koppler('stop', own);
    const net = await import('node:net');
    const srv = net.createServer().listen(port, '127.0.0.1'); await new Promise(r => srv.on('listening', r));
    try { assert.match(plan(), new RegExp(`^tunnel to db-a on localhost:${String(port)} \\(the port is held by \\S+ \\(pid ${String(process.pid)}\\), not this tunnel: close it first\\)$`)); } finally { srv.close(); }
  } finally { koppler('stop', '--all', '--yes'); }
});

test('A file secret with no steps for another environment is a gap that names the file.', async () => {
  const { spawnSync } = await import('node:child_process');
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'koppler-filegap-'));
  try {
    const env = { ...process.env, KOPPLER_STATE: dir, KOPPLER_TEMP: dir, KOPPLER_CONFIG_DIR: dir };
    delete env.CLAUDE_CODE_SESSION_ID;
    const repo = path.join(dir, 'repo'); fs.mkdirSync(repo);
    const secrets = [{ file: 'src/Orders/appsettings.secrets.json', when: 'always', fetch: { ui: 'README step 1' } }];
    fs.writeFileSync(path.join(dir, 'registry.json'), JSON.stringify({ envs: ['qa', 'prod'], apps: { 'orders-api': { name: 'Orders API', kind: 'other', secrets } } }));
    fs.writeFileSync(path.join(dir, 'local.json'), JSON.stringify({ apps: { 'orders-api': { path: repo } } }));
    const r = spawnSync('node', [path.join(import.meta.dirname, '..', 'dist', 'koppler.mjs'), 'doctor'], { encoding: 'utf8', env, input: '' });
    assert.match(r.stdout + r.stderr, /^GAP\s+orders-api prod No steps for getting the file src\/Orders\/appsettings\.secrets\.json for Orders API on PROD$/m);
  } finally { fs.rmSync(dir, { recursive: true, force: true }); }
});
