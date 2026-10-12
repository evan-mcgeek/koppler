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
const server = spawn(process.execPath, [path.join(path.dirname(fileURLToPath(import.meta.url)), '..', 'dist', 'status-watch.mjs')], { env, stdio: 'ignore' });
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

  // The new canvas: its page and the files that page names, and nothing else from its folder.
  const next = await call('GET', `${page.pathname}next/`);
  assert.equal(next.status, 200);
  assert.equal(next.headers['content-type'], 'text/html; charset=utf-8');
  assert.doesNotMatch(next.body.toString(), /(href|src)="https?:\/\//);
  const script = /assets\/[\w.-]+\.js/.exec(next.body.toString())[0];
  assert.equal((await call('GET', `${page.pathname}next/${script}`)).headers['content-type'], 'text/javascript; charset=utf-8');
  for (const not of ['next', 'next/index.html', 'next/assets/', 'next/assets/..%2Findex.html', 'next/assets/%2e%2e/index.html', 'data/secrets.json', 'data/state.json'])
    assert.equal((await call('GET', page.pathname + not)).status, 404, not);

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
  // The same status as JSON, for the new canvas; it does not hold the token either.
  const asJson = await call('GET', `${page.pathname}data/status.json`);
  assert.equal(asJson.headers['content-type'], 'application/json; charset=utf-8');
  assert.equal(JSON.parse(asJson.body.toString()).server, true);
  assert.equal(asJson.body.toString().includes(token), false);
  assert.equal(status().includes(token), false);

  // A request that fails is answered, and the server keeps running: a save while its folder cannot be written, a body too large.
  const save = `/state?token=${token}`, board = JSON.stringify({ nodes: {}, edges: [], env: 'qa', mode: 'auto' });
  assert.equal((await call('POST', save, json, board)).status, 204);
  // The board comes back as JSON, for the new canvas.
  const kept = await call('GET', `${page.pathname}data/state.json`);
  assert.equal(kept.headers['content-type'], 'application/json; charset=utf-8');
  assert.equal(JSON.parse(kept.body.toString()).env, 'qa');
  // A cable keeps its place on each side, where Arrange centred it and its waypoints; nothing else rides along.
  const cable = { from: 'web', to: 'orders', fromSide: 'bottom', toSide: 'top', fromSlot: 1, toSlot: 0, fromShift: 50, toShift: -50, points: [{ x: 10, y: 20, z: 1 }, { x: 'no' }], extra: 'x' };
  const layout = { nodes: { web: { x: 0, y: 0 } }, sides: { 'web>orders': ['bottom', 'top', 'x', 'y', 1, 0, [{ x: 10, y: 20 }], 50, -50, 'more'], 'web>catalog': ['left', 'right'], 'web>payments': ['up', 'top'] } };
  const withCable = JSON.stringify({ nodes: {}, edges: [cable], env: 'qa', mode: 'auto', presets: [{ name: 'One', version: 1, nodes: { web: { run: 'cli' } }, edges: [], layout }] });
  assert.equal((await call('POST', save, json, withCable)).status, 204);
  const back = JSON.parse((await call('GET', `${page.pathname}data/state.json`)).body.toString());
  assert.deepEqual(back.edges, [{ from: 'web', to: 'orders', fromSide: 'bottom', toSide: 'top', fromSlot: 1, toSlot: 0, fromShift: 50, toShift: -50, points: [{ x: 10, y: 20 }] }]);
  assert.deepEqual(back.presets[0].layout.sides, { 'web>orders': ['bottom', 'top', null, null, 1, 0, [{ x: 10, y: 20 }], 50, -50], 'web>catalog': ['left', 'right'] });
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
  // A card keeps the libraries it uses a local copy of, by name; anything else in that list is dropped.
  const withLibraries = JSON.stringify({ nodes: { web: { x: 0, y: 0, run: 'cli', libraries: ['acme-ui', 7, '', '@acme/kit'] }, orders: { x: 0, y: 0, libraries: 'acme-ui' } }, edges: [], env: 'qa', mode: 'auto' });
  assert.equal((await call('POST', save, json, withLibraries)).status, 204);
  const cards = JSON.parse((await call('GET', `${page.pathname}data/state.json`)).body.toString()).nodes;
  assert.deepEqual(cards.web.libraries, ['acme-ui', '@acme/kit']);
  assert.equal('libraries' in cards.orders, false);
  // Queue choices and the places of queue and outside cards are kept; anything else under those names is not.
  const withQueues = JSON.stringify({ nodes: {}, edges: [], env: 'qa', mode: 'auto', queues: { orders: 'local', mail: 'deployed', 'Bad Id': 'local' }, hiddenQueues: { audit: true, mail: false }, infra: { 'queue:orders': { x: 1, y: 2 }, 'outside:billing': { x: 3, y: 4 }, 'tunnel:db.example:5432': { x: 5, y: 6 }, 'queue:Bad Id': { x: 7, y: 8 }, other: { x: 9, y: 9 } } });
  assert.equal((await call('POST', save, json, withQueues)).status, 204);
  const queued = JSON.parse((await call('GET', `${page.pathname}data/state.json`)).body.toString());
  assert.deepEqual(queued.queues, { orders: 'local' });
  assert.deepEqual(queued.hiddenQueues, { audit: true });
  assert.deepEqual(Object.keys(queued.infra).sort(), ['outside:billing', 'queue:orders', 'tunnel:db.example:5432']);
  assert.equal((await call('POST', save, json, board)).status, 204);
  assert.equal((await call('GET', page.pathname)).status, 200);

  // Looking for clones again is the server's to run; with no stack set up yet it says so, in words for the page.
  const scan = await call('POST', `/rescan?token=${token}`, json, '{}');
  assert.equal(scan.status, 500);
  assert.match(JSON.parse(scan.body.toString()).error, /\S/);
  assert.equal((await call('POST', '/rescan?token=wrong', json, '{}')).status, 404);
  console.log('server tests ok');
} finally {
  server.kill();
  fs.rmSync(dir, { recursive: true, force: true });
}
