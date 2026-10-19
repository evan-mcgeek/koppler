// The databases an app uses become its own needs: the tunnel to each and the hosts entry its connection settings dial,
// per environment, so everything that reads an app's needs keeps working unchanged.
import type { Database, Prereq } from './stack.ts';

interface Stackish {
  envs: readonly string[];
  apps: Record<string, AppLike | undefined>;
  databases?: Record<string, Database | undefined> | undefined;
}
interface AppLike {
  prereqs?: Prereq[] | undefined;
  uses?: Record<string, unknown> | undefined;
  envs?: Record<string, { prereqs?: Prereq[] | undefined } | undefined> | undefined;
}

/** The kinds of database Koppler knows, by their words. */
export const DATABASE_KINDS: Record<string, string> = {
  postgres: 'Postgres',
  mysql: 'MySQL',
  valkey: 'Valkey',
  redis: 'Redis',
};

/** The needs a database brings on one environment, or none when it is not reached there. */
export function databaseNeeds(database: Database, env: string, first: string): Prereq[] {
  // Another environment's tunnel or name is never borrowed: each environment states its own.
  const reach = env === first ? database : database.envs?.[env];
  if (!reach) return [];
  const kind = database.kind ? (DATABASE_KINDS[database.kind] ?? database.kind) : '';
  const what = `${database.name ?? 'Database'}${kind ? ` (${kind})` : ''}`;
  return [
    ...(reach.tunnel && reach.port
      ? [{ tunnel: reach.tunnel, port: reach.port, what, ...(reach.cmd && { cmd: reach.cmd }) }]
      : []),
    ...(reach.hosts ? [{ hosts: reach.hosts, note: `${what}: the name its connection settings dial.` }] : []),
  ];
}

/** Adds a list's needs that it does not have yet, by tunnel host or hosts name. */
const add = (own: Prereq[], more: Prereq[]): Prereq[] => [
  ...own,
  ...more.filter(
    need =>
      !own.some(have => (need.tunnel && have.tunnel === need.tunnel) || (need.hosts && have.hosts === need.hosts)),
  ),
];

/** The databases an app uses, by id, that the stack names. */
export const databasesOf = (stack: Pick<Stackish, 'apps' | 'databases'>, id: string): string[] =>
  Object.keys(stack.apps[id]?.uses ?? {}).filter(key => !!stack.databases?.[key]);

/**
 * The stack with each app's databases folded into its needs, on every environment. One switched to this Mac (`local`)
 * brings none: it has no tunnel. Never written back.
 */
export function withDatabases<S extends Stackish>(stack: S, local: ReadonlySet<string> = new Set()): S {
  const databases = Object.fromEntries(Object.entries(stack.databases ?? {}).filter(([id]) => !local.has(id)));
  const first = stack.envs[0] ?? '';
  const apps = Object.fromEntries(
    Object.entries(stack.apps).map(([id, app]) => {
      const used = Object.keys(app?.uses ?? {}).flatMap(key => (databases[key] ? [databases[key]] : []));
      if (!app || !used.length) return [id, app];
      const needs = (env: string) => used.flatMap(database => databaseNeeds(database, env, first));
      const envs = Object.fromEntries(
        stack.envs.slice(1).flatMap(env => {
          const own = app.envs?.[env];
          const more = needs(env);
          if (!own?.prereqs && !more.length) return own ? [[env, own]] : [];
          return [[env, { ...own, prereqs: add(own?.prereqs ?? [], more) }]];
        }),
      );
      return [id, { ...app, prereqs: add(app.prereqs ?? [], needs(first)), envs: { ...app.envs, ...envs } }];
    }),
  );
  return { ...stack, apps };
}

/** Where a database on this Mac runs, as the user gave it. */
export interface LocalAddress {
  host: string;
  port: number;
  /** The database's name on that server; none for a cache. */
  database?: string;
}

const CACHES = ['valkey', 'redis'];

/**
 * The value an app's connection setting takes for a database on this Mac, in the form its kind expects: a .NET app's
 * key=value connection string, else a URL; a cache is its host and port. The local server's user is the Mac's own,
 * as Homebrew and Postgres.app set them up, with no password.
 */
export function localValue(
  kind: string | undefined,
  appKind: string | undefined,
  at: LocalAddress,
  user: string,
): string {
  const where = `${at.host}:${String(at.port)}`;
  if (CACHES.includes(kind ?? '')) return where;
  const name = at.database ?? '';
  if (appKind === 'dotnet')
    return kind === 'mysql'
      ? `Server=${at.host};Port=${String(at.port)};Database=${name};User=${user}`
      : `Host=${at.host};Port=${String(at.port)};Database=${name};Username=${user}`;
  return `${kind === 'mysql' ? 'mysql' : 'postgres'}://${encodeURIComponent(user)}@${where}/${encodeURIComponent(name)}`;
}
