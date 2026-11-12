import { describe, expect, it } from 'vitest';
import { mergeStacks, sameNamedBoards } from './stack-merge.ts';

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

  it('keeps every note of both: ours, then each of theirs ours lacks, as added, not as a conflict', () => {
    const done = mergeStacks(
      { ...ours, notes: ['Orders API: settings from SSM', 'Web: runs on 3000'] },
      { ...theirs, notes: ['Web: runs on 3000', 'Pay: starts with npm run dev'] },
    );
    expect(done.stack['notes']).toEqual([
      'Orders API: settings from SSM',
      'Web: runs on 3000',
      'Pay: starts with npm run dev',
    ]);
    expect(done.added).toContain('notes[2]');
    expect(done.conflicts.map(one => one.path)).not.toContain('notes');
    // One note written as text is a list of one; a lock on the notes keeps ours whole.
    expect(mergeStacks({ ...ours, notes: 'One' }, { ...theirs, notes: ['Two'] }).stack['notes']).toEqual([
      'One',
      'Two',
    ]);
    const locked = mergeStacks({ ...ours, notes: ['One'] }, { ...theirs, notes: ['Two'] }, { locked: ['notes'] });
    expect(locked.stack['notes']).toEqual(['One']);
    expect(locked.conflicts.filter(one => one.path === 'notes')).toEqual([
      { path: 'notes', ours: ['One'], theirs: ['Two'], kept: 'ours', locked: true },
    ]);
  });

  it('keeps every board of ours, even two with one name', () => {
    const twice = { ...ours, presets: [ours.presets[0], { ...ours.presets[0], nodes: {} }] };
    expect((mergeStacks(twice, theirs, { prefer: 'ours' }).stack as typeof ours).presets).toHaveLength(3);
  });

  it('reads a lock written by place in the team boards as the board in that place', () => {
    const merged = mergeStacks(ours, theirs, { prefer: 'theirs', locked: ['presets[0].nodes'] });
    expect(merged.conflicts.find(one => one.path === 'presets["Checkout"]')).toMatchObject({
      kept: 'ours',
      locked: true,
    });
    expect((merged.stack as typeof ours).presets[0]).toEqual(ours.presets[0]);
  });

  it('names the team boards a stack has more than one of', () => {
    expect(sameNamedBoards(ours)).toEqual([]);
    expect(
      sameNamedBoards({ presets: [...theirs.presets, { ...theirs.presets[1] }, { ...theirs.presets[1] }] }),
    ).toEqual(['Payments']);
  });

  it('brings in the areas and the areas its apps are in', () => {
    const a = { ...ours, areas: { checkout: { name: 'Checkout' } } };
    const b = {
      ...theirs,
      areas: { checkout: { name: 'Checkout' }, payments: { name: 'Payments' } },
      apps: { ...theirs.apps, pay: { ...theirs.apps.pay, areas: ['payments'] } },
    };
    const merged = mergeStacks(a, b, { prefer: 'ours' });
    expect(merged.added).toContain('areas.payments');
    expect((merged.stack as typeof b).areas).toEqual(b.areas);
    expect((merged.stack as typeof b).apps.pay.areas).toEqual(['payments']);
  });

  it('finds nothing to do for the same stack', () => {
    expect(mergeStacks(ours, structuredClone(ours))).toEqual({ stack: ours, added: [], conflicts: [] });
  });
});
