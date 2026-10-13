// The canvas server. Publishes temp/status.json plus live port state and log tails as temp/status.js, which the canvas
// re-loads on a timer, and runs a loopback-only, token-protected HTTP server: the standalone canvas page, layout
// autosaves (the board, state.json) and Send/Stop prompts (temp/prompts.jsonl).
// Usage: node status-watch.mjs [--once]   (port 4747 or KOPPLER_PORT, token kept across restarts so the page URL in temp/canvas-url stays the same)
import crypto from 'node:crypto';
import fs from 'node:fs';
import http from 'node:http';
import type { AddressInfo } from 'node:net';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import * as z from 'zod';
import { StackSchema } from './core/stack.ts';
import { readData, type DataName } from './data.ts';
import { CODE, LOGS, STATE, TEMP } from './paths.ts';
import { tail } from './server/logs.ts';
import { ROUTES } from './server/routes.ts';
import { publish, SOURCE, statusJson } from './server/status.ts';

const MAX_BODY_BYTES = 256 * 1024;
const PORT = Number(process.env['KOPPLER_PORT']) || 4747;
const INTERVAL_MS = 1500;
const JSON_HEADERS = { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store' };

/** The files the page may load, by the path it asks for; `temp/` ones come from the run folder. */
const PAGE_FILES: Record<string, string> = {
  '': 'page/index.html',
  'theme.js': 'page/theme.js',
  'temp/debug.jsonl': 'temp/debug.jsonl',
};
const CONTENT_TYPES: Record<string, string> = {
  html: 'text/html; charset=utf-8',
  css: 'text/css; charset=utf-8',
  woff2: 'font/woff2',
  jsonl: 'text/plain; charset=utf-8',
};
// The page loads and calls nothing but this server, and no other page can frame it or learn its address.
const SECURITY_HEADERS = {
  'content-security-policy':
    "default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline'; img-src 'self' data:; font-src 'self' data:; frame-ancestors 'none'; base-uri 'none'; form-action 'none'",
  'referrer-policy': 'no-referrer',
  'x-content-type-options': 'nosniff',
  'x-frame-options': 'DENY',
  'cross-origin-resource-policy': 'same-origin',
};

type Request = http.IncomingMessage;
type Response = http.ServerResponse;
const logged = (error: unknown) => {
  console.error(`status-watch: ${(error as Partial<Error> | null)?.stack ?? String(error)}`);
};
/** A request that fails (a full disk, a file that cannot be written) is answered and logged; the server keeps running. */
function failRequest(res: Response, error: unknown): void {
  logged(error);
  try {
    if (res.headersSent) res.end();
    else {
      const said = (error as Partial<Error> | null)?.message ?? String(error);
      res
        .writeHead(500, JSON_HEADERS)
        .end(JSON.stringify({ error: `Koppler could not do that: ${said.slice(0, 300)}` }));
    }
  } catch {
    // The connection went away.
  }
}

/**
 * The request's JSON body, or null when it is not JSON. Too large a body is dropped as it arrives and answered once it
 * has all been sent: closing earlier would reach the sender as a broken connection instead of an answer. One that goes
 * on far beyond the limit is cut off.
 */
function readBody(req: Request, res: Response, onBody: (body: unknown) => void): void {
  let size = 0;
  const chunks: Buffer[] = [];
  req.on('data', (chunk: Buffer) => {
    size += chunk.length;
    if (size > MAX_BODY_BYTES * 256) req.destroy();
    else if (size <= MAX_BODY_BYTES) chunks.push(chunk);
  });
  req.on('end', () => {
    if (size > MAX_BODY_BYTES) {
      res.writeHead(413).end();
      return;
    }
    let body: unknown = null;
    try {
      body = JSON.parse(Buffer.concat(chunks).toString('utf8'));
    } catch {
      // Not JSON: each route says what it makes of nothing.
    }
    onBody(body);
  });
}

const DATA_FILE = /^data\/(registry|local|repos|state)\.json$/;
/** The files the page names: what its build put beside it. */
const assetFile = (what: string) => (/^assets\/[\w-][\w.-]*$/.test(what) ? `page/${what}` : undefined);

/** What the page loads: its own files, its data as scripts or as JSON, and an app's log. */
function servePage(what: string, url: URL, res: Response): void {
  // The open log tab reads its app's log here, much longer than the short tail every status carries.
  if (what === 'log') {
    const id = url.searchParams.get('app') ?? '';
    if (!/^[a-z0-9-]{1,64}$/.test(id)) {
      res.writeHead(400).end();
      return;
    }
    let file = path.join(LOGS, `${id}.log`);
    try {
      const status = JSON.parse(fs.readFileSync(SOURCE, 'utf8')) as { apps?: Record<string, { log?: string }> };
      file = status.apps?.[id]?.log || file;
    } catch {
      // No agent wrote a status: the log is where Koppler keeps it.
    }
    const text = tail(file, 2 * 1024 * 1024, 2000);
    const headers = { 'content-type': 'text/plain; charset=utf-8', 'cache-control': 'no-store' };
    res.writeHead(text === null ? 404 : 200, headers).end(text ?? '');
    return;
  }
  // The shape of a stack, for the settings panels: every field they show comes from it.
  if (what === 'data/stack-schema.json') {
    res
      .writeHead(200, JSON_HEADERS)
      .end(JSON.stringify(z.toJSONSchema(StackSchema, { unrepresentable: 'any', io: 'input' })));
    return;
  }
  if (what === 'data/status.json') {
    const status = statusJson();
    res.writeHead(status ? 200 : 404, JSON_HEADERS).end(status ?? 'null');
    return;
  }
  const asked = DATA_FILE.exec(what)?.[1] as DataName | undefined;
  if (asked) {
    const value = readData(asked);
    res.writeHead(value ? 200 : 404, JSON_HEADERS).end(JSON.stringify(value));
    return;
  }
  // Where the canvas was while it was built beside the page it replaced.
  if (what === 'next' || what === 'next/') {
    res.writeHead(308, { location: what === 'next' ? './' : '../' }).end();
    return;
  }
  const file = Object.hasOwn(PAGE_FILES, what) ? PAGE_FILES[what] : assetFile(what);
  if (!file) {
    res.writeHead(404).end();
    return;
  }
  const full = file.startsWith('temp/') ? path.join(TEMP, file.slice(5)) : path.join(CODE, file);
  fs.readFile(full, (error, body) => {
    if (error) {
      res.writeHead(404).end();
      return;
    }
    res
      .writeHead(200, {
        'content-type': CONTENT_TYPES[path.extname(file).slice(1)] ?? 'text/javascript; charset=utf-8',
        'cache-control': file.endsWith('.woff2') ? 'private, max-age=604800' : 'no-store',
      })
      .end(body);
  });
}

/** The page's token: kept across restarts, so an open canvas tab keeps working. */
function pageToken(): string {
  const file = path.join(STATE, 'canvas-token');
  try {
    const kept = fs.readFileSync(file, 'utf8').trim();
    if (/^[0-9a-f]{48}$/.test(kept)) return kept;
  } catch {
    // The first start on this Mac.
  }
  const token = crypto.randomBytes(24).toString('hex');
  fs.mkdirSync(STATE, { recursive: true, mode: 0o700 });
  fs.writeFileSync(file, token + '\n', { mode: 0o600 });
  return token;
}

/** Loopback only, token-protected. Serves the canvas standalone, takes layout autosaves and Send/Stop prompts. */
function startServer(): void {
  const token = pageToken();
  const prefix = `/s/${token}/`;
  const server = http.createServer((req, res) => {
    try {
      handle(req, res);
    } catch (error) {
      failRequest(res, error);
    }
  });
  function handle(req: Request, res: Response): void {
    const url = new URL(req.url ?? '', 'http://127.0.0.1');
    for (const [name, value] of Object.entries(SECURITY_HEADERS)) res.setHeader(name, value);
    // Answered once the request has been read to its end, so the sender gets the answer and not a broken connection.
    const refuse = (code: number) => {
      const answer = () => res.writeHead(code).end();
      req.resume();
      if (req.complete) answer();
      else req.once('end', answer);
    };
    // Only this machine's own page is answered: not another site's name pointed here, nor a request another site makes.
    const port = String((server.address() as AddressInfo).port);
    const own = ['127.0.0.1', 'localhost'].map(host => `${host}:${port}`);
    const { host = '', origin } = req.headers;
    if (!own.includes(host) || (origin !== undefined && !own.includes(origin.replace(/^http:\/\//, '')))) {
      refuse(403);
      return;
    }
    if (req.method === 'GET' && url.pathname.startsWith(prefix)) {
      servePage(url.pathname.slice(prefix.length), url, res);
      return;
    }
    const given = Buffer.from(url.searchParams.get('token') ?? '');
    const expected = Buffer.from(token);
    const authorized = given.length === expected.length && crypto.timingSafeEqual(given, expected);
    const route = Object.hasOwn(ROUTES, url.pathname) ? ROUTES[url.pathname] : undefined;
    if (req.method !== 'POST' || !authorized || !route) {
      refuse(404);
      return;
    }
    // A form on another site cannot send JSON without asking first, and that question is never answered.
    if (!/^application\/json\b/i.test(req.headers['content-type'] ?? '')) {
      refuse(415);
      return;
    }
    readBody(req, res, body => {
      const fields = body && typeof body === 'object' && !Array.isArray(body) ? (body as Record<string, unknown>) : {};
      // A route that throws, now or later, is answered like any failed request.
      new Promise(resolve => {
        resolve(route(fields));
      })
        .then(answered => {
          const { status, body: said, after } = answered as Awaited<ReturnType<typeof route>>;
          if (said === undefined) res.writeHead(status).end();
          else res.writeHead(status, JSON_HEADERS).end(JSON.stringify(said));
          after?.();
        })
        .catch((error: unknown) => {
          failRequest(res, error);
        });
    });
  }
  server.on('error', (error: NodeJS.ErrnoException) => {
    const said =
      error.code === 'EADDRINUSE' ? `port ${String(PORT)} is in use (another watcher? koppler status)` : error.message;
    console.error(`status-watch: ${said}`);
    process.exit(1);
  });
  server.listen(PORT, '127.0.0.1', () => {
    const page = `http://127.0.0.1:${String((server.address() as AddressInfo).port)}${prefix}`;
    fs.writeFileSync(path.join(TEMP, 'canvas-url'), page + '\n', { mode: 0o600 });
    console.log(`canvas: ${page}`);
  });
}

if (process.argv[1] && fs.realpathSync(process.argv[1]) === fileURLToPath(import.meta.url)) {
  // With --once the status is published a single time and nothing is served.
  const serving = !process.argv.includes('--once');
  // On a machine where Koppler never ran, nothing has made its folder yet.
  fs.mkdirSync(TEMP, { recursive: true, mode: 0o700 });
  // Said from the very first status on: a page that loaded can only have come from this server.
  if (serving) startServer();
  await publish(serving);
  if (serving) {
    // A slow publish is not started again on top of itself.
    let publishing = false;
    setInterval(() => {
      if (publishing) return;
      publishing = true;
      publish(serving)
        .catch((error: unknown) => {
          console.error(`status-watch: ${(error as Partial<Error> | null)?.message ?? String(error)}`);
        })
        .finally(() => {
          publishing = false;
        });
    }, INTERVAL_MS);
    // Whatever still slips through (a callback of a finished request) is logged; the canvas stays up.
    process.on('uncaughtException', logged);
    process.on('unhandledRejection', logged);
  }
}
