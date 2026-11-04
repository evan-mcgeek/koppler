import { describe, expect, it } from 'vitest';
import { mergeStacks } from './stack-merge.ts';

const ours = {
  name: 'Shop',
  koppler: '0.3.2',
  envs: ['qa', 'prod'],
  apps: {
    web: { name: 'Web', kind: 'node', url: 'http://localhost:3000' },
    orders: { name: 'Orders', kind: 'dotnet', url: 'http://localhost:5000', consumes: { web: {} } },
  },
  queues: { events: { name: 'events', type: 'sqs' } },
  presets: [{ name: 'Checkout', version: 1, nodes: { web: {} }, edges: [] }],
};
const theirs = {
  name: 'Shop QA',
  koppler: '0.3.2',
  envs: ['qa', 'prod'],
  apps: {
    orders: { name: 'Orders', kind: 'dotnet', url: 'http://localhost:5001', port: 5001, consumes: { pay: {} } },
    pay: { name: 'Pay', kind: 'node' },
  },
  databases: { 'orders-db': { name: 'orders', kind: 'postgres' } },
  resources: { files: { type: 's3', name: 'acme-files' } },
  signIns: { aws: { check: 'aws sts get-caller-identity', login: 'aws sso login' } },
  presets: [
    { name: 'Checkout', version: 1, nodes: { web: {}, orders: {} }, edges: [] },
    { name: 'Payments', version: 1, nodes: { pay: {} }, edges: [] },
  ],
};

describe('mergeStacks', () => {
  it('adds what only the other stack has, field by field, and keeps its own name', () => {
    const merged = mergeStacks(ours, theirs, { prefer: 'ours' });
    expect(merged.added).toEqual([
      'apps.orders.consumes.pay',
      'apps.orders.port',
      'apps.pay',
      'presets["Payments"]',
      'databases',
      'resources',
      'signIns',
    ]);
    const stack = merged.stack as typeof ours & typeof theirs;
    expect(stack.name).toBe('Shop');
    expect(Object.keys(stack.apps)).toEqual(['web', 'orders', 'pay']);
    expect(stack.apps.orders.consumes).toEqual({ web: {}, pay: {} });
    expect(stack.queues).toEqual(ours.queues);
    expect(stack.databases).toEqual(theirs.databases);
    expect(stack.presets.map(one => one.name)).toEqual(['Checkout', 'Payments']);
  });

  it('lists each conflict with both values, and keeps ours until it is settled', () => {
    const merged = mergeStacks(ours, theirs);
    expect(merged.conflicts).toEqual([
      { path: 'apps.orders.url', ours: 'http://localhost:5000', theirs: 'http://localhost:5001' },
      { path: 'presets["Checkout"]', ours: ours.presets[0], theirs: theirs.presets[0] },
    ]);
    expect((merged.stack as typeof ours).apps.orders.url).toBe('http://localhost:5000');
  });

  it('settles a conflict by its path first, then by the side preferred for the rest', () => {
    const merged = mergeStacks(ours, theirs, { keep: { 'apps.orders.url': 'theirs' }, prefer: 'ours' });
    expect(merged.conflicts.map(one => [one.path, one.kept])).toEqual([
      ['apps.orders.url', 'theirs'],
      ['presets["Checkout"]', 'ours'],
    ]);
    const stack = merged.stack as typeof ours;
    expect(stack.apps.orders.url).toBe('http://localhost:5001');
    expect(stack.presets[0]).toEqual(ours.presets[0]);
  });

  it('never changes a locked field: its conflict and what it would add are kept as ours', () => {
    const merged = mergeStacks(ours, theirs, { prefer: 'theirs', locked: ['apps.orders.url', 'apps.pay'] });
    expect(merged.conflicts.filter(one => one.locked)).toEqual([
      {
        path: 'apps.orders.url',
        ours: 'http://localhost:5000',
        theirs: 'http://localhost:5001',
        kept: 'ours',
        locked: true,
      },
      { path: 'apps.pay', ours: undefined, theirs: theirs.apps.pay, kept: 'ours', locked: true },
    ]);
    expect(merged.added).not.toContain('apps.pay');
    const stack = merged.stack as typeof ours & typeof theirs;
    expect(stack.apps.orders.url).toBe('http://localhost:5000');
    expect(stack.apps.pay).toBeUndefined();
    // A lock above a field keeps that field too.
    const above = mergeStacks(ours, theirs, { prefer: 'theirs', locked: ['apps.orders'] });
    expect((above.stack as typeof ours).apps.orders).toEqual(ours.apps.orders);
  });

  it('takes a list whole, and writes a key that is no plain word in brackets', () => {
    const a = { envs: ['qa'], apps: {}, envAliases: { 'qa.eu': ['qa-eu'] } };
    const b = { envs: ['qa', 'prod'], apps: {}, envAliases: { 'qa.eu': ['qaeu'] } };
    expect(mergeStacks(a, b).conflicts.map(one => one.path)).toEqual(['envs', 'envAliases["qa.eu"]']);
  });

  it('finds nothing to do for the same stack', () => {
    expect(mergeStacks(ours, structuredClone(ours))).toEqual({ stack: ours, added: [], conflicts: [] });
  });
});
