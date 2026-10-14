// Checks that a stored credential really works, by connecting to the address inside the value itself.
// Says only the outcome: never the value, and never the server's own message (it can echo names from the value).
// A value is only ever sent to the host it names; nothing in stack.json can point a test somewhere else.
import { execFile, execFileSync } from 'node:child_process';
import net from 'node:net';
import tls from 'node:tls';
import { SECRET_TYPES } from './core/secret-types.ts';
import { clientEnv, findClient } from './safe-env.ts';

export const TYPES = SECRET_TYPES;
type Kind = 'postgres' | 'mysql' | 'redis';
const PORTS: Record<Kind, number> = { postgres: 5432, mysql: 3306, redis: 6379 };

/** Where a stored value points and how to sign in. */
export interface Connection {
  type: string;
  host: string;
  port: number;
  user: string;
  password: string;
  database?: string;
  tls?: boolean;
}
/** A connection, or one whose database cannot be told from the value (`type: null`). */
export type Parsed = Connection | { type: null; host?: undefined };
/** 0 connected, 1 failed, 2 cannot be tested. */
export interface Outcome {
  code: 0 | 1 | 2;
  message: string;
}

/** "Key=Value;Key=Value" as .NET writes it; a quoted value may hold a semicolon. */
export function keyValues(value: string): Record<string, string> {
  const out: Record<string, string> = {};
  for (const [, key = '', written = ''] of value.matchAll(
    /\s*([^=;]+?)\s*=\s*("(?:[^"]|"")*"|'(?:[^']|'')*'|[^;]*)\s*(?:;|$)/g,
  )) {
    const inside = written.slice(1, -1);
    out[key.toLowerCase()] = /^".*"$/.test(written)
      ? inside.replaceAll('""', '"')
      : /^'.*'$/.test(written)
        ? inside.replaceAll("''", "'")
        : written;
  }
  return out;
}
const pick = (pairs: Record<string, string>, ...names: string[]) =>
  names.map(name => pairs[name]).find(value => value !== undefined && value !== '');

/** A StackExchange.Redis value: "host:port,password=...,ssl=true". */
function redisOptions(written: string): Record<string, string | undefined> {
  const options = written
    .split(',')
    .filter(Boolean)
    .map((option): [string, string] => {
      const at = option.indexOf('=');
      return at < 0 ? [option.toLowerCase(), 'true'] : [option.slice(0, at).trim().toLowerCase(), option.slice(at + 1)];
    });
  return Object.fromEntries(options);
}

/**
 * Where the value points and how to sign in, or null when it is not a connection Koppler reads. `type` comes from the
 * stack, else from the value's shape.
 */
export function parse(value: string, type?: string): Parsed | null {
  const text = value.trim();
  const scheme = /^(postgres(?:ql)?|mysql|rediss?):\/\//i.exec(text)?.[1]?.toLowerCase();
  if (scheme) {
    let url: URL;
    try {
      url = new URL(text);
    } catch {
      return null;
    }
    const kind: Kind = scheme.startsWith('postgres') ? 'postgres' : scheme.startsWith('redis') ? 'redis' : 'mysql';
    return {
      type: type ?? kind,
      host: url.hostname,
      port: Number(url.port) || PORTS[kind],
      user: decodeURIComponent(url.username),
      password: decodeURIComponent(url.password),
      database: decodeURIComponent(url.pathname.slice(1)),
      tls: scheme === 'rediss',
    };
  }
  const [, redisHost, redisPort, redisRest] = /^([\w.-]+)(?::(\d+))?((?:,[^,]*)*)$/.exec(text) ?? [];
  if (redisHost !== undefined && (type === 'redis' || (!type && (redisPort || redisRest) && !text.includes(';')))) {
    const options = redisOptions(redisRest ?? '');
    return {
      type: 'redis',
      host: redisHost,
      port: Number(redisPort) || PORTS.redis,
      user: options['user'] ?? '',
      password: options['password'] ?? '',
      tls: /^true$/i.test(options['ssl'] ?? ''),
    };
  }
  const pairs = keyValues(text);
  const host = pick(pairs, 'host', 'server', 'data source', 'datasource', 'address');
  const user = pick(pairs, 'username', 'user id', 'userid', 'user', 'uid');
  if (!host || !user) return null;
  const port = Number(pick(pairs, 'port')) || null;
  // "Server=" is written for both; without a type the port decides.
  const postgresWords = pairs['host'] !== undefined || pairs['username'] !== undefined;
  const byShape = postgresWords
    ? 'postgres'
    : port === 3306
      ? 'mysql'
      : port === 5432
        ? 'postgres'
        : pairs['uid'] !== undefined
          ? 'mysql'
          : null;
  const kind = type ?? byShape;
  if (!kind) return { type: null };
  return {
    type: kind,
    host: host.split(',')[0] ?? '',
    port: port ?? PORTS[kind as Kind],
    user,
    password: pick(pairs, 'password', 'pwd') ?? '',
    database: pick(pairs, 'database', 'db', 'initial catalog') ?? '',
  };
}

const run = (command: string, args: string[], env: Record<string, string>) =>
  new Promise<{ ok: boolean; text: string }>(resolve => {
    execFile(command, args, { env: clientEnv(env), timeout: 20000, maxBuffer: 256 * 1024 }, (error, stdout, stderr) => {
      resolve({ ok: !error, text: `${stdout}${stderr}` });
    });
  });
const REFUSED =
  /password authentication failed|access denied|no pg_hba\.conf entry|WRONGPASS|NOAUTH|invalid username-password|invalid password/i;
const UNREACHED =
  /connection refused|could not connect|can't connect|timeout|timed out|server closed the connection|could not translate|unknown (mysql )?server host|ECONNREFUSED|ENOTFOUND|ECONNRESET|EHOSTUNREACH/i;
const REJECTED = 'failed: it rejected the connection';
/** The server's message decides the wording; the message itself is never passed on. */
const reason = (text: string) => {
  if (REFUSED.test(text)) return 'failed: it refused the user name or password';
  if (UNREACHED.test(text)) return 'failed: nothing answers at its address (is the tunnel up?)';
  if (/does not exist|unknown database/i.test(text))
    return 'failed: the database or user does not exist on that server';
  return REJECTED;
};
const outcomeOf = (ran: { ok: boolean; text: string }): Outcome =>
  ran.ok ? { code: 0, message: 'connected' } : { code: 1, message: reason(ran.text) };

async function postgres(to: Connection): Promise<Outcome> {
  const psql = findClient('psql', 'libpq');
  if (!psql) return { code: 2, message: 'cannot test: psql is not installed (brew install libpq)' };
  const args = [
    '-h',
    to.host,
    '-p',
    String(to.port),
    '-U',
    to.user,
    '-d',
    to.database || 'postgres',
    '-XAtc',
    'select 1',
  ];
  return outcomeOf(await run(psql, args, { PGPASSWORD: to.password, PGCONNECT_TIMEOUT: '10' }));
}
async function mysql(to: Connection): Promise<Outcome> {
  const client = findClient('mysql', 'mysql-client');
  if (!client)
    return { code: 2, message: 'cannot test: the mysql client is not installed (brew install mysql-client)' };
  const database = to.database ? ['-D', to.database] : [];
  const args = [
    '--connect-timeout=10',
    '-h',
    to.host,
    '-P',
    String(to.port),
    '-u',
    to.user,
    ...database,
    '-N',
    '-e',
    'select 1',
  ];
  return outcomeOf(await run(client, args, { MYSQL_PWD: to.password }));
}
/** Redis and Valkey speak a plain line protocol, so no client is needed: sign in if there is a password, then PING. */
function redis(to: Connection): Promise<Outcome> {
  return new Promise(resolve => {
    const options = { host: to.host, port: to.port, timeout: 10000 };
    const socket = to.tls
      ? tls.connect({ ...options, ...(!net.isIP(to.host) && { servername: to.host }) })
      : net.connect(options);
    const done = (code: 0 | 1, message: string) => {
      socket.destroy();
      resolve({ code, message });
    };
    const send = (...parts: string[]) => {
      const sized = parts.map(part => `$${String(Buffer.byteLength(part))}\r\n${part}\r\n`);
      socket.write(`*${String(parts.length)}\r\n${sized.join('')}`);
    };
    let waiting = to.password ? 'auth' : 'ping';
    let seen = '';
    socket.once(to.tls ? 'secureConnect' : 'connect', () => {
      if (waiting === 'auth') send('AUTH', ...(to.user ? [to.user] : []), to.password);
      else send('PING');
    });
    socket.on('data', (chunk: Buffer) => {
      seen += chunk.toString();
      if (!seen.includes('\r\n')) return;
      const line = seen.split('\r\n')[0] ?? '';
      seen = '';
      if (line.startsWith('-')) done(1, reason(/NOAUTH|WRONGPASS|invalid/i.test(line) ? line : 'rejected'));
      else if (waiting === 'auth') {
        waiting = 'ping';
        send('PING');
      } else if (line === '+PONG') done(0, 'connected');
      else done(1, REJECTED);
    });
    socket.on('timeout', () => {
      done(1, reason('timeout'));
    });
    socket.on('error', (error: NodeJS.ErrnoException) => {
      done(1, reason(error.code ?? error.message));
    });
  });
}
const TESTS: Record<string, ((to: Connection) => Promise<Outcome>) | undefined> = { postgres, mysql, redis };

/** Tries the connection a value holds. */
export async function check(value: string, type?: string): Promise<Outcome> {
  if (type && !(TYPES as readonly string[]).includes(type))
    return {
      code: 2,
      message: `cannot test: Koppler has no test for type "${type}" (it tests ${TYPES.join(', ')})`,
    };
  const found = parse(value, type);
  if (!found) return { code: 2, message: 'cannot test: not a database or cache connection Koppler reads' };
  if (found.type === null)
    return {
      code: 2,
      message: 'cannot test: say which database it is with "type" on this secret in stack.json (postgres or mysql)',
    };
  if (!found.host) return { code: 2, message: 'cannot test: the value names no host' };
  const test = TESTS[found.type];
  if (!test) throw new TypeError(`no test for ${found.type}`);
  return test(found);
}

/** secret-test <app or app@env> <NAME> [--type <type>] */
export async function main(args: string[], here: string): Promise<never> {
  const [store = '', name = ''] = args;
  const typeAt = args.indexOf('--type');
  const type = typeAt >= 0 ? args[typeAt + 1] : undefined;
  const fail = (message: string): never => {
    console.error(message);
    process.exit(2);
  };
  if (!/^[a-z0-9-]+(@[a-z0-9-]+)?$/.test(store)) fail(`invalid app id: ${store}`);
  if (!/^[A-Za-z_][A-Za-z0-9_]*$/.test(name)) fail(`invalid env name: ${name}`);
  let value = '';
  try {
    value = execFileSync(`${here}/secret-store`, ['value', store, name], {
      encoding: 'utf8',
      stdio: ['ignore', 'pipe', 'ignore'],
    });
  } catch {
    // Not stored, or the store refused: both read as not stored.
  }
  if (!value) {
    console.log('not stored');
    process.exit(2);
  }
  const { code, message } = await check(value, type);
  console.log(message);
  process.exit(code);
}
