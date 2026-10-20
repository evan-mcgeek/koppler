import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawn, spawnSync } from 'node:child_process';
import { allowStack } from './allow.mjs';
import { freePorts, until } from './helpers.mjs';
import { test } from 'node:test';

const cli = path.join(import.meta.dirname, '..', 'dist', 'koppler.mjs');
const START = 'https://acme.awsapps.com/start';
const DEVICE = /Approve it at https:\/\/acme\.awsapps\.com\/start\/#\/device with the code from the app's log/;

// A sandboxed home: its own AWS config with an sso-session profile, its own SSO cache, and an `aws` that is signed in.
function sandbox(port) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'koppler-sso-session-'));
  const bin = path.join(dir, 'bin'), cache = path.join(dir, '.aws', 'sso', 'cache'), repo = path.join(dir, 'repo');
  for (const one of [bin, cache, repo]) fs.mkdirSync(one, { recursive: true });
  fs.writeFileSync(path.join(bin, 'aws'), '#!/bin/sh\necho 111111111111\n', { mode: 0o755 });
  fs.writeFileSync(path.join(dir, 'aws-config'), `[profile acme-dev]\nsso_session = acme\nsso_account_id = 111111111111\nsso_role_name = Dev\n\n[sso-session acme]\nsso_start_url = ${START}\nsso_region = eu-west-1\n`);
  const env = { ...process.env, HOME: dir, AWS_CONFIG_FILE: path.join(dir, 'aws-config'), PATH: `${bin}:${process.env.PATH}`, KOPPLER_STATE: dir, KOPPLER_TEMP: dir, KOPPLER_CONFIG_DIR: dir };
  delete env.CLAUDE_CODE_SESSION_ID;
  // Like an older AWS SDK: it asks for a device sign-in in its log, and answers once that is approved.
  const start = `echo "Using a browser, visit: ${START}/#/device and enter the code: ABCD-EFGH"; sleep 3; exec node -e "require('http').createServer((q,s)=>s.end('ok')).listen(${port})"`;
  const stack = { envs: ['qa'], apps: { 'orders-api': { name: 'Orders API', kind: 'other', url: `http://localhost:${port}`, start, prereqs: [{ sso: 'acme-dev' }] } } };
  fs.writeFileSync(path.join(dir, 'registry.json'), JSON.stringify(stack));
  allowStack(dir, stack);
  fs.writeFileSync(path.join(dir, 'local.json'), JSON.stringify({ apps: { 'orders-api': { path: repo } } }));
  const sdkCache = expiresAt => fs.writeFileSync(path.join(cache, `${createHash('sha1').update(START).digest('hex')}.json`), JSON.stringify({ startUrl: START, expiresAt }));
  const koppler = (...args) => { const r = spawnSync('node', [cli, ...args], { encoding: 'utf8', env, input: '' }); return (r.stdout + r.stderr).trim(); };
  return { dir, env, koppler, sdkCache };
}

test('An sso-session sign-in that an older AWS SDK keeps under the start URL, expired there, is not reported as simply done.', async () => {
  const { dir, koppler, sdkCache } = sandbox((await freePorts(1))[0]);
  try {
    const expired = koppler('doctor', 'orders-api');
    assert.match(expired, /Already done: Sign in to AWS \(acme-dev\)\./);
    assert.match(expired, /Orders API may still ask for its own AWS sign-in in the browser/);
    assert.match(expired, DEVICE);
    sdkCache(new Date(Date.now() + 3600_000).toISOString());
    assert.doesNotMatch(koppler('doctor', 'orders-api'), /may still ask/);
  } finally { fs.rmSync(dir, { recursive: true, force: true }); }
});

test('koppler up says so before it starts, and while the app waits on its own sign-in, shows the code to approve on its card.', async () => {
  const { dir, env, koppler, sdkCache } = sandbox((await freePorts(1))[0]);
  try {
    sdkCache(new Date(Date.now() - 60_000).toISOString());
    fs.writeFileSync(path.join(dir, 'history.jsonl'), JSON.stringify({ id: 'sso00001', at: new Date().toISOString(), kind: 'run', env: 'qa', mode: 'auto', nodes: { 'orders-api': { branch: '', run: 'cli' } }, edges: [], plan: {} }) + '\n');
    const up = spawn('node', [cli, 'up', '--run', 'sso00001'], { env });
    const closed = new Promise(resolve => up.on('close', resolve));
    let out = '';
    up.stdout.on('data', chunk => { out += chunk; });
    up.stderr.on('data', chunk => { out += chunk; });
    const said = /aits for you to sign in to AWS: open https:\/\/acme\.awsapps\.com\/start\/#\/device and enter the code ABCD-EFGH/.source;
    const card = () => { try { return JSON.parse(fs.readFileSync(path.join(dir, 'progress.json'), 'utf8')).apps['orders-api'].find(step => step.label === 'Start'); } catch { return undefined; } };
    await until('the code on the card', () => card()?.state === 'user' && new RegExp(`^W${said}\\.$`).test(card().detail), 20000);
    const code = await closed;
    assert.equal(code, 0, out);
    assert.match(out, DEVICE);
    assert.ok(out.search(DEVICE) < out.indexOf('waiting for orders-api'), out);
    assert.match(out, new RegExp(`orders-api w${said}`));
    assert.match(out, /started orders-api/);
  } finally {
    koppler('stop', '--all', '--yes');
    fs.rmSync(dir, { recursive: true, force: true });
  }
});
