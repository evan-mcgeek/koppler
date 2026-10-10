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

// secret-psql --pgpass writes the line tools look up, replaces an older one, prints no password and refuses a protected store.
{
  const psqlBin = path.join(path.dirname(bin), 'secret-psql');
  const d = fs.mkdtempSync(path.join(os.tmpdir(), 'koppler-secret-psql-')), pgpass = path.join(d, 'pgpass');
  const local = "Host=localhost;Port=5437;Database=orders;Username=root;Password=p:w\\d-not-real", remote = 'Host=db.internal;Database=or.ers;Username=root;Password=remote-not-real';
  fs.writeFileSync(path.join(d, 'orders-api.env'), `export ConnectionStrings__DB='${local}'\nexport REMOTE='${remote}'\n`);
  fs.writeFileSync(path.join(d, 'orders-api@prod.env'), `export ConnectionStrings__DB='${local}'\n`);
  fs.writeFileSync(pgpass, 'other.host:5432:x:y:keep-me\nlocalhost:5437:orders:root:old\n');
  const env = { ...process.env, KOPPLER_SECRETS: d, PGPASSFILE: pgpass };
  delete env.KOPPLER_SECRET_PROTECTED;
  const go = (args, extra) => spawnSync(psqlBin, args, { encoding: 'utf8', env: { ...env, ...extra } });
  const lines = () => fs.readFileSync(pgpass, 'utf8').trim().split('\n');
  const r = go(['orders-api', 'ConnectionStrings__DB', '--pgpass']);
  assert.equal(r.status, 0, r.stderr);
  assert.equal(r.stdout.includes('not-real'), false);
  const written = ['other.host:5432:x:y:keep-me', 'localhost:5437:orders:root:p\\:w\\\\d-not-real', '127.0.0.1:5437:orders:root:p\\:w\\\\d-not-real'];
  assert.deepEqual(lines(), written);
  assert.equal(fs.statSync(pgpass).mode & 0o777, 0o600);
  assert.equal(go(['orders-api', 'MISSING', '--pgpass']).status, 2);
  // A protected store never reaches the file: an environment's own store, unless Koppler says the stack leaves it open.
  const refused = go(['orders-api@prod', 'ConnectionStrings__DB', '--pgpass']);
  assert.equal(refused.status, 2);
  assert.match(refused.stderr, /is protected/);
  assert.equal(go(['orders-api', 'ConnectionStrings__DB', '--pgpass'], { KOPPLER_SECRET_PROTECTED: '1' }).status, 2);
  assert.deepEqual(lines(), written);
  assert.equal(go(['orders-api@prod', 'ConnectionStrings__DB', '--pgpass'], { KOPPLER_SECRET_PROTECTED: '0' }).status, 0);
  assert.deepEqual(lines(), written);
  // Another host: a second run replaces its line, and a name is matched as plain text.
  fs.appendFileSync(pgpass, 'db.internal:5432:orxers:root:keep-me-too\n');
  for (let i = 0; i < 2; i++) assert.equal(go(['orders-api', 'REMOTE', '--pgpass']).status, 0);
  assert.deepEqual(lines(), [...written, 'db.internal:5432:orxers:root:keep-me-too', 'db.internal:5432:or.ers:root:remote-not-real']);
  fs.rmSync(d, { recursive: true });
  console.log('secret-psql tests ok');
}

// The Keychain store (macOS): the same set / names / value / remove, in a keychain of its own inside a throwaway home,
// so the user's own keychain is never touched and the test does not depend on it.
if (process.platform === 'darwin') {
  const store = path.join(path.dirname(bin), 'secret-store');
  const home = fs.mkdtempSync(path.join(os.tmpdir(), 'koppler-keychain-')), keychain = path.join(home, 'Library', 'Keychains', 'test.keychain-db');
  const env = { ...process.env, HOME: home, KOPPLER_SECRET_BACKEND: 'keychain', KOPPLER_KEYCHAIN: keychain, KOPPLER_KEYCHAIN_PREFIX: `koppler-selftest-${process.pid}` };
  delete env.KOPPLER_SECRETS;
  fs.mkdirSync(path.dirname(keychain), { recursive: true });
  for (const args of [['create-keychain', '-p', 'test', keychain], ['unlock-keychain', '-p', 'test', keychain]]) {
    const made = spawnSync('security', args, { encoding: 'utf8', env });
    assert.equal(made.status, 0, `security ${args[0]}: ${made.stderr}`);
  }
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
  fs.rmSync(home, { recursive: true, force: true });
  console.log('keychain store tests ok');
}
