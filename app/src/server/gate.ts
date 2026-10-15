// The canvas server's gate: only this machine's own page, with the token, sending JSON, reaches a route; every answer
// carries the security headers, and a route that fails is answered, not the end of the server.
import crypto from 'node:crypto';
import type http from 'node:http';
import { JSON_HEADERS, serveFile } from './files.ts';
import { ROUTES } from './routes.ts';
import { serveConsole } from './browser-console.ts';

const MAX_BODY_BYTES = 256 * 1024;

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
export const logged = (error: unknown) => {
  console.error(`status-watch: ${(error as Partial<Error> | null)?.stack ?? String(error)}`);
};
/** A request that fails (a full disk, a file that cannot be written) is answered and logged; the server keeps running. */
export function failRequest(res: Response, error: unknown): void {
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

export function gate(req: Request, res: Response, token: string, port: string): void {
  const prefix = `/s/${token}/`;
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
  const own = ['127.0.0.1', 'localhost'].map(host => `${host}:${port}`);
  const { host = '', origin } = req.headers;
  // A web app's page sends its console here from its own origin: the app's key is checked instead of the token.
  if (own.includes(host) && (url.pathname === '/console.js' || url.pathname === '/console')) {
    serveConsole(req, res, url);
    return;
  }
  if (!own.includes(host) || (origin !== undefined && !own.includes(origin.replace(/^http:\/\//, '')))) {
    refuse(403);
    return;
  }
  if (req.method === 'GET' && url.pathname.startsWith(prefix)) {
    serveFile(url.pathname.slice(prefix.length), url, res);
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
