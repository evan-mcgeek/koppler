import './sandbox.mjs';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import http from 'node:http';
import os from 'node:os';
import path from 'node:path';
import { execFile } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { test } from 'node:test';
import { check } from '../dist/secret-check.mjs';

/** What `koppler secret approve` writes once the user says yes at the terminal: the exact probe, url and header. */
function allowKey(config, store, name, url, header) {
  fs.mkdirSync(config, { recursive: true });
  fs.writeFileSync(path.join(config, 'approvals.json'), JSON.stringify({ koppler: '0.6.3', keys: [{ store, name, url, ...(header && { header }) }] }));
}

const here = path.dirname(fileURLToPath(import.meta.url));
const secretTest = path.join(here, '..', 'bin', 'secret-test');
const entry = path.join(here, '..', 'dist', 'koppler.mjs');
const KEY = 'sk_test_acme-not-real';

/** A stand-in API: answers 200 to the right key, 401 to any other, and `status` for /status. */
async function api() {
  const seen = [];
  const server = http.createServer((req, res) => {
    seen.push({ path: req.url, authorization: req.headers['authorization'], apiKey: req.headers['x-api-key'] });
    if (req.url === '/moved') return res.writeHead(302, { location: 'http://127.0.0.2/' }).end();
    if (req.url?.startsWith('/status/')) return res.writeHead(Number(req.url.slice(8))).end('body with sk_test_acme-not-real');
    const sent = req.headers['x-api-key'] ?? req.headers['authorization'];
    res.writeHead(sent === KEY || sent === `Bearer ${KEY}` ? 200 : 401).end(`echo ${String(sent)}`);
  });
  await new Promise(done => server.listen(0, '127.0.0.1', done));
  return { seen, server, url: `http://127.0.0.1:${String(server.address().port)}` };
}

test('A key is sent once, as a bearer token unless the stack names a header, and only the outcome comes back.', async () => {
  const { seen, server, url } = await api();
  try {
    assert.deepEqual(await check(KEY, 'key', { url: `${url}/me` }), { code: 0, message: 'accepted' });
    assert.deepEqual(seen.at(-1), { path: '/me', authorization: `Bearer ${KEY}`, apiKey: undefined });
    assert.deepEqual(await check(KEY, 'key', { url: `${url}/me`, header: 'X-Api-Key' }), { code: 0, message: 'accepted' });
    assert.deepEqual(seen.at(-1), { path: '/me', authorization: undefined, apiKey: KEY });
    assert.deepEqual(await check('sk_test_wrong', 'key', { url }), { code: 1, message: 'failed: it rejected the key' });
    assert.deepEqual(await check(KEY, 'key', { url: `${url}/status/403` }), { code: 1, message: 'failed: it rejected the key' });
    assert.deepEqual(await check(KEY, 'key', { url: `${url}/status/500` }), { code: 1, message: 'failed: it answered 500' });
    // A redirect is never followed: the key would go to another address.
    const count = seen.length;
    assert.deepEqual(await check(KEY, 'key', { url: `${url}/moved` }), { code: 1, message: 'failed: it answered 302' });
    assert.equal(seen.length, count + 1);
    assert.deepEqual(await check(`${KEY}\nX-Evil: 1`, 'key', { url }), { code: 2, message: 'cannot test: the value is more than one line' });
  } finally {
    server.close();
  }
  assert.deepEqual(await check(KEY, 'key', { url }), { code: 1, message: 'failed: nothing answers at its address (is the tunnel up?)' });
});

test('A key goes only to an https address, or to this Mac.', async () => {
  assert.deepEqual(await check(KEY, 'key', { url: 'http://api.acme-pay.test/me' }), {
    code: 2,
    message: 'cannot test: its probe address must start with https://',
  });
  assert.deepEqual(await check(KEY, 'key'), { code: 2, message: 'cannot test: say where to try it with probe.url on this secret' });
});

test('secret-test sends a key only to the exact probe the user approved for that secret, and never prints it.', async () => {
  const { seen, server, url } = await api();
  const secrets = fs.mkdtempSync(path.join(os.tmpdir(), 'koppler-key-test-'));
  const config = process.env.KOPPLER_CONFIG_DIR;
  const runDir = path.join(process.env.KOPPLER_STATE, 'run');
  fs.writeFileSync(path.join(secrets, 'orders-api@prod.env'), `export PAYMENTS_KEY=${KEY}\n`);
  // The prod overlay says where the key is tried on prod; approve reads it from there.
  const key = at => [{ env: 'PAYMENTS_KEY', type: 'key', probe: { url: at } }];
  fs.mkdirSync(runDir, { recursive: true });
  fs.writeFileSync(
    path.join(runDir, 'registry.json'),
    JSON.stringify({
      envs: ['qa', 'prod'],
      apps: {
        'orders-api': { name: 'Orders API', kind: 'node', secrets: key('https://api.acme-pay.test/me'), envs: { prod: { secrets: key(`${url}/me`) } } },
        web: { name: 'Web', kind: 'node' },
      },
    }),
  );
  const env = { ...process.env, KOPPLER_SECRETS: secrets };
  // Run without blocking: the stand-in API answers from this process.
  const run = (file, args) =>
    new Promise(done => {
      execFile(file, args, { encoding: 'utf8', env }, (error, stdout, stderr) => {
        done([error ? error.code : 0, `${stdout}${stderr}`.trim()]);
      });
    });
  const tryIt = (at = `${url}/me`, { store = 'orders-api@prod', header } = {}) =>
    run(secretTest, [store, 'PAYMENTS_KEY', '--type', 'key', '--url', at, ...(header ? ['--header', header] : [])]);
  const koppler = (...args) => run('node', [entry, 'secret', ...args]);
  try {
    // The command names no host or address: nothing in it needs quoting in a shell.
    assert.deepEqual(await tryIt(), [2, `cannot test: approve sending it to ${url}/me first: koppler secret approve orders-api@prod PAYMENTS_KEY`]);
    assert.equal(seen.length, 0);

    // Only a person at a terminal can approve: not a script, not an agent, not with --yes.
    const [code, said] = await koppler('approve', 'orders-api@prod', 'PAYMENTS_KEY', '--yes');
    assert.equal(code, 1);
    assert.match(said, /^koppler: not approved: approving needs you to answer at a terminal\. Run koppler secret approve orders-api@prod PAYMENTS_KEY in your own/);
    assert.equal(fs.existsSync(path.join(config, 'approvals.json')), false);
    assert.equal((await tryIt())[0], 2);
    assert.equal(seen.length, 0);

    allowKey(config, 'orders-api@prod', 'PAYMENTS_KEY', `${url}/me`);
    assert.deepEqual(await tryIt(), [0, 'accepted']);
    assert.equal(seen.length, 1);

    // The approval is for that exact probe: another path, port, scheme, header, secret or store asks again.
    const port = new URL(url).port;
    for (const changed of [`${url}/other`, `http://127.0.0.1:${String(Number(port) + 1)}/me`, `https://127.0.0.1:${port}/me`, `http://localhost:${port}/me`])
      assert.equal((await tryIt(changed))[0], 2, changed);
    assert.equal((await tryIt(`${url}/me`, { header: 'X-Api-Key' }))[0], 2);
    assert.equal((await tryIt(`${url}/me`, { store: 'orders-api' }))[0], 2);
    assert.equal(seen.length, 1);

    assert.deepEqual(await koppler('revoke', 'orders-api@prod', 'PAYMENTS_KEY'), [0, 'PAYMENTS_KEY of orders-api@prod is no longer sent anywhere to test it']);
    assert.equal((await tryIt())[0], 2);
    assert.equal(seen.length, 1);

    // Approve takes no address: the stack says where, and only a key with a probe can be approved.
    assert.equal((await koppler('approve', 'orders-api@prod', 'PAYMENTS_KEY', '127.0.0.1'))[0], 2);
    assert.equal((await koppler('approve', 'orders-api@prod'))[0], 2);
    assert.match((await koppler('approve', 'web', 'PAYMENTS_KEY'))[1], /PAYMENTS_KEY of web is not a key with probe\.url in the stack/);
  } finally {
    server.close();
    fs.rmSync(secrets, { recursive: true });
    fs.rmSync(path.join(runDir, 'registry.json'), { force: true });
  }
});
