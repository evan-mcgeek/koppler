// A web app's browser console on its card: the page loads a small script from this server that forwards what it
// writes to the console, and its uncaught errors, into the app's log. Only with the app's own key, and only lines.
import crypto from 'node:crypto';
import fs from 'node:fs';
import type http from 'node:http';
import path from 'node:path';
import { APP_ID } from '../ids.ts';
import { writeJson } from '../json-files.ts';
import { logsDir, tempDir } from '../paths.ts';

const keysFile = () => path.join(tempDir(), 'console-keys.json');
const MAX_BODY = 64 * 1024;
const LEVELS = ['log', 'info', 'warn', 'error', 'debug'];

const keys = (): Record<string, string> => {
  try {
    return JSON.parse(fs.readFileSync(keysFile(), 'utf8')) as Record<string, string>;
  } catch {
    return {};
  }
};
/** The app's key: made once, kept on this Mac. */
export function consoleKey(app: string): string {
  const all = keys();
  const key = all[app] ?? crypto.randomBytes(16).toString('hex');
  if (!all[app]) writeJson(keysFile(), { ...all, [app]: key });
  return key;
}

/** The script the page loads: it keeps the console as it is and sends a copy of each line here, in batches. */
const script = (to: string) => `(() => {
  const to = ${JSON.stringify(to)};
  const queue = [];
  let timer = 0;
  const send = () => {
    timer = 0;
    const lines = queue.splice(0, 50);
    if (lines.length) fetch(to, { method: 'POST', mode: 'no-cors', keepalive: true, body: JSON.stringify(lines) }).catch(() => {});
  };
  const add = (level, text) => {
    queue.push({ level, text: String(text).slice(0, 2000) });
    if (!timer) timer = setTimeout(send, 300);
  };
  const said = value => {
    if (typeof value === 'string') return value;
    if (value instanceof Error) return value.stack || value.message;
    try { return JSON.stringify(value); } catch { return String(value); }
  };
  for (const level of ${JSON.stringify(LEVELS)}) {
    const own = console[level];
    console[level] = (...args) => {
      own.apply(console, args);
      add(level, args.map(said).join(' '));
    };
  }
  addEventListener('error', event => add('error', (event.error && event.error.stack) || event.message));
  addEventListener('unhandledrejection', event => add('error', 'Unhandled rejection: ' + said(event.reason)));
})();
`;

/** Answers /console.js and /console for a page of another origin, the app's: its key decides, not the token. */
export function serveConsole(req: http.IncomingMessage, res: http.ServerResponse, url: URL): void {
  const app = url.searchParams.get('app') ?? '';
  const given = Buffer.from(url.searchParams.get('key') ?? '');
  const own = Buffer.from(APP_ID.test(app) ? (keys()[app] ?? '') : '');
  if (!own.length || given.length !== own.length || !crypto.timingSafeEqual(given, own)) {
    req.resume();
    res.writeHead(404).end();
    return;
  }
  if (req.method === 'GET' && url.pathname === '/console.js') {
    // Loaded by the app's page, which is another origin.
    res.setHeader('cross-origin-resource-policy', 'cross-origin');
    res.writeHead(200, { 'content-type': 'text/javascript; charset=utf-8', 'cache-control': 'no-store' });
    res.end(
      script(`http://${req.headers.host ?? '127.0.0.1'}/console?app=${app}&key=${url.searchParams.get('key') ?? ''}`),
    );
    return;
  }
  if (req.method !== 'POST') {
    req.resume();
    res.writeHead(404).end();
    return;
  }
  let size = 0;
  const chunks: Buffer[] = [];
  req.on('data', (chunk: Buffer) => {
    size += chunk.length;
    if (size <= MAX_BODY) chunks.push(chunk);
  });
  req.on('end', () => {
    let lines: unknown;
    try {
      lines = size <= MAX_BODY ? JSON.parse(Buffer.concat(chunks).toString('utf8')) : null;
    } catch {
      lines = null;
    }
    const list = (Array.isArray(lines) ? (lines as unknown[]) : []).slice(0, 50).flatMap(line => {
      const { level, text } = (line ?? {}) as { level?: unknown; text?: unknown };
      if (typeof text !== 'string' || typeof level !== 'string' || !LEVELS.includes(level)) return [];
      const time = new Date().toTimeString().slice(0, 8);
      return text
        .slice(0, 2000)
        .split('\n')
        .map(one => `${time} browser ${level}: ${one}\n`);
    });
    try {
      if (list.length) {
        fs.mkdirSync(logsDir(), { recursive: true, mode: 0o700 });
        fs.appendFileSync(path.join(logsDir(), `${app}.log`), list.join(''), { mode: 0o600 });
      }
      res.writeHead(204).end();
    } catch {
      res.writeHead(500).end();
    }
  });
}
