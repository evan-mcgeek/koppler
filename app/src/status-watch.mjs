// Publishes temp/status.json plus live port state and log tails as temp/status.js, which the canvas re-loads on a timer.
// Also runs a loopback-only, token-protected server: the standalone canvas page, layout autosaves (the board, state.json) and Send/Stop prompts (temp/prompts.jsonl).
// Usage: node status-watch.mjs [--once]   (port 4747 or KOPPLER_PORT, token kept across restarts so the page URL in temp/canvas-url stays the same)
import crypto from 'node:crypto';
import fs from 'node:fs';
import http from 'node:http';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { execFile, spawn } from 'node:child_process';
import { appendRun, runRecord } from './engine/runs.ts';
import { addApps, removeApp, createStack, currentStack, forgetStacks, useStack } from './engine/sync.ts';
import { discardChanges, linkStack, proposeChanges, updateStack } from './engine/linked.ts';
import { applyFindings, current as currentFindingsStack, discover } from './engine/discover.ts';
import { appendAnswer, clearMessages, readMessages } from './engine/messages.ts';
import { fetchPresets, sanitizeLayout, sanitizePrompt } from './server/sanitize.ts';
import { appendDebugLog, clearDebugLog, tail } from './server/logs.ts';
import { cableTest } from './server/cable-test.ts';
import { secretRequest } from './server/secrets.ts';
import { publish, SOURCE } from './server/status.ts';
import { LOGS, STATE as STATE_HOME, TEMP } from './paths.ts';
import { redact } from './scrub.ts';
import { listenerPid } from './engine/listen.ts';
import { readData, writeData } from './data.ts';

const here = path.dirname(fileURLToPath(import.meta.url));

const PROMPTS = path.join(TEMP, 'prompts.jsonl');
const MAX_STATE_BYTES = 256 * 1024;
const STATE_DIR = STATE_HOME;
export const LOG_DIR = LOGS;
const PORT = Number(process.env.KOPPLER_PORT) || 4747;
const INTERVAL_MS = 1500;

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

if (process.argv[1] && fs.realpathSync(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const once = process.argv.includes('--once');
  // On a machine where Koppler never ran, nothing has made its folder yet.
  fs.mkdirSync(TEMP, { recursive: true, mode: 0o700 });
  if (!once) startServer();
  await publish(serving);
  // A slow publish is not started again on top of itself.
  let publishing = false;
  if (!once) setInterval(() => { if (publishing) return; publishing = true; publish(serving).catch(e => console.error(`status-watch: ${e?.message ?? e}`)).finally(() => { publishing = false; }); }, INTERVAL_MS);
  // Whatever still slips through (a callback of a finished request) is logged; the canvas stays up.
  if (!once) for (const event of ['uncaughtException', 'unhandledRejection']) process.on(event, e => console.error(`status-watch: ${e?.stack ?? e}`));
}
