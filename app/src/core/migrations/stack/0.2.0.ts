// 0.2.0: databases are named once under `databases` and apps `uses` them, where before each app stated a tunnel to
// each database (and the hosts entry its settings dial) among its own needs.
import { withDatabases } from '../../databases.ts';
import { tunnelKind } from '../../ports.ts';
import type { Migration, Raw } from '../run.ts';

interface Need {
  tunnel?: string;
  port?: number;
  hosts?: string;
  what?: string;
  cmd?: string;
  env?: string;
  connectsAs?: string;
  [key: string]: unknown;
}
interface App {
  name?: string;
  prereqs?: Need[];
  uses?: Record<string, Raw>;
  envs?: Record<string, { prereqs?: Need[] } & Raw>;
}
interface Stack {
  envs: string[];
  apps: Record<string, App>;
  databases?: Record<string, Raw & { envs?: Record<string, Raw> }>;
}

const PORTS: Record<number, string> = { 5432: 'postgres', 3306: 'mysql', 6379: 'valkey', 6380: 'valkey' };
const ENGINE = /postgres|mysql|aurora|rds|cluster|valkey|redis|elasticache|database|\bdb\b|cache/i;
/** A tunnel to a database or cache: by its port, or by what it says it reaches. One a setting points at stays. */
const isDatabase = (need: Need) =>
  !!need.tunnel &&
  !!need.port &&
  !need.env &&
  !need.connectsAs &&
  (!!PORTS[need.port] || ENGINE.test(`${need.tunnel} ${need.what ?? ''}`));
const kindOf = (need: Need) =>
  /redis/i.test(need.tunnel ?? '')
    ? 'redis'
    : (PORTS[need.port ?? 0] ?? (/mysql/i.test(need.what ?? '') ? 'mysql' : 'postgres'));
/** A hosts entry for a database endpoint, not for an app. */
const isEndpoint = (need: Need) => !!need.hosts && !need.tunnel && ENGINE.test(need.hosts);
const slug = (text: string) =>
  text
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-|-$/g, '') || 'database';

/** What each app needs on each environment, to compare before and after. */
function needsOf(stack: Stack): Record<string, string[]> {
  const folded = withDatabases(stack as unknown as Parameters<typeof withDatabases>[0]) as unknown as Stack;
  const key = (need: Need) => JSON.stringify([need.tunnel, need.port, need.hosts, need.sso, need.signIn, need.cmd]);
  return Object.fromEntries(
    Object.entries(folded.apps).flatMap(([id, app]) =>
      folded.envs.map(env => [
        `${id}@${env}`,
        ((env === folded.envs[0] ? undefined : app.envs?.[env]?.prereqs) ?? app.prereqs ?? []).map(key).sort(),
      ]),
    ),
  );
}

function up(raw: Raw, say: (change: string) => void): Raw {
  const before = raw as unknown as Stack;
  if (!Array.isArray(before.envs) || typeof before.apps !== 'object') return raw;
  const stack = structuredClone(before);
  const [first = ''] = stack.envs;
  const databases = (stack.databases ??= {});
  const byHost = new Map<string, string>();
  const changes: string[] = [];
  /** Per database and environment, the hosts entry each app using it dials, if it has exactly one. */
  const dials = new Map<string, { list: Need[]; endpoint: Need | undefined }[]>();
  for (const [id, app] of Object.entries(stack.apps)) {
    const own = (app.prereqs ?? []).filter(isDatabase);
    for (const need of own) {
      const host = need.tunnel ?? '';
      let key = byHost.get(host);
      if (!key) {
        // "Orders (Postgres)" is the database Orders; its kind is said apart.
        const said = need.what && !/^(database|cache)\b/i.test(need.what) ? need.what : tunnelKind({ tunnel: host });
        const name = said.replace(/\s*\([^)]*\)$/, '') || said;
        key = slug(name);
        while (databases[key]) key = `${key}-2`;
        byHost.set(host, key);
        databases[key] = {
          name,
          kind: kindOf(need),
          tunnel: host,
          port: need.port,
          ...(need.cmd && { cmd: need.cmd }),
        };
        changes.push(`New database ${key}: ${name}, through the tunnel to ${host}`);
      }
      (app.uses ??= {})[key] ??= {};
      changes.push(`${app.name ?? id} uses ${key} instead of its own tunnel to ${host}`);
    }
    // On each environment, the tunnel of the same port, in the same order, reaches the same database there.
    for (const env of own.length ? stack.envs : []) {
      const list = env === first ? app.prereqs : app.envs?.[env]?.prereqs;
      if (!list) continue;
      const tunnels = list.filter(isDatabase);
      const endpoints = list.filter(isEndpoint);
      for (const need of own) {
        const same = own.filter(one => one.port === need.port);
        const there = env === first ? need : tunnels.filter(one => one.port === need.port)[same.indexOf(need)];
        const key = byHost.get(need.tunnel ?? '') ?? '';
        const database = databases[key];
        if (!there || !database) continue;
        const reach =
          env === first ? database : ((database.envs ??= {})[env] ??= { tunnel: there.tunnel, port: there.port });
        if (reach['tunnel'] !== there.tunnel || reach['port'] !== there.port) continue;
        list.splice(list.indexOf(there), 1);
        const users = dials.get(`${key}@${env}`) ?? [];
        users.push({ list, endpoint: own.length === 1 && endpoints.length === 1 ? endpoints[0] : undefined });
        dials.set(`${key}@${env}`, users);
      }
    }
  }
  // The name a database's apps dial goes with it when every one of them dials it.
  for (const [at, users] of dials) {
    const [key = '', env = ''] = at.split('@');
    const name = users[0]?.endpoint?.hosts;
    if (!name || users.some(one => one.endpoint?.hosts !== name)) continue;
    const database = databases[key];
    const reach = env === first ? database : database?.envs?.[env];
    if (!reach) continue;
    reach['hosts'] = name;
    for (const { list, endpoint } of users) if (endpoint) list.splice(list.indexOf(endpoint), 1);
  }
  // Only when every app still needs exactly what it did, on every environment.
  const [was, now] = [needsOf(before), needsOf(stack)];
  if (!changes.length || Object.keys(was).some(key => JSON.stringify(was[key]) !== JSON.stringify(now[key])))
    return raw;
  for (const change of new Set(changes)) say(change);
  return stack as unknown as Raw;
}

export const databasesNamedOnce: Migration = {
  version: '0.2.0',
  about: 'Names each database once under databases, used by its apps, instead of a tunnel on each app',
  up,
};
