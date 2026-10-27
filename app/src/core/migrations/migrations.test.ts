import { expect, test } from 'vitest';
import { withDatabases } from '../databases.ts';
import { BOARD_FILE_FORMAT } from './board-file/index.ts';
import { BOARD_FORMAT } from './board/index.ts';
import { compareVersions, inOrder, migrate, type Format } from './run.ts';
import { migrateStack, STACK_FORMAT } from './stack/index.ts';

const steps: Format = {
  name: 'The file',
  key: 'koppler',
  version: '0.3.0',
  migrations: [
    { version: '0.1.0', about: 'a', up: (raw, say) => (say('a'), { ...raw, a: true }) },
    { version: '0.3.0', about: 'b', up: raw => ({ ...raw, b: raw['a'] === true }) },
  ],
};

test('versions order by number, not as text', () => {
  expect(compareVersions('0.10.0', '0.9.9')).toBeGreaterThan(0);
  expect(compareVersions('1.0.0', '1.0.0')).toBe(0);
  expect(compareVersions('0.2.0', '0.10.0')).toBeLessThan(0);
});

test('a file runs every migration newer than its version, oldest first, and is stamped with the format', () => {
  const raw = { x: 1 };
  const done = migrate(raw, steps);
  expect(done.value).toEqual({ x: 1, a: true, b: true, koppler: '0.3.0' });
  expect(done.from).toBe('0.0.0');
  expect(done.applied?.map(one => [one.migration.version, one.changes])).toEqual([
    ['0.1.0', ['a']],
    ['0.3.0', []],
  ]);
  // The raw file itself is never changed.
  expect(raw).toEqual({ x: 1 });
  expect(migrate({ x: 1, koppler: '0.1.0' }, steps).applied?.map(one => one.migration.version)).toEqual(['0.3.0']);
  expect(migrate({ koppler: '0.3.0' }, steps).applied).toEqual([]);
});

test('a file from a newer Koppler is refused, and one with no version runs every migration', () => {
  expect(migrate({ koppler: '0.4.0' }, steps).error).toMatch(/written for Koppler 0.4.0.*update Koppler/);
  expect(migrate({ version: 1 }, steps).applied?.map(one => one.migration.version)).toEqual(['0.1.0', '0.3.0']);
});

test("every format's migrations are in order and none is newer than the format", () => {
  for (const format of [STACK_FORMAT, BOARD_FORMAT, BOARD_FILE_FORMAT]) expect(inOrder(format), format.name).toBe(true);
  expect(inOrder({ ...steps, migrations: [...steps.migrations].reverse() })).toBe(false);
  expect(inOrder({ ...steps, version: '0.2.0' })).toBe(false);
});

interface OldNeed {
  tunnel?: string;
  port?: number;
  hosts?: string;
  sso?: string;
  what?: string;
  env?: string;
}
interface OldApp {
  name: string;
  prereqs: OldNeed[];
  envs?: Record<string, { prereqs: OldNeed[] }>;
  uses?: Record<string, unknown>;
}
interface OldStack {
  envs: string[];
  apps: Record<string, OldApp>;
  databases?: Record<string, unknown>;
}
const old: OldStack = {
  envs: ['qa', 'prod'],
  apps: {
    orders: {
      name: 'Orders API',
      prereqs: [
        { sso: 'acme-dev' },
        { tunnel: 'aurora.qa.acme.example', port: 5432, what: 'Orders (Postgres)' },
        { hosts: 'orders.cluster-ro.qa.acme.example' },
      ],
      envs: {
        prod: {
          prereqs: [
            { sso: 'acme-prod' },
            { tunnel: 'aurora.prod.acme.example', port: 5432 },
            { hosts: 'orders.cluster-ro.prod.acme.example' },
          ],
        },
      },
    },
    payments: {
      name: 'Payments API',
      prereqs: [{ tunnel: 'aurora.qa.acme.example', port: 5432 }],
      envs: { prod: { prereqs: [{ tunnel: 'aurora.prod.acme.example', port: 5432 }] } },
    },
    web: { name: 'Web Shop', prereqs: [{ tunnel: 'api.qa.acme.example', port: 8443, env: 'API_URL' }] },
  },
};
const migrated = (stack: OldStack) => migrateStack(stack as never);
/** Each app's tunnels and hosts entries per environment, folded back: what it needs. */
const reached = (stack: OldStack) => {
  const folded = withDatabases(stack as never) as unknown as OldStack;
  return Object.entries(folded.apps).flatMap(([id, app]) =>
    folded.envs.map(env => [
      `${id}@${env}`,
      ((env === folded.envs[0] ? undefined : app.envs?.[env]?.prereqs) ?? app.prereqs)
        .map(one => one.tunnel ?? one.hosts ?? one.sso ?? '')
        .sort(),
    ]),
  );
};

test('0.2.0: tunnels to databases on the apps become databases named once, and every app needs what it did', () => {
  const done = migrated(old);
  const stack = done.value as unknown as OldStack;
  expect(stack.databases).toEqual({
    orders: {
      name: 'Orders',
      kind: 'postgres',
      tunnel: 'aurora.qa.acme.example',
      port: 5432,
      envs: { prod: { tunnel: 'aurora.prod.acme.example', port: 5432 } },
    },
  });
  // Only Orders API dials the cluster's name, so it stays Orders API's own.
  expect(stack.apps['orders']).toMatchObject({
    uses: { orders: {} },
    prereqs: [{ sso: 'acme-dev' }, { hosts: 'orders.cluster-ro.qa.acme.example' }],
  });
  expect(stack.apps['payments']).toMatchObject({ uses: { orders: {} }, prereqs: [] });
  // A tunnel an app's setting points at is not a database's: it stays.
  expect(stack.apps['web']).toEqual(old.apps['web']);
  expect(done.applied?.[0]?.changes).toContain(
    'Payments API uses orders instead of its own tunnel to aurora.qa.acme.example',
  );
  expect(reached(stack)).toEqual(reached(old));
});

test('0.2.0: a name every app of a database dials goes with the database', () => {
  const both = structuredClone(old);
  both.apps['payments']?.prereqs.push({ hosts: 'orders.cluster-ro.qa.acme.example' });
  both.apps['payments']?.envs?.['prod']?.prereqs.push({ hosts: 'orders.cluster-ro.prod.acme.example' });
  const stack = migrated(both).value as unknown as OldStack;
  expect(stack.databases?.['orders']).toMatchObject({
    hosts: 'orders.cluster-ro.qa.acme.example',
    envs: { prod: { hosts: 'orders.cluster-ro.prod.acme.example' } },
  });
  expect(stack.apps['payments']?.prereqs).toEqual([]);
  expect(reached(stack)).toEqual(reached(both));
});

test('a database endpoint with its own facts stays on the app during migration', () => {
  const endpoint = { hosts: 'orders.cluster.qa.acme.example', note: 'Use the read replica only.' };
  const raw = {
    envs: ['qa'],
    apps: {
      orders: {
        name: 'Orders API',
        prereqs: [{ tunnel: 'orders-db.qa.acme.example', port: 5432, what: 'Orders (Postgres)' }, endpoint],
      },
    },
  };
  const done = migrateStack(raw);
  expect(done.value).toMatchObject({
    apps: { orders: { prereqs: [endpoint], uses: { orders: {} } } },
    databases: { orders: { tunnel: 'orders-db.qa.acme.example', port: 5432 } },
  });
  expect(migrateStack(done.value as never).value).toEqual(done.value);
});

test("0.2.1: a stack 0.2.0 left alone gets its databases, each tunnel's command kept and each app's note on its use", () => {
  const stamped = structuredClone(old) as OldStack & { koppler: string };
  stamped.koppler = '0.2.0';
  for (const app of Object.values(stamped.apps))
    for (const list of [app.prereqs, ...Object.values(app.envs ?? {}).map(one => one.prereqs)])
      for (const need of list)
        if (need.tunnel?.startsWith('aurora'))
          Object.assign(need, { cmd: `open ${need.tunnel}`, note: `${app.name} reads it` });
  const done = migrateStack(stamped as never);
  expect(done.applied?.map(one => one.migration.version)).toEqual(['0.2.1', '0.2.2', '0.3.2']);
  const stack = done.value as unknown as OldStack & { databases: Record<string, Record<string, unknown>> };
  expect(stack.databases['orders']).toMatchObject({
    cmd: 'open aurora.qa.acme.example',
    envs: { prod: { cmd: 'open aurora.prod.acme.example' } },
  });
  expect(stack.apps['payments']?.uses).toEqual({ orders: { note: 'Payments API reads it' } });
  expect(stack).toMatchObject({ koppler: '0.3.2' });
});

test('a database its tunnel only calls "Database" is named after its host, without the environment', () => {
  const plain: OldStack = {
    envs: ['qa'],
    apps: {
      wallet: {
        name: 'Wallet API',
        prereqs: [{ tunnel: 'aurora-shop-dev.internal.acme.example', port: 5432, what: 'Database (Aurora)' }],
      },
    },
  };
  const stack = migrateStack(plain as never).value as unknown as OldStack;
  expect(stack.databases).toEqual({
    'aurora-shop': {
      name: 'Aurora shop',
      kind: 'postgres',
      tunnel: 'aurora-shop-dev.internal.acme.example',
      port: 5432,
    },
  });
});

test('0.2.0 leaves a stack alone when it cannot keep every need, and one already in its format', () => {
  // Payments API has no PROD list, so it borrowed QA's tunnel there: as a database it would reach PROD's instead.
  const odd = structuredClone(old);
  const payments = odd.apps['payments'];
  if (payments) delete payments.envs;
  const done = migrated(odd);
  expect(done.applied?.[0]?.changes).toEqual([]);
  expect((done.value as { databases?: unknown }).databases).toBeUndefined();
  expect(migrateStack(migrated(old).value as never).applied).toEqual([]);
});

test('0.2.2: a stack that still names a removed app on its team boards and in other apps no longer does', () => {
  const left = {
    koppler: '0.2.1',
    envs: ['qa'],
    apps: {
      web: {
        name: 'Web',
        kind: 'node',
        slug: 'acme/web',
        after: ['orders-api', 'cart'],
        consumes: { 'orders-api': {}, cart: {} },
      },
      cart: { name: 'Cart', kind: 'node', slug: 'acme/cart', after: ['orders-api'] },
    },
    presets: [
      {
        name: 'Checkout',
        version: 1,
        nodes: { web: { run: 'cli' }, 'orders-api': { run: 'cli' }, cart: {} },
        edges: [
          { from: 'web', to: 'orders-api' },
          { from: 'web', to: 'cart' },
        ],
      },
      { name: 'Cart', version: 1, nodes: { cart: {} }, edges: [] },
    ],
  };
  const done = migrateStack(left);
  expect(done.applied?.map(one => [one.migration.version, one.changes])).toEqual([
    ['0.2.2', ['mentions of removed apps taken out']],
    ['0.3.2', []],
  ]);
  expect(done.value).toMatchObject({
    koppler: '0.3.2',
    apps: { web: { after: ['cart'], consumes: { cart: {} } } },
    presets: [{ nodes: { web: { run: 'cli' }, cart: {} }, edges: [{ from: 'web', to: 'cart' }] }, left.presets[1]],
  });
  expect((done.value as typeof left).apps.cart).toEqual({ name: 'Cart', kind: 'node', slug: 'acme/cart' });
  expect(migrateStack(done.value as never).value).toEqual(done.value);
  const whole = {
    ...left,
    apps: { ...left.apps, 'orders-api': { name: 'Orders', kind: 'node', slug: 'acme/orders-api' } },
  };
  expect(migrateStack(whole).applied?.[0]?.changes).toEqual([]);
});

test('0.3.2: a call whose how is written in words becomes how unknown, with the words kept as its note', () => {
  const words = 'Remote config base URL (lib/config/model.dart)';
  const old = {
    koppler: '0.2.2',
    envs: ['qa'],
    apps: {
      app: {
        name: 'Mobile App',
        kind: 'flutter',
        slug: 'acme/app',
        consumes: {
          api: { how: words, file: 'lib/config/model.dart' },
          web: { how: 'env', env: 'WEB_URL' },
          cart: { how: 'set in the admin panel', note: 'Ask the cart team.' },
        },
        envs: { prod: { consumes: { api: { how: 'baked in at build' } } } },
      },
    },
  };
  const done = migrateStack(old);
  expect(done.applied?.map(one => [one.migration.version, one.changes])).toEqual([
    [
      '0.3.2',
      [
        `app -> api: how "${words}" kept as its note`,
        'app -> cart: how "set in the admin panel" kept as its note',
        'app on prod -> api: how "baked in at build" kept as its note',
      ],
    ],
  ]);
  expect(done.value).toMatchObject({
    koppler: '0.3.2',
    apps: {
      app: {
        consumes: {
          api: { how: 'unknown', note: words, file: 'lib/config/model.dart' },
          web: { how: 'env', env: 'WEB_URL' },
          cart: { how: 'unknown', note: 'Ask the cart team. set in the admin panel' },
        },
        envs: { prod: { consumes: { api: { how: 'unknown', note: 'baked in at build' } } } },
      },
    },
  });
  // A stack already in this format is left as it is.
  expect(migrateStack(done.value as never).value).toEqual(done.value);
  expect(migrateStack(done.value as never).applied ?? []).toEqual([]);
});
