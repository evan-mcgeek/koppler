import { expect, test } from 'vitest';
import { localValue, withDatabases } from './databases.ts';
import { validateStack, type Stack } from './stack.ts';

const stack: Stack = {
  envs: ['qa', 'prod'],
  databases: {
    'orders-db': {
      name: 'Orders',
      kind: 'postgres',
      tunnel: 'db.qa.acme.example',
      port: 5432,
      hosts: 'orders.cluster.qa.acme.example',
      envs: { prod: { tunnel: 'db.prod.acme.example', port: 5432 } },
    },
    cache: { name: 'Cache', kind: 'valkey', tunnel: 'cache.qa.acme.example', port: 6379 },
  },
  apps: {
    orders: {
      name: 'Orders API',
      kind: 'dotnet',
      uses: { 'orders-db': {}, cache: {} },
      prereqs: [{ sso: 'acme-dev' }],
    },
    payments: {
      name: 'Payments API',
      kind: 'dotnet',
      uses: { 'orders-db': {} },
      prereqs: [{ tunnel: 'db.qa.acme.example', port: 5432 }],
    },
    web: { name: 'Web Shop', kind: 'node' },
  },
};

test("an app's databases become its needs: the tunnel and the name its settings dial", () => {
  const apps = withDatabases(stack).apps;
  expect(apps['orders']?.prereqs).toEqual([
    { sso: 'acme-dev' },
    { tunnel: 'db.qa.acme.example', port: 5432, what: 'Orders (Postgres)' },
    { hosts: 'orders.cluster.qa.acme.example', note: 'Orders (Postgres): the name its connection settings dial.' },
    { tunnel: 'cache.qa.acme.example', port: 6379, what: 'Cache (Valkey)' },
  ]);
  // A tunnel it already states is not added twice.
  expect(apps['payments']?.prereqs?.filter(need => need.tunnel)).toHaveLength(1);
  expect(apps['web']).toBe(stack.apps['web']);
});

test("another environment uses only what the database states for it, never the first environment's", () => {
  const prod = withDatabases(stack).apps['orders']?.envs?.['prod']?.prereqs;
  expect(prod).toEqual([{ tunnel: 'db.prod.acme.example', port: 5432, what: 'Orders (Postgres)' }]);
});

test('a use of a database the stack does not name is a problem; one it names is not', () => {
  const bad = { ...stack, apps: { ...stack.apps, web: { name: 'Web Shop', kind: 'node', uses: { nope: {} } } } };
  expect(validateStack(bad)).toContain('apps.web.uses.nope: no such database under "databases"');
  expect(validateStack(stack).filter(problem => problem.includes('uses') || problem.startsWith('databases'))).toEqual(
    [],
  );
});

test('a database switched to this Mac brings no tunnel or hosts entry', () => {
  const prereqs = withDatabases(stack, new Set(['orders-db'])).apps['orders']?.prereqs;
  expect(prereqs?.map(need => need.tunnel ?? need.hosts ?? need.sso)).toEqual(['acme-dev', 'cache.qa.acme.example']);
});

test("a local database's address is written the way the app's kind reads it", () => {
  const at = { host: 'localhost', port: 5433, database: 'orders_dev' };
  expect(localValue('postgres', 'dotnet', at, 'ivan')).toBe(
    'Host=localhost;Port=5433;Database=orders_dev;Username=ivan',
  );
  expect(localValue('mysql', 'dotnet', at, 'ivan')).toBe('Server=localhost;Port=5433;Database=orders_dev;User=ivan');
  expect(localValue('postgres', 'node', at, 'ivan')).toBe('postgres://ivan@localhost:5433/orders_dev');
  expect(localValue('valkey', 'dotnet', { host: 'localhost', port: 6379 }, 'ivan')).toBe('localhost:6379');
});
