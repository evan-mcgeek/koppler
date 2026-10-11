import assert from 'node:assert/strict';
import fs from 'node:fs';
import http from 'node:http';
import os from 'node:os';
import path from 'node:path';
import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { freePorts, until } from './helpers.mjs';

// The canvas server answers its own page only, and keeps its token to itself.
const [PORT] = await freePorts(1), dir = fs.mkdtempSync(path.join(os.tmpdir(), 'koppler-server-')), temp = path.join(dir, 'state', 'run');
// The state folder does not exist yet, as on a machine where Koppler never ran: the server makes it.
const env = { ...process.env, KOPPLER_STATE: path.join(dir, 'state'), KOPPLER_TEMP: temp, KOPPLER_LOGS: path.join(dir, 'state', 'logs'), KOPPLER_CONFIG_DIR: path.join(dir, 'cfg'), KOPPLER_PORT: String(PORT) };
const server = spawn(process.execPath, [path.join(path.dirname(fileURLToPath(import.meta.url)), '..', 'src', 'status-watch.mjs')], { env, stdio: 'ignore' });
const call = (method, pathname, headers = {}, body) => new Promise((resolve, reject) => {
  const req = http.request({ host: '127.0.0.1', port: PORT, method, path: pathname, headers }, res => { const chunks = []; res.on('data', c => chunks.push(c)); res.on('end', () => resolve({ status: res.statusCode, headers: res.headers, body: Buffer.concat(chunks) })); });
  req.on('error', reject); req.end(body);
});

try {
  const urlFile = path.join(temp, 'canvas-url'), statusFile = path.join(temp, 'status.js');
  await until('the server starting', () => fs.existsSync(urlFile));
  const page = new URL(fs.readFileSync(urlFile, 'utf8').trim()), token = page.pathname.split('/')[2];
  const own = `http://127.0.0.1:${PORT}`, json = { 'content-type': 'application/json' }, clear = `/debug-clear?token=${token}`;

  const got = await call('GET', page.pathname);
  assert.equal(got.status, 200);
  assert.match(got.headers['content-security-policy'], /default-src 'self'.*frame-ancestors 'none'/);
  assert.equal(got.headers['referrer-policy'], 'no-referrer');
  assert.equal(got.headers['x-content-type-options'], 'nosniff');
  // The page asks no other site for anything.
  assert.doesNotMatch(got.body.toString(), /(href|src)="https?:\/\//);
  assert.equal((await call('GET', `${page.pathname}fonts/fonts.css`)).headers['content-type'], 'text/css; charset=utf-8');
  assert.equal((await call('GET', `${page.pathname}fonts/SchibstedGrotesk-latin.woff2`)).headers['content-type'], 'font/woff2');
  assert.equal((await call('GET', `${page.pathname}fonts/JetBrainsMono-OFL.txt`)).status, 404);
  assert.equal((await call('GET', `/s/${'0'.repeat(48)}/`)).status, 404);

  // Another site's name pointed at this machine, or a request another site makes, is refused.
  assert.equal((await call('GET', page.pathname, { host: `evil.example:${PORT}` })).status, 403);
  assert.equal((await call('GET', page.pathname, { host: `localhost:${PORT}` })).status, 200);
  assert.equal((await call('POST', clear, { ...json, origin: 'https://evil.example' }, '{}')).status, 403);
  assert.equal((await call('POST', clear, { ...json, origin: 'null' }, '{}')).status, 403);
  // What a form on another site can send is not JSON.
  assert.equal((await call('POST', clear, { 'content-type': 'text/plain', origin: own }, '{}')).status, 415);
  assert.equal((await call('POST', clear, { origin: own }, '{}')).status, 415);
  assert.equal((await call('POST', clear, { ...json, origin: own }, '{}')).status, 200);
  assert.equal((await call('POST', clear, json, '{}')).status, 200);
  assert.equal((await call('POST', '/debug-clear?token=wrong', { ...json, origin: own }, '{}')).status, 404);

  // The status file is private and does not hold the token.
  const status = () => { try { return fs.readFileSync(statusFile, 'utf8'); } catch { return ''; } };
  await until('a status from the running server', () => status().includes('"server":true'));
  assert.equal(fs.statSync(statusFile).mode & 0o777, 0o600);
  assert.equal(status().includes(token), false);

  // A request that fails is answered, and the server keeps running: a save while its folder cannot be written, a body too large.
  const save = `/state?token=${token}`, board = JSON.stringify({ nodes: {}, edges: [], env: 'qa', mode: 'auto' });
  assert.equal((await call('POST', save, json, board)).status, 204);
  if (process.getuid?.() !== 0) {
    fs.chmodSync(temp, 0o500);
    try {
      const failed = await call('POST', save, json, board);
      assert.equal(failed.status, 500);
      assert.match(JSON.parse(failed.body.toString()).error, /^Koppler could not do that: /);
    } finally { fs.chmodSync(temp, 0o700); }
  }
  assert.equal((await call('POST', save, json, 'a'.repeat(9_000_000))).status, 413);
  assert.equal((await call('POST', save, json, board)).status, 204);
  assert.equal((await call('GET', page.pathname)).status, 200);
  console.log('server tests ok');
} finally {
  server.kill();
  fs.rmSync(dir, { recursive: true, force: true });
}
