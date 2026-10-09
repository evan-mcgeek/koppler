import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const bin = path.join(path.dirname(fileURLToPath(import.meta.url)), '..', 'bin', 'secret-test');
const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'koppler-secret-test-'));
const run = (...args) => { const r = spawnSync(bin, args, { encoding: 'utf8', env: { ...process.env, KOPPLER_SECRETS: dir } }); return [r.status, (r.stdout + r.stderr).trim()]; };

assert.deepEqual(run('orders-api', 'ConnectionStrings__DB'), [2, 'not stored']);
fs.writeFileSync(path.join(dir, 'orders-api.env'), "export API_KEY=sk_test_abc\nexport ConnectionStrings__DB='Host=127.0.0.1;Port=1;Database=orders;Username=app;Password=hunter2-not-real'\n");
assert.deepEqual(run('orders-api', 'MISSING'), [2, 'not stored']);
assert.deepEqual(run('orders-api', 'API_KEY'), [2, 'cannot test: not a database or cache connection Koppler reads']);
assert.equal(run('../etc', 'X')[0], 2);
// Nothing listens on port 1: the outcome is a plain reason, and no part of the value is printed.
const [status, out] = run('orders-api', 'ConnectionStrings__DB');
if (!out.startsWith('cannot test: psql')) { assert.equal(status, 1); assert.equal(out, 'failed: nothing answers at its address (is the tunnel up?)'); }
for (const leak of ['hunter2', 'sk_test', 'Username', 'orders;']) assert.equal(out.includes(leak), false);
// Each environment has its own store.
assert.deepEqual(run('orders-api@prod', 'ConnectionStrings__DB'), [2, 'not stored']);
fs.rmSync(dir, { recursive: true });
console.log('secret-test tests ok');

// secret-psql --pgpass writes the line tools look up, replaces an older one, and prints no password.
{
  const psqlBin = path.join(path.dirname(bin), 'secret-psql');
  const d = fs.mkdtempSync(path.join(os.tmpdir(), 'koppler-secret-psql-')), pgpass = path.join(d, 'pgpass');
  fs.writeFileSync(path.join(d, 'orders-api@prod.env'), "export ConnectionStrings__DB='Host=localhost;Port=5437;Database=orders;Username=root;Password=p:w\\d-not-real'\n");
  fs.writeFileSync(pgpass, 'other.host:5432:x:y:keep-me\nlocalhost:5437:orders:root:old\n');
  const go = (...a) => spawnSync(psqlBin, a, { encoding: 'utf8', env: { ...process.env, KOPPLER_SECRETS: d, PGPASSFILE: pgpass } });
  const r = go('orders-api@prod', 'ConnectionStrings__DB', '--pgpass');
  assert.equal(r.status, 0, r.stderr);
  assert.equal(r.stdout.includes('not-real'), false);
  assert.deepEqual(fs.readFileSync(pgpass, 'utf8').trim().split('\n'), ['other.host:5432:x:y:keep-me', 'localhost:5437:orders:root:p\\:w\\\\d-not-real', '127.0.0.1:5437:orders:root:p\\:w\\\\d-not-real']);
  assert.equal(fs.statSync(pgpass).mode & 0o777, 0o600);
  assert.equal(go('orders-api', 'ConnectionStrings__DB', '--pgpass').status, 2);
  fs.rmSync(d, { recursive: true });
  console.log('secret-psql tests ok');
}

// The Keychain store (macOS): the same set / names / value / remove, under a throwaway prefix.
if (process.platform === 'darwin') {
  const store = path.join(path.dirname(bin), 'secret-store');
  const env = { ...process.env, KOPPLER_SECRET_BACKEND: 'keychain', KOPPLER_KEYCHAIN_PREFIX: `koppler-selftest-${process.pid}` };
  delete env.KOPPLER_SECRETS;
  const ks = (args, input) => { const r = spawnSync(store, args, { encoding: 'utf8', env, input, timeout: 15000 }); return [r.status, r.stdout.trim()]; };
  const tricky = 'Host=db;Password=a "quoted" $val\\ue with spaces & ünïcode';
  try {
    assert.equal(ks(['set', 'orders-api', 'ConnectionStrings__DB'], tricky)[0], 0);
    assert.equal(ks(['set', 'orders-api', 'API_KEY'], 'k1')[0], 0);
    assert.equal(ks(['set', 'orders-api', 'API_KEY'], 'k2')[0], 0);
    assert.deepEqual(ks(['names', 'orders-api'])[1].replace(/^orders-api: */, '').split(' ').sort(), ['API_KEY', 'ConnectionStrings__DB']);
    assert.deepEqual(ks(['value', 'orders-api', 'ConnectionStrings__DB']), [0, tricky]);
    assert.deepEqual(ks(['value', 'orders-api', 'API_KEY']), [0, 'k2']);
    assert.equal(ks(['names', 'other-api'])[1], '');
    assert.notEqual(ks(['value', 'orders-api', 'MISSING'])[0], 0);
    assert.equal(ks(['set', 'orders-api', 'EMPTY'], '')[0], 1);
    assert.equal(ks(['set', '../x', 'A'], 'v')[0], 2);
  } finally {
    for (const n of ['ConnectionStrings__DB', 'API_KEY']) ks(['remove', 'orders-api', n]);
  }
  assert.equal(ks(['names', 'orders-api'])[1], '');
  console.log('keychain store tests ok');
}
