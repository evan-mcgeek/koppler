import { expect, test } from 'vitest';
import { expressionProblems, resolveExpressions } from './expressions.ts';

const stack = {
  envs: ['qa'],
  apps: {
    'orders-api': { url: 'http://localhost:5001', name: 'Orders API' },
    web: {
      url: 'http://localhost:{{web.devPort}}',
      devPort: 3000,
      consumes: {
        'orders-api': { how: 'env', env: 'ORDERS_URL', local: 'http://{{orders-api.host}}:{{orders-api.port}}/v1' },
      },
      prereqs: [{ tunnel: 'db.acme.example', port: '{{db.port}}' }],
    },
    db: { port: 5432, name: 'Database' },
  },
};

test('an expression is filled in with the named fact; one that is the whole value keeps its type', () => {
  const resolved = resolveExpressions(stack);
  expect(resolved.apps.web.url).toBe('http://localhost:3000');
  expect(resolved.apps.web.consumes['orders-api'].local).toBe('http://localhost:5001/v1');
  expect(resolved.apps.web.prereqs[0]?.port).toBe(5432);
  // The stack itself keeps the expressions.
  expect(stack.apps.web.url).toBe('http://localhost:{{web.devPort}}');
  expect(expressionProblems(stack)).toEqual([]);
});

test('an expression that names nothing, or only itself, stays as written and is a problem', () => {
  const broken = {
    apps: { a: { url: 'http://localhost:{{nope.port}}', loop: '{{a.loop}}', start: 'docker ps --format {{.Names}}' } },
  };
  expect(resolveExpressions(broken).apps.a.url).toBe('http://localhost:{{nope.port}}');
  expect(expressionProblems(broken)).toEqual([
    'apps.a.url: {{nope.port}} names no field of an app (or only itself); use {{<app>.<field>}}, such as {{orders-api.port}}',
    'apps.a.loop: {{a.loop}} names no field of an app (or only itself); use {{<app>.<field>}}, such as {{orders-api.port}}',
  ]);
});
