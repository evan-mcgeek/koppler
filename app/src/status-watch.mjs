// Publishes temp/status.json plus live port state and log tails as temp/status.js, which the canvas re-loads on a timer.
// Also runs a loopback-only, token-protected server: the standalone canvas page, layout autosaves (the board, state.json) and Send/Stop prompts (temp/prompts.jsonl).
// Usage: node status-watch.mjs [--once]   (port 4747 or KOPPLER_PORT, token kept across restarts so the page URL in temp/canvas-url stays the same)
import crypto from 'node:crypto';
import fs from 'node:fs';
import http from 'node:http';
import net from 'node:net';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { execFile, spawn } from 'node:child_process';
import { appendRun, live, runRecord, runningEnvs, runningNames, runs } from './engine/runs.ts';
import { addApps, removeApp, createStack, currentStack, forgetStacks, stacksHere, useStack } from './engine/sync.ts';
import { discardChanges, linkStack, linkedStatus, proposeChanges, updateStack } from './engine/linked.ts';
import { applyFindings, current as currentFindingsStack, discover } from './engine/discover.ts';
import { appendAnswer, clearMessages, readMessages } from './engine/messages.ts';
import { fetchPresets, sanitizeLayout, sanitizePrompt } from './server/sanitize.ts';
import { appendDebugLog, clearDebugLog, tail } from './server/logs.ts';
import { cableTest } from './server/cable-test.ts';
import { secretRequest, secretsStatus } from './server/secrets.ts';
import * as kinds from './core/kinds.ts';
import { recipesFor } from './engine/recipes.ts';
import { LOGS, STATE as STATE_HOME, TEMP } from './paths.ts';
import { redact } from './scrub.ts';
import { listenerPid } from './engine/listen.ts';
import { readData, writeData } from './data.ts';

const here = path.dirname(fileURLToPath(import.meta.url));

const SOURCE = path.join(TEMP, 'status.json');
const OUT = path.join(TEMP, 'status.js');
const PROMPTS = path.join(TEMP, 'prompts.jsonl');
const MAX_STATE_BYTES = 256 * 1024;
const STATE_DIR = STATE_HOME;
export const LOG_DIR = LOGS;
const PORT = Number(process.env.KOPPLER_PORT) || 4747;
const codeVersion = () => { try { return Math.max(...fs.readdirSync(here).filter(f => /\.m?js$/.test(f) && !f.includes('.test.')).map(f => fs.statSync(path.join(here, f)).mtimeMs)); } catch { return 0; } };
const STARTED_CODE = codeVersion();
const STARTED_AT = new Date().toISOString();
// Run from its source folder rather than an installed plugin: Koppler itself is being worked on, so the debug log stays on.
const DEV = !fs.realpathSync(here).split(path.sep).join('/').includes('/plugins/cache/');
const INTERVAL_MS = 1500, MOBILE_INTERVAL_MS = 5000;

const portOpen = port => new Promise(resolve => {
  const socket = net.connect({ host: '127.0.0.1', port, timeout: 400 });
  const done = open => { socket.destroy(); resolve(open); };
  socket.once('connect', () => done(true));
  socket.once('timeout', () => done(false));
  socket.once('error', () => done(false));
});

const run = (cmd, args) => new Promise(resolve =>
  execFile(cmd, args, { timeout: 4000, maxBuffer: 4 * 1024 * 1024 }, (err, stdout) => resolve(err ? '' : stdout)));

// The mobile app has no port: find its process on booted iOS simulators and connected Android devices.
export async function findMobileApp({ iosBundleId, androidPackage }) {
  const found = [];
  if (iosBundleId) {
    let booted = [];
    try { booted = Object.values(JSON.parse(await run('xcrun', ['simctl', 'list', 'devices', 'booted', '-j'])).devices).flat(); } catch {}
    for (const sim of booted) {
      const line = (await run('xcrun', ['simctl', 'spawn', sim.udid, 'launchctl', 'list']))
        .split('\n').find(l => l.includes(`UIKitApplication:${iosBundleId}[`));
      const pid = Number(line?.split(/\s+/)[0]);
      if (pid > 0) found.push({ platform: 'ios', device: sim.name, deviceId: sim.udid, pid });
    }
  }
  if (androidPackage) {
    const serials = (await run('adb', ['devices'])).split('\n').slice(1).map(l => l.split('\t')).filter(([, st]) => st?.trim() === 'device').map(([id]) => id);
    for (const serial of serials) {
      const pid = Number((await run('adb', ['-s', serial, 'shell', 'pidof', androidPackage])).trim().split(/\s+/)[0]);
      if (pid > 0) found.push({ platform: 'android', device: (await run('adb', ['-s', serial, 'shell', 'getprop', 'ro.product.model'])).trim() || serial, deviceId: serial, pid });
    }
  }
  const runs = (await run('ps', ['-Ao', 'command='])).split('\n').filter(l => l.includes('flutter_tools') && / run( |$)/.test(l));
  for (const app of found) {
    const r = runs.find(l => l.includes(app.deviceId)) || (runs.length === 1 ? runs[0] : null);
    if (!r) continue;
    app.flavor = r.match(/--flavor[= ](\S+)/)?.[1] ?? null;
    app.source = r.includes('--machine') ? 'ide' : 'cli';
  }
  return found;
}

let mobileApps = {}, mobileCheckedAt = 0;
function loadMobileConfig() {
  return Object.fromEntries(Object.entries(readData('registry')?.apps ?? {}).filter(([, a]) => a.mobile).map(([id, a]) => [id, a.mobile]));
}
// An app Koppler launched keeps no `flutter run` attached, so its flavor and device come from Koppler's own record of the start.
export function fromKoppler(id, found, record = (() => { try { return JSON.parse(fs.readFileSync(path.join(STATE_DIR, 'procs', `${id}.json`), 'utf8')); } catch { return null; } })()) {
  const command = String(record?.command ?? '');
  return found.map(app => app.flavor || !command.includes(app.deviceId) ? app : { ...app, flavor: command.match(/--flavor[= ](\S+)/)?.[1] ?? null, source: 'cli' });
}
let mobileState = {};
async function refreshMobile(ids) {
  if (Date.now() - mobileCheckedAt < MOBILE_INTERVAL_MS) return;
  mobileCheckedAt = Date.now();
  mobileApps = loadMobileConfig();
  for (const id of ids) if (mobileApps[id]) mobileState[id] = fromKoppler(id, await findMobileApp(mobileApps[id]));
  followIdeLogs();
}
// A mobile app on the applied board that runs from the IDE: Koppler follows its output with `flutter logs` on that device,
// so its card shows the app's own log instead of an older run's. Started once per device; Stop and revert stops it too.
const following = new Map();
function followIdeLogs() {
  const reg = loadRegistry(), board = live()?.nodes ?? {}, running = runningNames();
  const local = readData('local')?.apps ?? {};
  for (const [id, found] of Object.entries(mobileState)) {
    const ide = found.find(a => a.source === 'ide'), repo = local[id]?.path;
    if (!ide || !board[id] || !repo || running.includes(id) || following.get(id) === ide.deviceId) continue;
    following.set(id, ide.deviceId);
    const flutter = reg?.apps?.[id]?.flutter?.fvm ? ['fvm', 'flutter'] : ['flutter'];
    execFile(process.execPath, [path.join(here, 'koppler.mjs'), 'run', id, '--cwd', repo, '--restart', '--', ...flutter, 'logs', '-d', ide.deviceId], { timeout: 30000 }, () => {});
  }
}

const writeAtomic = (file, body) => { fs.writeFileSync(file + '.tmp', body, { mode: 0o600 }); fs.renameSync(file + '.tmp', file); };

let serving = false;
const FONTS = fs.readdirSync(path.join(here, 'fonts')).filter(f => /\.(woff2|css)$/.test(f)).map(f => `fonts/${f}`);
export const PAGE_FILES = { '': 'canvas.html', 'page/ports.js': 'page/ports.js', 'page/kinds.js': 'page/kinds.js', 'page/presets.js': 'page/presets.js', 'page/plan.js': 'page/plan.js', 'page/logfmt.js': 'page/logfmt.js', 'temp/status.js': 'temp/status.js', 'temp/debug.jsonl': 'temp/debug.jsonl', ...Object.fromEntries(FONTS.map(f => [f, f])) };
const PAGE_DATA = { 'temp/registry.js': { name: 'registry', global: 'REGISTRY' }, 'temp/local.js': { name: 'local', global: 'LOCAL' }, 'temp/repos.js': { name: 'repos', global: 'REPOS' }, 'temp/state.js': { name: 'state', global: 'SAVED_STATE' } };
const CONTENT_TYPES = { html: 'text/html; charset=utf-8', css: 'text/css; charset=utf-8', woff2: 'font/woff2', jsonl: 'text/plain; charset=utf-8' };
// The page loads and calls nothing but this server, and no other page can frame it or learn its address.
const SECURITY_HEADERS = {
  'content-security-policy': "default-src 'self'; script-src 'self' 'unsafe-inline'; style-src 'self' 'unsafe-inline'; img-src 'self' data:; frame-ancestors 'none'; base-uri 'none'; form-action 'none'",
  'referrer-policy': 'no-referrer', 'x-content-type-options': 'nosniff', 'x-frame-options': 'DENY', 'cross-origin-resource-policy': 'same-origin',
};
// A confirmed Send (koppler up) or Stop and revert (koppler down), carried out by Koppler itself; leftovers go to the agent.
function startRun(prompt, record, args) {
  const log = path.join(TEMP, `up-${record.id}.log`), out = fs.openSync(log, 'w', 0o600);
  fs.appendFileSync(path.join(TEMP, 'history.jsonl'), JSON.stringify({ id: record.id, event: 'picked', at: new Date().toISOString() }) + '\n', { mode: 0o600 });
  const child = spawn(process.execPath, [path.join(here, 'koppler.mjs'), ...args], { stdio: ['ignore', out, out], env: process.env });
  child.on('exit', code => {
    fs.closeSync(out);
    // A Stop from switching stacks switches once everything is stopped and reverted.
    if (code === 0 && record.kind === 'stop' && typeof prompt.data?.switchTo === 'string') execFile(process.execPath, [path.join(here, 'koppler.mjs'), 'use', prompt.data.switchTo], { timeout: 60000 }, () => {});
    if (code === 0) return;
    const said = (() => { try { return redact(fs.readFileSync(log, 'utf8')).trim().split('\n').slice(-40).join('\n'); } catch { return ''; } })();
    const handed = { ...prompt, text: `${prompt.text}\n\nKoppler already did what it could (koppler ${args[0]} --run ${record.id}); finish the rest, then koppler history --done ${record.kind === 'stop' ? record.id : ''}:\n${said}`, data: { ...prompt.data, koppler: { exit: code, log } } };
    fs.appendFileSync(PROMPTS, JSON.stringify(handed) + '\n', { mode: 0o600 });
  });
}

// A request that fails (a full disk, a file that cannot be written) is answered and logged; the server keeps running.
const failRequest = (res, e) => {
  console.error(`status-watch: ${e?.stack ?? e}`);
  try { if (res.headersSent) res.end(); else res.writeHead(500, { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store' }).end(JSON.stringify({ error: `Koppler could not do that: ${String(e?.message ?? e).slice(0, 300)}` })); } catch {}
};
const guarded = handle => (req, res) => { try { handle(req, res); } catch (e) { failRequest(res, e); } };
const readBody = (req, res, onError, onBody) => {
  let size = 0; const chunks = [];
  // Too large a body is dropped as it arrives and answered once it has all been sent: closing earlier would reach the
  // sender as a broken connection instead of an answer. One that goes on far beyond the limit is cut off.
  req.on('data', chunk => { size += chunk.length; if (size > MAX_STATE_BYTES * 256) req.destroy(); else if (size <= MAX_STATE_BYTES) chunks.push(chunk); });
  req.on('end', () => { if (size > MAX_STATE_BYTES) return void res.writeHead(413).end(); let body = null; try { body = JSON.parse(Buffer.concat(chunks).toString('utf8')); } catch {} try { onBody(body); } catch (e) { onError(e); } });
};

// Loopback only, token-protected. Serves the canvas standalone (no Lavish), takes layout autosaves and Send/Stop prompts.
function startServer() {
  // Said from the very first status on: a page that loaded can only have come from this server.
  serving = true;
  // A stable token keeps an open canvas tab working across watcher restarts.
  const tokenFile = path.join(STATE_DIR, 'canvas-token');
  let token = '';
  try { token = fs.readFileSync(tokenFile, 'utf8').trim(); } catch {}
  if (!/^[0-9a-f]{48}$/.test(token)) {
    token = crypto.randomBytes(24).toString('hex');
    fs.mkdirSync(STATE_DIR, { recursive: true, mode: 0o700 });
    fs.writeFileSync(tokenFile, token + '\n', { mode: 0o600 });
  }
  const server = http.createServer(guarded((req, res) => {
    const oops = e => failRequest(res, e);
    const url = new URL(req.url, 'http://127.0.0.1');
    const prefix = `/s/${token}/`;
    for (const [name, value] of Object.entries(SECURITY_HEADERS)) res.setHeader(name, value);
    // Only this machine's own page is answered: not another site's name pointed here, nor a request another site makes.
    const own = ['127.0.0.1', 'localhost'].map(h => `${h}:${server.address().port}`), origin = req.headers.origin;
    // Answered once the request has been read to its end, so the sender gets the answer and not a broken connection.
    const refuse = code => { const answer = () => res.writeHead(code).end(); req.resume(); if (req.complete) answer(); else req.once('end', answer); };
    if (!own.includes(req.headers.host) || (origin !== undefined && !own.includes(origin.replace(/^http:\/\//, '')))) return refuse(403);
    if (req.method === 'GET' && url.pathname.startsWith(prefix)) {
      // The open log tab reads its app's log here, much longer than the short tail every status carries.
      if (url.pathname.slice(prefix.length) === 'log') {
        const id = url.searchParams.get('app') ?? '';
        if (!/^[a-z0-9-]{1,64}$/.test(id)) { res.writeHead(400).end(); return; }
        let file = path.join(LOG_DIR, `${id}.log`);
        try { const own = JSON.parse(fs.readFileSync(SOURCE, 'utf8')).apps?.[id]?.log; if (own) file = own; } catch {}
        const text = tail(file, 2 * 1024 * 1024, 2000);
        res.writeHead(text === null ? 404 : 200, { 'content-type': 'text/plain; charset=utf-8', 'cache-control': 'no-store' }).end(text ?? '');
        return;
      }
      // The page still takes its data as scripts; each is made from the JSON run file when asked for.
      const data = PAGE_DATA[url.pathname.slice(prefix.length)];
      if (data) {
        const value = readData(data.name);
        res.writeHead(value ? 200 : 404, { 'content-type': 'text/javascript; charset=utf-8', 'cache-control': 'no-store' }).end(value ? `window.${data.global} = ${JSON.stringify(value)};\n` : '');
        return;
      }
      const file = PAGE_FILES[url.pathname.slice(prefix.length)];
      if (!file) { res.writeHead(404).end(); return; }
      const full = file.startsWith('temp/') ? path.join(TEMP, file.slice(5)) : path.join(here, file);
      fs.readFile(full, (err, body) => {
        if (err) { res.writeHead(404).end(); return; }
        res.writeHead(200, { 'content-type': CONTENT_TYPES[path.extname(file).slice(1)] ?? 'text/javascript; charset=utf-8', 'cache-control': file.endsWith('.woff2') ? 'private, max-age=604800' : 'no-store' }).end(body);
      });
      return;
    }
    const given = Buffer.from(url.searchParams.get('token') || ''), expected = Buffer.from(token);
    const authorized = given.length === expected.length && crypto.timingSafeEqual(given, expected);
    if (req.method !== 'POST' || !authorized || !['/state', '/prompt', '/preset', '/discover', '/discover-apply', '/stack', '/stack-update', '/stack-discard', '/stack-pr', '/apps', '/apps-remove', '/rescan', '/secret', '/secret-remove', '/secret-test', '/cable-test', '/messages-clear', '/message-dismiss', '/shutdown', '/stop-apps', '/debug-log', '/debug-clear', '/needs'].includes(url.pathname)) return refuse(404);
    // A form on another site cannot send JSON without asking first, and that question is never answered.
    if (!/^application\/json\b/i.test(req.headers['content-type'] ?? '')) return refuse(415);
    readBody(req, res, oops, body => {
      if (url.pathname === '/preset') {
        fetchPresets(typeof body?.url === 'string' ? body.url.slice(0, 500) : '').then(result => res.writeHead(result.error ? 400 : 200, { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store' }).end(JSON.stringify(result))).catch(oops);
        return;
      }
      if (['/stack-update', '/stack-discard', '/stack-pr'].includes(url.pathname)) {
        // The linked stack in use: bring in GitHub's changes, drop this copy's, or propose them as a pull request.
        const dir = currentStack(), send = (code, value) => res.writeHead(code, { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store' }).end(JSON.stringify(value));
        const work = url.pathname === '/stack-update' ? updateStack(dir) : url.pathname === '/stack-discard' ? Promise.resolve(discardChanges(dir)) : proposeChanges(dir);
        work.then(result => {
          if (result.error || url.pathname === '/stack-pr') return send(result.error ? 400 : 200, result);
          execFile('node', [path.join(here, 'koppler.mjs'), 'sync'], { timeout: 120000 }, () => send(200, result));
        }).catch(oops);
        return;
      }
      if (url.pathname === '/discover' || url.pathname === '/discover-apply') {
        // Findings are worked out again here, so only what Koppler itself found can be written, and only what the user ticked.
        const send = (code, value) => res.writeHead(code, { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store' }).end(JSON.stringify(value));
        const c = currentFindingsStack();
        if (!c) return send(400, { error: 'No stack is in use.' });
        let findings; try { findings = discover(c.stack, c.clones); } catch { return send(500, { error: 'Looking through the repos failed. Run koppler discover to see why.' }); }
        if (url.pathname === '/discover') return send(200, { findings });
        const r = applyFindings(c.stack, findings, Array.isArray(body?.ids) ? body.ids.filter(x => typeof x === 'string') : []);
        if (r.error) return send(400, r);
        fs.writeFileSync(c.source, JSON.stringify(r.stack, null, 2) + '\n');
        forgetStacks();
        execFile('node', [path.join(here, 'koppler.mjs'), 'sync'], { timeout: 120000 }, () => send(200, { applied: r.applied }));
        return;
      }
      if (url.pathname === '/stack' && typeof body?.link === 'string') {
        linkStack(body.link.slice(0, 500)).then(result => {
          if (result.error) return res.writeHead(400, { 'content-type': 'application/json; charset=utf-8' }).end(JSON.stringify(result));
          forgetStacks();
          execFile('node', [path.join(here, 'koppler.mjs'), 'sync'], { timeout: 120000 }, err => res.writeHead(err ? 500 : 200, { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store' }).end(JSON.stringify(err ? { error: 'The stack was linked, but could not be loaded. Run koppler sync.' } : { ok: true })));
        }).catch(oops);
        return;
      }
      if (url.pathname === '/stack') {
        // A new stack from the canvas: only a name and environment names; it is created empty and loaded.
        const result = typeof body?.use === 'string' ? useStack(body.use) : createStack(body);
        if (result.error) { res.writeHead(400, { 'content-type': 'application/json; charset=utf-8' }).end(JSON.stringify(result)); return; }
        execFile('node', [path.join(here, 'koppler.mjs'), 'sync'], { timeout: 120000 }, err => res.writeHead(err ? 500 : 200, { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store' }).end(JSON.stringify(err ? { error: 'The stack was created, but could not be loaded. Run koppler sync.' } : { ok: true })));
        return;
      }
      if (url.pathname === '/rescan') {
        // Looks through the user's folders for clones again, as `koppler sync --rescan` does.
        execFile(process.execPath, [path.join(here, 'koppler.mjs'), 'sync', '--rescan'], { timeout: 120000 }, (err, _out, said) => {
          const why = String(said ?? '').trim().split('\n').pop()?.replace(/^koppler: /, '') || 'The scan did not finish.';
          res.writeHead(err ? 500 : 200, { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store' }).end(JSON.stringify(err ? { error: why } : { ok: true }));
        });
        return;
      }
      if (url.pathname === '/apps-remove') {
        const result = typeof body?.id === 'string' && /^[a-z0-9-]{1,64}$/.test(body.id) ? removeApp(body.id) : { error: 'No app given' };
        forgetStacks();
        if (result.error) { res.writeHead(400, { 'content-type': 'application/json; charset=utf-8' }).end(JSON.stringify(result)); return; }
        execFile('node', [path.join(here, 'koppler.mjs'), 'sync'], { timeout: 120000 }, err => res.writeHead(err ? 500 : 200, { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store' }).end(JSON.stringify(err ? { error: 'The stack changed, but reloading it failed: run koppler sync' } : result)));
        return;
      }
      if (url.pathname === '/apps') {
        // Clones the user picked on the canvas join stack.json as apps that are not set up yet; then the stack is loaded again.
        const result = addApps(body?.apps);
        forgetStacks();
        if (result.error || !result.added.length) { res.writeHead(400, { 'content-type': 'application/json; charset=utf-8' }).end(JSON.stringify({ error: result.error ?? 'Pick at least one repo that is not in the stack yet.' })); return; }
        execFile('node', [path.join(here, 'koppler.mjs'), 'sync'], { timeout: 120000 }, err => res.writeHead(err ? 500 : 200, { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store' }).end(JSON.stringify(err ? { error: 'The apps were added, but the stack could not be loaded again. Run koppler sync.' } : result)));
        return;
      }
      if (url.pathname === '/needs') {
        // What the user has to do before these apps run on this environment, worked out live by `koppler doctor`.
        const ids = (Array.isArray(body?.apps) ? body.apps : []).filter(a => typeof a === 'string' && /^[a-z0-9-]{1,64}$/.test(a)).slice(0, 50);
        const env = typeof body?.env === 'string' && /^[a-z0-9-]{1,16}$/.test(body.env) ? body.env : null;
        if (!ids.length || !env) { res.writeHead(400, { 'content-type': 'application/json; charset=utf-8' }).end(JSON.stringify({ error: 'No apps or environment given' })); return; }
        const off = (Array.isArray(body?.noTunnels) ? body.noTunnels : []).filter(a => ids.includes(a));
        execFile('node', [path.join(here, 'koppler.mjs'), 'doctor', ...ids, '--env', env, ...(off.length ? ['--no-tunnels', off.join(',')] : []), '--json'], { timeout: 30000, maxBuffer: 1 << 20 }, (err, out) => {
          let result; try { result = JSON.parse(out); } catch { result = { error: 'Could not work out what is needed: run koppler doctor in a terminal' }; }
          res.writeHead(200, { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store' }).end(JSON.stringify(result));
        });
        return;
      }
      if (url.pathname === '/debug-log' || url.pathname === '/debug-clear') {
        const result = url.pathname === '/debug-clear' ? clearDebugLog() : appendDebugLog(body?.entries);
        res.writeHead(200, { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store' }).end(JSON.stringify(result));
        return;
      }
      // Shut down: the agent's listener, then this server through koppler (so its record goes too). Apps and tunnels keep running.
      if (url.pathname === '/shutdown') {
        res.writeHead(204).end();
        try { const pid = listenerPid(JSON.parse(fs.readFileSync(path.join(TEMP, 'listener.json'), 'utf8'))); if (pid) process.kill(pid, 'SIGTERM'); } catch {}
        try { fs.rmSync(path.join(TEMP, 'listener.json'), { force: true }); } catch {}
        spawn(process.execPath, [path.join(here, 'koppler.mjs'), 'stop', 'canvas'], { detached: true, stdio: 'ignore' }).unref();
        setTimeout(() => process.exit(0), 3000).unref();
        return;
      }
      // Stop apps, keep changes: everything Koppler runs except this canvas; branches and code changes stay for a later Revert.
      if (url.pathname === '/stop-apps') {
        execFile(process.execPath, [path.join(here, 'koppler.mjs'), 'stop', '--apps', '--yes'], { timeout: 60000 }, (err, out) => {
          res.writeHead(err ? 500 : 200, { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store' }).end(JSON.stringify({ stopped: String(out ?? '').trim().split('\n').filter(l => / stopped/.test(l)).map(l => l.split(':')[0]) }));
        });
        return;
      }
      if (url.pathname === '/message-dismiss') {
        const m = readMessages(200).find(x => x.id === body?.id && x.kind === 'question' && !x.answered);
        if (m) appendAnswer(m.id, { via: 'dismissed' });
        res.writeHead(m ? 204 : 409).end(); return;
      }
      if (url.pathname === '/messages-clear') { res.writeHead(200, { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store' }).end(JSON.stringify(clearMessages())); return; }
      if (url.pathname === '/cable-test') {
        // Tests of the same tunnel wait for each other: a tunnel drops connections when several open at once.
        const lane = typeof body?.port === 'number' ? `${body.host}:${body.port}` : null, before = lane ? tunnelLanes.get(lane) ?? Promise.resolve() : Promise.resolve();
        const run = before.then(() => cableTest(loadRegistry(), body));
        if (lane) tunnelLanes.set(lane, run.catch(() => {}));
        run.then(result => res.writeHead(200, { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store' }).end(JSON.stringify(result))).catch(oops);
        return;
      }
      if (url.pathname.startsWith('/secret')) {
        secretRequest({ '/secret': 'set', '/secret-remove': 'remove', '/secret-test': 'test' }[url.pathname], body)
          .then(result => res.writeHead(result.status, { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store' }).end(JSON.stringify(result.body))).catch(oops);
        return;
      }
      if (url.pathname === '/state') {
        const layout = sanitizeLayout(body);
        if (!layout) { res.writeHead(400).end(); return; }
        writeData('state', layout);
      } else {
        const prompt = sanitizePrompt(body);
        if (!prompt) { res.writeHead(400).end(); return; }
        // An answer to a question on the canvas: only for a message that exists and has no answer yet.
        if (prompt.tag === 'koppler-reply') {
          const m = readMessages(200).find(x => x.id === prompt.data.message);
          if (!m || m.answered) { res.writeHead(409).end(); return; }
          const choice = m.choices?.find(c => c.id === prompt.data.choice), said = typeof prompt.data.text === 'string' ? prompt.data.text.slice(0, 2000) : '';
          if (!choice && !said) { res.writeHead(400).end(); return; }
          prompt.data = { message: m.id, ...(m.run && { run: m.run }), ...(choice && { choice: choice.id, label: choice.label }), ...(said && { text: said }) };
          appendAnswer(m.id, { ...(choice && { choice: choice.id }), ...(said && { text: said }) });
        }
        // Kept as a run from the moment it is sent, so a Send nobody picked up still shows on the canvas.
        const record = runRecord(prompt);
        if (record) appendRun(record);
        // A confirmed Send in auto mode: Koppler starts it itself. Only what it cannot do alone goes on to the agent.
        const byAgent = prompt.data?.mode === 'manual' || prompt.data?.note || (prompt.data?.nodes ?? []).some(n => n?.note);
        if (record && record.kind === 'run' && !byAgent) startRun(prompt, record, ['up', '--run', record.id]);
        else if (record && record.kind === 'stop') startRun(prompt, record, ['down', '--run', record.id]);
        else fs.appendFileSync(PROMPTS, JSON.stringify(prompt) + '\n', { mode: 0o600 });
      }
      res.writeHead(204).end();
    });
  }));
  server.on('error', e => {
    console.error(e.code === 'EADDRINUSE' ? `status-watch: port ${PORT} is in use (another watcher? koppler status)` : `status-watch: ${e.message}`);
    process.exit(1);
  });
  server.listen(PORT, '127.0.0.1', () => {
    const base = `http://127.0.0.1:${server.address().port}`;
    const page = `${base}/s/${token}/`;
    fs.writeFileSync(path.join(TEMP, 'canvas-url'), page + '\n', { mode: 0o600 });
    console.log(`canvas: ${page}`);
  });
}

const loadRegistry = () => readData('registry');
// Tests of the same tunnel wait for each other.
const tunnelLanes = new Map();

// Every tunnel port in the stack, so cards can show whether their database or cache is reachable.
function tunnelPorts() {
  try {
    const apps = Object.values(readData('registry').apps);
    const declared = apps.flatMap(a => [...(a.prereqs ?? []), ...Object.values(a.envs ?? {}).flatMap(e => e.prereqs ?? [])]).filter(p => p.tunnel && Number.isInteger(p.port) && p.port > 0 && p.port < 65536).map(p => p.port);
    // Tunnels koppler moved to another port are checked there too.
    let running = [];
    try { running = fs.readdirSync(path.join(STATE_DIR, 'procs')).map(f => { try { return JSON.parse(fs.readFileSync(path.join(STATE_DIR, 'procs', f), 'utf8')).port; } catch { return null; } }).filter(Boolean); } catch {}
    return [...new Set([...declared, ...running])];
  } catch { return []; }
}

async function snapshot() {
  let status;
  try { status = JSON.parse(fs.readFileSync(SOURCE, 'utf8')); } catch { status = { apps: {} }; }
  // An app Koppler started itself (koppler up) has a card too, even when no agent wrote a status for it.
  status.apps ||= {};
  for (const name of runningNames()) {
    if (status.apps[name] || name === 'canvas' || name.startsWith('tunnel-')) continue;
    try { const rec = JSON.parse(fs.readFileSync(path.join(STATE_DIR, 'procs', `${name}.json`), 'utf8')); status.apps[name] = { ...(rec.port && { port: rec.port }), log: rec.log }; } catch {}
  }
  // The steps of the run Koppler applies itself (koppler up), for cards the agent wrote no checklist for.
  try {
    const progress = JSON.parse(fs.readFileSync(path.join(TEMP, 'progress.json'), 'utf8'));
    if (/^[a-z0-9]{6,40}$/.test(progress.run ?? '')) status.progress = { run: progress.run, env: String(progress.env ?? '').slice(0, 16), apps: Object.keys(progress.apps ?? {}).filter(id => /^[a-z0-9-]{1,64}$/.test(id)) };
    if (/^[a-z0-9]{6,40}$/.test(progress.run ?? '')) for (const [id, steps] of Object.entries(progress.apps ?? {})) {
      if (!/^[a-z0-9-]{1,64}$/.test(id) || !Array.isArray(steps)) continue;
      const app = status.apps[id] ||= {};
      if (!app.steps?.length) app.steps = steps.slice(0, 12).map(x => ({ label: String(x.label).slice(0, 60), state: ['done', 'failed', 'user', 'todo'].includes(x.state) ? x.state : 'todo', ...(x.detail && { detail: String(x.detail).slice(0, 300) }) }));
    }
  } catch {}
  // A mobile app on the applied board is looked for on the simulators and devices too, even when started from the IDE.
  { const reg = loadRegistry(); for (const id of Object.keys(live()?.nodes ?? {})) if (!status.apps[id] && reg?.apps?.[id] && kinds.of(reg.apps[id]).platforms) status.apps[id] = {}; }
  await refreshMobile(Object.keys(status.apps || {}));
  for (const [id, app] of Object.entries(status.apps || {})) {
    if (app.port) app.listening = await portOpen(app.port);
    if (mobileState[id]) app.running = mobileState[id];
    app.logTail = tail(app.log || path.join(LOG_DIR, `${id}.log`));
    delete app.log;
  }
  status.ports = Object.fromEntries(await Promise.all(tunnelPorts().map(async port => [port, await portOpen(port)])));
  status.secrets = await secretsStatus().catch(() => ({}));
  // Remembered code changes per app, with how each did on this Mac; the review lists the ones a Send applies.
  try {
    const reg = loadRegistry();
    status.recipes = Object.fromEntries(Object.keys(reg?.apps ?? {}).map(id => [id, recipesFor(reg, id).filter(r => !r.os || r.os === 'any' || r.os === process.platform)
      .map(r => ({ id: r.id, why: String(r.why).slice(0, 200), file: String(r.file).slice(0, 200), when: r.when, scope: r.scope, ...(r.here && { here: { ok: !!r.here.ok, at: String(r.here.at).slice(0, 10) } }) }))]).filter(([, l]) => l.length));
  } catch { status.recipes = {}; }
  status.stack = currentStack();
  // What the stack needs on this Mac, as `koppler doctor` last found it.
  try { status.checks = JSON.parse(fs.readFileSync(path.join(TEMP, 'checks.json'), 'utf8')).results.slice(0, 80).map(r => ({ name: String(r.name).slice(0, 80), state: String(r.state).slice(0, 16), detail: redact(String(r.detail ?? '')).slice(0, 400), ...(Array.isArray(r.for) && { for: r.for.slice(0, 10).map(x => String(x).slice(0, 80)) }), ...(r.state === 'gap' && { app: String(r.app).slice(0, 64), env: String(r.env).slice(0, 16), kind: String(r.kind).slice(0, 16) }) })); } catch { status.checks = null; }
  status.stacks = stacksHere();
  status.linked = status.stack ? linkedStatus(status.stack) : null;
  status.live = live();
  status.messages = readMessages();
  // Whether an agent session takes Sends: listening now, working on one it took (for up to two hours), or none.
  status.agent = (() => {
    let l; try { l = JSON.parse(fs.readFileSync(path.join(TEMP, 'listener.json'), 'utf8')); } catch { return { state: 'none' }; }
    if (l.pid) return listenerPid(l) ? { state: 'listening', since: l.since } : { state: 'none' };
    // Working on what it took, until it marks a run done or failed after that: then it has finished and is not listening.
    const ended = Math.max(0, ...runs().map(r => Date.parse(r.endedAt ?? '') || 0));
    return l.busy && Date.parse(l.busy) > ended && Date.now() - Date.parse(l.busy) < 2 * 3600 * 1000 ? { state: 'busy', since: l.since, busy: l.busy } : { state: 'none' };
  })();
  // Sends, Stops and answers no session has taken yet.
  try { status.queued = fs.readFileSync(PROMPTS, 'utf8').split('\n').filter(Boolean).length; } catch { status.queued = 0; }
  status.running = runningNames();
  status.runningEnvs = runningEnvs();
  status.runs = runs().slice(-20).map(({ nodes, edges, ...r }) => ({ ...r, nodes, edges }));
  status.at = new Date().toISOString();
  // The page works out the server's addresses from its own, so the token is in no file but its own.
  if (serving) status.server = true;
  try { status.pageVersion = fs.statSync(path.join(here, 'canvas.html')).mtimeMs; } catch {}
  // The page reloads itself; the server's own code only takes effect after a restart.
  status.startedAt = STARTED_AT;
  if (DEV) status.dev = true;
  status.start = 'koppler canvas';
  if (codeVersion() > STARTED_CODE) status.restart = `koppler stop canvas && ${status.start}`;
  return status;
}

async function publish() {
  const body = `window.__kopplerStatus && window.__kopplerStatus(${JSON.stringify(await snapshot())});\n`;
  writeAtomic(OUT, body);
}

if (process.argv[1] && fs.realpathSync(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const once = process.argv.includes('--once');
  // On a machine where Koppler never ran, nothing has made its folder yet.
  fs.mkdirSync(TEMP, { recursive: true, mode: 0o700 });
  if (!once) startServer();
  await publish();
  // A slow publish is not started again on top of itself.
  let publishing = false;
  if (!once) setInterval(() => { if (publishing) return; publishing = true; publish().catch(e => console.error(`status-watch: ${e?.message ?? e}`)).finally(() => { publishing = false; }); }, INTERVAL_MS);
  // Whatever still slips through (a callback of a finished request) is logged; the canvas stays up.
  if (!once) for (const event of ['uncaughtException', 'unhandledRejection']) process.on(event, e => console.error(`status-watch: ${e?.stack ?? e}`));
}
