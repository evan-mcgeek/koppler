// Checks that a stored credential really works, by connecting to the address inside the value itself.
// Says only the outcome: never the value, and never the server's own message (it can echo names from the value).
// A value is only ever sent to the host it names; nothing in stack.json can point a test somewhere else.
import net from 'node:net';
import tls from 'node:tls';
import { execFile, execFileSync } from 'node:child_process';
import { clientEnv, findClient } from './safe-env.ts';
import { SECRET_TYPES } from './core/stack.ts';

export const TYPES = SECRET_TYPES;
const PORTS = { postgres: 5432, mysql: 3306, redis: 6379 };

// "Key=Value;Key=Value" as .NET writes it; a quoted value may hold a semicolon.
export function keyValues(value) {
  const out = {};
  for (const m of String(value).matchAll(/\s*([^=;]+?)\s*=\s*("(?:[^"]|"")*"|'(?:[^']|'')*'|[^;]*)\s*(?:;|$)/g)) {
    const v = m[2];
    out[m[1].toLowerCase()] = /^".*"$/.test(v) ? v.slice(1, -1).replaceAll('""', '"') : /^'.*'$/.test(v) ? v.slice(1, -1).replaceAll("''", "'") : v;
  }
  return out;
}
const pick = (kv, ...names) => names.map(n => kv[n]).find(v => v !== undefined && v !== '');

// Where the value points and how to sign in, or null when it is not a connection Koppler reads. `type` comes from the stack, else from the value's shape.
export function parse(value, type) {
  const text = String(value).trim();
  const url = text.match(/^(postgres(?:ql)?|mysql|rediss?):\/\//i);
  if (url) {
    let u; try { u = new URL(text); } catch { return null; }
    const scheme = url[1].toLowerCase(), kind = scheme.startsWith('postgres') ? 'postgres' : scheme.startsWith('redis') ? 'redis' : 'mysql';
    return { type: type ?? kind, host: u.hostname, port: Number(u.port) || PORTS[kind], user: decodeURIComponent(u.username), password: decodeURIComponent(u.password), database: decodeURIComponent(u.pathname.slice(1)), tls: scheme === 'rediss' };
  }
  // StackExchange.Redis: "host:port,password=...,ssl=true"
  const redis = text.match(/^([\w.-]+)(?::(\d+))?((?:,[^,]*)*)$/);
  if (redis && (type === 'redis' || (!type && (redis[2] || redis[3]) && !text.includes(';')))) {
    const opts = Object.fromEntries(redis[3].split(',').filter(Boolean).map(o => { const i = o.indexOf('='); return i < 0 ? [o.toLowerCase(), 'true'] : [o.slice(0, i).trim().toLowerCase(), o.slice(i + 1)]; }));
    return { type: 'redis', host: redis[1], port: Number(redis[2]) || PORTS.redis, user: opts.user ?? '', password: opts.password ?? '', tls: /^true$/i.test(opts.ssl ?? '') };
  }
  const kv = keyValues(text), host = pick(kv, 'host', 'server', 'data source', 'datasource', 'address'), user = pick(kv, 'username', 'user id', 'userid', 'user', 'uid');
  if (!host || !user) return null;
  const port = Number(pick(kv, 'port')) || null;
  // "Server=" is written for both; without a type the port decides.
  const kind = type ?? (kv.host !== undefined || kv.username !== undefined ? 'postgres' : port === 3306 ? 'mysql' : port === 5432 ? 'postgres' : kv.uid !== undefined ? 'mysql' : null);
  if (!kind) return { type: null };
  return { type: kind, host: host.split(',')[0], port: port ?? PORTS[kind], user, password: pick(kv, 'password', 'pwd') ?? '', database: pick(kv, 'database', 'db', 'initial catalog') ?? '' };
}

const run = (cmd, args, env) => new Promise(resolve => execFile(cmd, args, { env: clientEnv(env), timeout: 20000, maxBuffer: 256 * 1024 }, (err, stdout, stderr) => resolve({ ok: !err, text: `${stdout}${stderr}` })));
// The server's message decides the wording; the message itself is never passed on.
const reason = text => /password authentication failed|access denied|no pg_hba\.conf entry|WRONGPASS|NOAUTH|invalid username-password|invalid password/i.test(text) ? 'failed: it refused the user name or password'
  : /connection refused|could not connect|can't connect|timeout|timed out|server closed the connection|could not translate|unknown (mysql )?server host|ECONNREFUSED|ENOTFOUND|ECONNRESET|EHOSTUNREACH/i.test(text) ? 'failed: nothing answers at its address (is the tunnel up?)'
  : /does not exist|unknown database/i.test(text) ? 'failed: the database or user does not exist on that server'
  : 'failed: it rejected the connection';

async function postgres(c) {
  const psql = findClient('psql', 'libpq');
  if (!psql) return { code: 2, message: 'cannot test: psql is not installed (brew install libpq)' };
  const r = await run(psql, ['-h', c.host, '-p', String(c.port), '-U', c.user, '-d', c.database || 'postgres', '-XAtc', 'select 1'], { PGPASSWORD: c.password, PGCONNECT_TIMEOUT: '10' });
  return r.ok ? { code: 0, message: 'connected' } : { code: 1, message: reason(r.text) };
}
async function mysql(c) {
  const bin = findClient('mysql', 'mysql-client');
  if (!bin) return { code: 2, message: 'cannot test: the mysql client is not installed (brew install mysql-client)' };
  const r = await run(bin, ['--connect-timeout=10', '-h', c.host, '-P', String(c.port), '-u', c.user, ...(c.database ? ['-D', c.database] : []), '-N', '-e', 'select 1'], { MYSQL_PWD: c.password });
  return r.ok ? { code: 0, message: 'connected' } : { code: 1, message: reason(r.text) };
}
// Redis and Valkey speak a plain line protocol, so no client is needed: sign in if there is a password, then PING.
function redis(c) {
  return new Promise(resolve => {
    const done = (code, message) => { socket.destroy(); resolve({ code, message }); };
    const socket = (c.tls ? tls : net).connect({ host: c.host, port: c.port, servername: c.tls && !net.isIP(c.host) ? c.host : undefined, timeout: 10000 });
    const send = (...parts) => socket.write(`*${parts.length}\r\n${parts.map(p => `$${Buffer.byteLength(p)}\r\n${p}\r\n`).join('')}`);
    let waiting = c.password ? 'auth' : 'ping', seen = '';
    socket.once(c.tls ? 'secureConnect' : 'connect', () => waiting === 'auth' ? send('AUTH', ...(c.user ? [c.user] : []), c.password) : send('PING'));
    socket.on('data', chunk => {
      seen += chunk;
      if (!seen.includes('\r\n')) return;
      const line = seen.split('\r\n')[0]; seen = '';
      if (line.startsWith('-')) return done(1, reason(/NOAUTH|WRONGPASS|invalid/i.test(line) ? line : 'rejected'));
      if (waiting === 'auth') { waiting = 'ping'; return send('PING'); }
      done(line === '+PONG' ? 0 : 1, line === '+PONG' ? 'connected' : 'failed: it rejected the connection');
    });
    socket.on('timeout', () => done(1, reason('timeout')));
    socket.on('error', e => done(1, reason(e.code ?? e.message)));
  });
}

// { code: 0 connected | 1 failed | 2 cannot be tested, message }
export async function check(value, type) {
  if (type && !TYPES.includes(type)) return { code: 2, message: `cannot test: Koppler has no test for type "${type}" (it tests ${TYPES.join(', ')})` };
  const c = parse(value, type);
  if (!c) return { code: 2, message: 'cannot test: not a database or cache connection Koppler reads' };
  if (!c.type) return { code: 2, message: 'cannot test: say which database it is with "type" on this secret in stack.json (postgres or mysql)' };
  if (!c.host) return { code: 2, message: 'cannot test: the value names no host' };
  return { postgres, mysql, redis }[c.type](c);
}

// secret-test <app or app@env> <NAME> [--type <type>]
export async function main(args, here) {
  const [store, name] = args, typeAt = args.indexOf('--type'), type = typeAt >= 0 ? args[typeAt + 1] : undefined;
  const fail = message => { console.error(message); process.exit(2); };
  if (!/^[a-z0-9-]+(@[a-z0-9-]+)?$/.test(store ?? '')) fail(`invalid app id: ${store ?? ''}`);
  if (!/^[A-Za-z_][A-Za-z0-9_]*$/.test(name ?? '')) fail(`invalid env name: ${name ?? ''}`);
  let value = '';
  try { value = execFileSync(`${here}/secret-store`, ['value', store, name], { encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] }); } catch {}
  if (!value) { console.log('not stored'); process.exit(2); }
  const { code, message } = await check(value, type);
  console.log(message);
  process.exit(code);
}
