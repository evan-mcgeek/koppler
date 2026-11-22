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

test('secret-test sends a key only to a host the user approved for that secret, and never prints it.', async () => {
  const { seen, server, url } = await api();
  const secrets = fs.mkdtempSync(path.join(os.tmpdir(), 'koppler-key-test-'));
  const config = process.env.KOPPLER_CONFIG_DIR;
  fs.writeFileSync(path.join(secrets, 'orders-api@prod.env'), `export PAYMENTS_KEY=${KEY}\n`);
  const env = { ...process.env, KOPPLER_SECRETS: secrets };
  // Run without blocking: the stand-in API answers from this process.
  const run = (file, args) =>
    new Promise(done => {
      execFile(file, args, { encoding: 'utf8', env }, (error, stdout, stderr) => {
        done([error ? error.code : 0, `${stdout}${stderr}`.trim()]);
      });
    });
  const tryIt = (at = `${url}/me`, store = 'orders-api@prod') =>
    run(secretTest, [store, 'PAYMENTS_KEY', '--type', 'key', '--url', at]);
  const koppler = (...args) => run('node', [entry, 'secret', ...args]);
  try {
    assert.deepEqual(await tryIt(), [
      2,
      'cannot test: approve sending it to 127.0.0.1 first: koppler secret approve orders-api@prod PAYMENTS_KEY 127.0.0.1',
    ]);
    assert.equal(seen.length, 0);

    assert.deepEqual(await koppler('approve', 'orders-api@prod', 'PAYMENTS_KEY', '127.0.0.1'), [
      0,
      'PAYMENTS_KEY of orders-api@prod may be sent to 127.0.0.1 to test it',
    ]);
    const kept = fs.readFileSync(path.join(config, 'approvals.json'), 'utf8');
    assert.equal(kept.includes(KEY), false);
    assert.deepEqual(await tryIt(), [0, 'accepted']);
    assert.equal(seen.length, 1);

    // One approval per secret and host: another secret, or another host, asks again.
    assert.equal((await tryIt('http://localhost:1/me'))[0], 2);
    assert.equal((await tryIt(`${url}/me`, 'orders-api'))[0], 2);
    assert.equal(seen.length, 1);

    assert.deepEqual(await koppler('revoke', 'orders-api@prod', 'PAYMENTS_KEY'), [0, 'PAYMENTS_KEY of orders-api@prod is no longer sent anywhere to test it']);
    assert.equal((await tryIt())[0], 2);
    assert.equal(seen.length, 1);

    assert.equal((await koppler('approve', 'orders-api@prod', 'PAYMENTS_KEY', 'https://127.0.0.1/x'))[0], 2);
    assert.equal((await koppler('approve', 'orders-api@prod', 'PAYMENTS_KEY'))[0], 2);
  } finally {
    server.close();
    fs.rmSync(secrets, { recursive: true });
  }
});
