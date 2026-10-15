// The Test button on a cable, and `koppler doctor --flow`. An app cable asks the callee's local address for any answer;
// a tunnel link opens its port and, when the app has one stored credential of that kind, logs in with it. Only this
// Mac's own addresses are ever tried.
import dns from 'node:dns';
import fs from 'node:fs';
import http from 'node:http';
import https from 'node:https';
import net from 'node:net';
import path from 'node:path';
import tls from 'node:tls';
import { launchProfile, type LaunchProfiles } from '../core/launch.ts';
import { isProtected } from '../core/plan.ts';
import type { App } from '../core/stack.ts';
import { readClones, type Registry } from '../data.ts';
import { stateDir } from '../paths.ts';
import { alive, readRecord } from '../engine/processes.ts';
import { declaredSecrets, secretRequest } from './secrets.ts';
import { appOn } from '../core/stack.ts';

/** What a test came to, in a few words for the cable and a sentence for its panel. */
export interface Tested {
  ok: boolean;
  /** It could not be told either way. */
  unsure?: boolean;
  text: string;
  detail: string;
}
type Kind = 'postgres' | 'mysql' | 'redis';
/** A .NET caller's -LOCAL launch profile for an environment. */
interface Profile {
  name: string;
  env: Record<string, string> | null;
  changed?: number;
  started?: number | null;
}
/** What a test asks of the world; stood in for in tests. */
export interface Probe {
  answers: (url: URL) => Promise<{ status: number | undefined; ms: number; body?: string } | null>;
  opens: (host: string, port: number) => Promise<boolean>;
  speaks: (kind: Kind, host: string, port: number) => Promise<boolean>;
  leadsHere: (name: string) => Promise<boolean>;
  profile: (id: string, env: string) => Profile | null;
  /** The settings Koppler started the app with, while it runs; null when it does not run as Koppler started it. */
  started: (id: string) => Record<string, string> | null;
  login: (app: string, env: string, name: string) => Promise<{ ok?: boolean; message?: string; error?: string }>;
}
type Body = Record<string, unknown>;

const LOOPBACK = /^(localhost|127(\.\d{1,3}){3})$/;
const KIND_BY_PORT: Record<number, Kind | undefined> = { 5432: 'postgres', 3306: 'mysql', 6379: 'redis' };
const KIND_NAME = { postgres: 'Postgres', mysql: 'MySQL', redis: 'Redis or Valkey' };
const pause = (ms: number) => new Promise(resolve => setTimeout(resolve, ms));

const answers: Probe['answers'] = url =>
  new Promise(resolve => {
    const started = Date.now();
    const done = (value: Awaited<ReturnType<Probe['answers']>>) => {
      clearTimeout(timer);
      resolve(value);
    };
    const get = url.protocol === 'https:' ? https.get : http.get;
    const request = get(url, { rejectUnauthorized: !LOOPBACK.test(url.hostname) }, response => {
      let body = '';
      response.on('data', (chunk: Buffer) => {
        if (body.length < 2048) body += chunk.toString();
      });
      response.on('end', () => {
        done({ status: response.statusCode, ms: Date.now() - started, body });
      });
    });
    const timer = setTimeout(() => {
      request.destroy();
      done(null);
    }, 4000);
    request.once('error', () => {
      done(null);
    });
  });
const opens: Probe['opens'] = (host, port) =>
  new Promise(resolve => {
    const socket = net.connect({ host, port, timeout: 1500 });
    const done = (open: boolean) => {
      socket.destroy();
      resolve(open);
    };
    socket.once('connect', () => {
      done(true);
    });
    socket.once('timeout', () => {
      done(false);
    });
    socket.once('error', () => {
      done(false);
    });
  });

/** One exchange with whatever listens there: say `hello` (if anything), and judge the first thing it says back. */
function talk(
  open: () => net.Socket,
  ready: 'connect' | 'secureConnect',
  hello: string | Buffer | null,
  good: (data: Buffer) => boolean,
): Promise<boolean> {
  return new Promise(resolve => {
    const socket = open();
    const done = (value: boolean) => {
      clearTimeout(timer);
      socket.destroy();
      resolve(value);
    };
    const timer = setTimeout(() => {
      done(false);
    }, 6000);
    socket.once(ready, () => {
      if (hello) socket.write(hello);
    });
    socket.once('data', (data: Buffer) => {
      done(good(data));
    });
    socket.once('error', () => {
      done(false);
    });
    socket.once('close', () => {
      done(false);
    });
  });
}
/**
 * Whether a real server of that kind answers through a tunnel: the tunnel program listens even when nothing is behind
 * it. Postgres answers an SSL request with one byte, MySQL greets first, Redis and Valkey answer PING (in plain text or
 * over TLS).
 */
const speaks: Probe['speaks'] = (kind, host, port) => {
  const plain = () => net.connect({ host, port });
  const secure = () => tls.connect({ host, port, rejectUnauthorized: false });
  if (kind === 'postgres')
    return talk(plain, 'connect', Buffer.from([0, 0, 0, 8, 4, 210, 22, 47]), data => data[0] === 83 || data[0] === 78);
  if (kind === 'mysql')
    return talk(plain, 'connect', null, data => data.length > 4 && (data[4] === 10 || data[4] === 255));
  const pong = (data: Buffer) => /^[+-]/.test(data.toString());
  // Plain and TLS are tried at once: a TLS-only cache never answers a plain PING, and waiting for that first would eat
  // the time.
  return Promise.all([talk(plain, 'connect', 'PING\r\n', pong), talk(secure, 'secureConnect', 'PING\r\n', pong)]).then(
    answered => answered.some(Boolean),
  );
};
const leadsHere: Probe['leadsHere'] = name =>
  dns.promises.lookup(name, { all: true }).then(
    found => found.some(one => one.address === '::1' || LOOPBACK.test(one.address)),
    () => false,
  );

/** The -LOCAL launch profile's settings of a .NET caller for an environment, to see where it is pointed. */
function localProfile(stack: Registry, id: string, env: string): Profile | null {
  try {
    const app = stack.apps[id];
    const repo = readClones()[id]?.path;
    if (!app?.launchSettings || !repo) return null;
    const file = path.join(repo, app.launchSettings);
    const text = fs.readFileSync(file, 'utf8').replace(/^\uFEFF/, '');
    const settings = JSON.parse(text) as { profiles?: LaunchProfiles };
    const profiles = settings.profiles ?? {};
    const name = launchProfile(app, profiles, env).local;
    const profile = profiles[name];
    if (!profile) return { name, env: null };
    // When Koppler started the app, to tell a setting written after that.
    // ponytail: the file's time, so any later edit of it asks for a restart
    let started: number | null = null;
    try {
      const record = JSON.parse(fs.readFileSync(path.join(stateDir(), 'procs', `${id}.json`), 'utf8')) as {
        startedAt: string;
      };
      started = Date.parse(record.startedAt);
    } catch {
      // Not started by Koppler.
    }
    return { name, env: profile.environmentVariables ?? {}, changed: fs.statSync(file).mtimeMs, started };
  } catch {
    return null;
  }
}

/** What the Lambda runner says about itself on /health. */
interface Health {
  koppler?: string;
  ok?: boolean;
  error?: string;
  function?: string;
  trigger?: string;
}
const cannot = (detail: string): Tested => ({ ok: false, unsure: true, text: 'Cannot test', detail });
/** An app's local address, when it is one this Mac answers on. */
function localUrl(app: App | null): URL | Tested {
  let url: URL;
  try {
    url = new URL(app?.url ?? '');
  } catch {
    return cannot(app ? `${app.name} has no local address in the stack yet.` : 'That app is not in the stack.');
  }
  if (!/^https?:$/.test(url.protocol) || !LOOPBACK.test(url.hostname))
    return cannot(`${app?.name ?? ''}'s address is not on this Mac.`);
  return url;
}

/** An app by itself: it answers on its local address; a Lambda also has its function deployed and its queue trigger on. */
async function testApp(app: App | null, probe: Probe): Promise<Tested> {
  const url = localUrl(app);
  if (!app || !(url instanceof URL)) return url as Tested;
  const down: Tested = {
    ok: false,
    text: 'No answer',
    detail: `Nothing answers on ${url.host}. ${app.name} is not running.`,
  };
  if (app.kind !== 'lambda') {
    const answered = await probe.answers(url);
    if (!answered) return down;
    const detail = `${app.name} answers on ${url.host} (HTTP ${String(answered.status)}).`;
    return { ok: true, text: `Answers, ${String(answered.ms)} ms`, detail };
  }
  const answered = await probe.answers(new URL('/health', url));
  if (!answered) return down;
  let health = null as Health | null;
  try {
    health = JSON.parse(answered.body ?? '') as Health | null;
  } catch {
    // Not the runner's own answer.
  }
  if (health?.koppler !== 'lambda')
    return {
      ok: true,
      text: 'Answers',
      detail: `${app.name} answers on ${url.host}. It was started before the deeper check existed; restart it to have its function and queue checked too.`,
    };
  if (health.ok)
    return {
      ok: true,
      text: 'Function ready',
      detail: `${app.name}: the emulator is up, the function is deployed and its queue trigger is on.`,
    };
  const state =
    health.error ??
    `its function is ${health.function ?? 'missing'} and its queue trigger ${health.trigger ?? 'missing'}`;
  return { ok: false, text: 'Function not ready', detail: `${app.name} answers on ${url.host}, but ${state}.` };
}

const portOf = (value: string | undefined) => {
  try {
    return new URL(value ?? '').port;
  } catch {
    return null;
  }
};
/** An app cable: the callee answers, and the caller is set to call it. */
async function testCable(
  from: string,
  to: string,
  callee: App | null,
  caller: App | null,
  env: string,
  probe: Probe,
): Promise<Tested> {
  const url = localUrl(callee);
  if (!callee || !(url instanceof URL)) return url as Tested;
  const answered = await probe.answers(url);
  if (!answered)
    return { ok: false, text: 'No answer', detail: `Nothing answers on ${url.host}. Start ${callee.name} first.` };
  const up = `${callee.name} answers on ${url.host} (HTTP ${String(answered.status)})`;
  const call = caller?.consumes?.[to];
  const settings = call?.how === 'env' && caller?.kind === 'dotnet' ? [call.env ?? []].flat() : [];
  const fine = `Answers, ${String(answered.ms)} ms`;
  // Koppler gives the caller the address when it starts it: what it was started with is what it calls.
  const given = settings.length ? probe.started(from) : null;
  const setting = settings.find(one => given?.[one] !== undefined);
  if (caller && given && setting)
    return portOf(given[setting]) === url.port
      ? { ok: true, text: fine, detail: `${up}, and ${caller.name} was started with ${setting} pointing at it.` }
      : {
          ok: false,
          text: 'Not pointed at it',
          detail: `${up}, but ${caller.name} was started with ${setting} pointing elsewhere. Restart ${caller.name} to call it.`,
        };
  const profile = settings.length ? probe.profile(from, env) : null;
  if (!profile || !caller) {
    const unchecked = caller ? ` Whether ${caller.name} is set to call it could not be checked here.` : '';
    return { ok: true, text: fine, detail: `${up}.${unchecked}` };
  }
  const { name } = profile;
  const pointed = profile.env;
  const wrong = !pointed
    ? `it has no ${name} profile yet`
    : settings
        .map(setting =>
          !pointed[setting]
            ? `${setting} is missing from ${name}`
            : portOf(pointed[setting]) !== url.port
              ? `${setting} in ${name} points elsewhere`
              : null,
        )
        .find(Boolean);
  if (wrong)
    return {
      ok: false,
      text: 'Not pointed at it',
      detail: `${up}, but ${caller.name} is not set to call it: ${wrong}.`,
    };
  if (profile.started && (profile.changed ?? 0) > profile.started)
    return {
      ok: false,
      text: 'Restart needed',
      detail: `${up}, and ${caller.name}'s ${name} profile points at it, but ${caller.name} was started before that profile was last changed. Restart ${caller.name} to pick it up.`,
    };
  return { ok: true, text: fine, detail: `${up}, and ${caller.name}'s ${name} profile points at it.` };
}

/**
 * A tunnel link: the port is open, a real server answers behind it, the name the app dials leads to it, and its
 * credential logs in.
 */
async function testTunnel(
  stack: Registry,
  id: string,
  app: App | null,
  env: string,
  body: Body,
  probe: Probe,
): Promise<Tested> {
  const host = typeof body['host'] === 'string' ? body['host'] : '';
  const port = Number(body['port']);
  if (!app || !LOOPBACK.test(host) || !Number.isInteger(port) || port < 1 || port > 65535)
    return cannot('That tunnel is not on this Mac.');
  const where = `${host}:${String(port)}`;
  if (!(await probe.opens(host, port)))
    return { ok: false, text: 'Port closed', detail: `Nothing listens on ${where}. The tunnel is not running.` };
  const kind = KIND_BY_PORT[Number(body['original']) || port];
  if (!kind)
    return {
      ok: true,
      unsure: true,
      text: 'Port open',
      detail: `The tunnel on ${where} is open. Koppler cannot tell what kind of server is behind it, so only the port was checked.`,
    };
  const server = KIND_NAME[kind];
  // A tunnel sometimes drops one connection while it serves others, so silence is only believed the third time.
  let spoke = false;
  for (let tries = 0; tries < 3 && !spoke; tries++) {
    if (tries) await pause(400);
    spoke = await probe.speaks(kind, host, port);
  }
  if (!spoke)
    return {
      ok: false,
      text: 'Nothing behind it',
      detail: `The tunnel listens on ${where}, but no ${server} server answers through it. It may have lost its connection: restart the tunnel.`,
    };
  for (const { hosts: name } of app.prereqs ?? []) {
    if (typeof name !== 'string' || !/^[a-z0-9.-]{1,253}$/i.test(name) || (await probe.leadsHere(name))) continue;
    return {
      ok: false,
      text: 'Name not redirected',
      detail: `A ${server} server answers on ${where}, but ${name}, the name ${app.name} dials, does not lead to this Mac. Add its hosts entry (koppler doctor).`,
    };
  }
  const reached = `A ${server} server answers through the tunnel on ${where}`;
  const [mine, ...more] = (declaredSecrets(stack)[id]?.[env] ?? []).filter(secret => secret.type === kind);
  if (!mine || more.length)
    return {
      ok: true,
      text: 'Reachable',
      detail: `${reached}. ${app.name} logs in with its own settings, which Koppler does not hold, so the login itself was not tried.`,
    };
  // `auto` is a check the canvas runs by itself: it never reads a production credential, which would open a Keychain prompt.
  if (body['auto'] && isProtected(stack, env))
    return {
      ok: true,
      text: 'Reachable',
      detail: `${reached}. ${mine.name} was not tried: a production credential is only read when you press the test yourself.`,
    };
  const login = await probe.login(id, env, mine.name);
  if (login.ok) return { ok: true, text: 'Logged in', detail: `${reached}, and ${app.name}'s ${mine.name} logs in.` };
  const why = login.message ?? login.error ?? 'the check did not finish';
  if (why.includes('not stored'))
    return {
      ok: false,
      text: 'Not stored',
      detail: `${reached}, but ${mine.name} is not stored yet. Store it under Credentials.`,
    };
  return why.startsWith('cannot test')
    ? {
        ok: true,
        text: 'Reachable',
        detail: `${reached}. ${mine.name} ${why.replace(/^cannot test: /, 'could not be tried: ')}`,
      }
    : {
        ok: false,
        text: 'Login failed',
        detail: `${reached}, but ${mine.name} is rejected: ${why.replace(/^failed: /, '')}`,
      };
}

/** Tests one connection: `{ node }` an app by itself, `{ from, to }` an app cable, `{ app, host, port }` a tunnel link. */
export async function cableTest(
  loaded: Registry | null | undefined,
  given: unknown,
  probe: Probe = {
    answers,
    opens,
    speaks,
    leadsHere,
    profile: (id, env) => (loaded ? localProfile(loaded, id, env) : null),
    started: id => {
      const record = readRecord(id);
      return record && alive(record) ? (record.start?.setEnv ?? null) : null;
    },
    login: (app, env, name) => secretRequest('test', { app, env, name }).then(answer => answer.body),
  },
): Promise<Tested> {
  // With no stack loaded there is no app to find: every test then says so.
  const stack = loaded ?? { envs: [], apps: {} };
  const body = (given ?? {}) as Body;
  const [first = ''] = stack.envs;
  const env = typeof body['env'] === 'string' && stack.envs.includes(body['env']) ? body['env'] : first;
  const appOf = (id: unknown): App | null => {
    return typeof id === 'string' ? (appOn(stack, id, env) ?? null) : null;
  };
  const { node, from, to, app } = body;
  if (typeof node === 'string') return testApp(appOf(node), probe);
  if (typeof to === 'string') return testCable(String(from), to, appOf(to), appOf(from), env, probe);
  return testTunnel(stack, String(app), appOf(app), env, body, probe);
}
