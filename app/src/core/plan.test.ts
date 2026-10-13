import { expect, test } from 'vitest';
import {
  board,
  describe,
  isProtected,
  plan,
  protectedEnvs,
  queuesOf,
  same,
  type BoardInput,
  type Plan,
} from './plan.ts';

const ids = (p: Plan) => ({
  starts: p.starts.map(s => s.id),
  restarts: p.restarts.map(s => s.id),
  stops: p.stops.map(s => s.id),
  keeps: p.keeps.map(s => s.id),
});
const running = () => true;
const want: BoardInput = {
  env: 'qa',
  nodes: [
    { id: 'app', run: 'ide', branch: null },
    { id: 'api', run: 'cli', branch: null },
    { id: 'db-api', run: 'cli', branch: 'main' },
  ],
  edges: [
    { from: 'app', to: 'api' },
    { from: 'api', to: 'db-api' },
  ],
};
const live = board(want);
const withNode = (id: string, change: object): BoardInput => ({
  ...want,
  nodes: (want.nodes as { id: string }[]).map(n => (n.id === id ? { ...n, ...change } : n)),
});

test('with nothing applied yet, everything starts', () => {
  const first = plan(null, want);
  expect(ids(first)).toEqual({ starts: ['app', 'api', 'db-api'], restarts: [], stops: [], keeps: [] });
  expect(first.nothing).toBe(false);
});

test('the same board again changes nothing', () => {
  expect(live.nodes['api']).toEqual({ branch: '', run: 'cli' });
  const again = plan(live, want, { running });
  expect(ids(again)).toEqual({ starts: [], restarts: [], stops: [], keeps: ['app', 'api', 'db-api'] });
  expect(again.nothing).toBe(true);
  expect(describe(again)).toEqual(['KEEP RUNNING: app, api, db-api']);
});

test('only the difference is done, each part with its reason', () => {
  const next: BoardInput = {
    env: 'qa',
    nodes: {
      app: { run: 'ide' },
      api: { run: 'cli' },
      wallet: { run: 'cli' },
      'db-api': { run: 'cli', branch: 'main' },
    },
    edges: [
      { from: 'app', to: 'api' },
      { from: 'api', to: 'wallet' },
    ],
  };
  const change = plan(live, next, { name: id => id.toUpperCase(), running });
  expect(ids(change)).toEqual({ starts: ['wallet'], restarts: ['api'], stops: [], keeps: ['app', 'db-api'] });
  expect(change.restarts[0]?.why).toEqual([
    'it starts calling your local WALLET',
    'it goes back to the deployed DB-API',
  ]);

  const fewer: BoardInput = {
    env: 'qa',
    nodes: { app: { run: 'ide' }, api: { run: 'cli' } },
    edges: [{ from: 'app', to: 'api' }],
  };
  const less = plan(live, fewer, { running });
  expect(ids(less)).toEqual({ starts: [], restarts: ['api'], stops: ['db-api'], keeps: ['app'] });

  expect(same(change, structuredClone(change))).toBe(true);
  expect(same(change, less)).toBe(false);
});

test('a completely different board stops everything and starts the new apps', () => {
  const other = plan(live, { env: 'qa', nodes: { wallet: { run: 'cli' } }, edges: [] });
  expect(ids(other)).toEqual({ starts: ['wallet'], restarts: [], stops: ['app', 'api', 'db-api'], keeps: [] });
  expect(describe(plan(live, { env: 'qa', nodes: {}, edges: [] }))).toEqual(['STOP AND REVERT: app, api, db-api']);
});

test('another environment, branch or note restarts what stays', () => {
  const prod = plan(live, { ...want, env: 'prod' }, { running });
  expect(ids(prod).restarts).toEqual(['app', 'api', 'db-api']);
  expect(prod.envChange).toEqual({ from: 'qa', to: 'prod' });
  expect(prod.restarts[0]?.why[0]).toMatch(/from QA to PROD/);
  expect(plan(live, withNode('db-api', { branch: 'feat/x' }), { running }).restarts).toEqual([
    { id: 'db-api', why: ['its branch changes from main to feat/x'] },
  ]);
  expect(plan(live, withNode('api', { note: 'flag on' }), { running }).restarts).toEqual([
    { id: 'api', why: ['its note changed'] },
  ]);
});

test('reality corrects the record', () => {
  // Something that died starts again; an app the user starts in the IDE is theirs to start.
  expect(plan(live, want, { running: id => id !== 'api' }).starts).toEqual([
    { id: 'api', why: ['it was started before but is not running now'] },
  ]);
  expect(plan(live, want, { running: id => id !== 'app' }).starts).toEqual([]);
  // Something running that no recorded run explains is restarted when it is on the board, stopped when it is not.
  const stray = plan(null, { env: 'qa', nodes: { api: { run: 'cli' } }, edges: [] }, { strays: ['api', 'wallet'] });
  expect(ids(stray)).toEqual({ starts: [], restarts: ['api'], stops: ['wallet'], keeps: [] });
});

test('an app started with koppler run is kept when it already is what the board asks for', () => {
  const options = { strays: ['api'], startedOn: () => 'prod' };
  const one = (env: string, node: object): BoardInput => ({ env, nodes: { api: { run: 'cli', ...node } }, edges: [] });
  expect(plan(null, one('prod', {}), options).keeps.map(k => k.id)).toEqual(['api']);
  expect(plan(null, one('qa', {}), options).restarts.map(k => k.id)).toEqual(['api']);
  expect(plan(null, one('prod', { branch: 'feat/x' }), options).restarts.map(k => k.id)).toEqual(['api']);
});

test('a queue moving to local restarts only the apps on it', () => {
  const stack = { apps: { api: { publishes: { thumbs: {} } }, worker: { reads: { thumbs: {} } }, web: {} } };
  const withQueues = (queues: Record<string, string>): BoardInput => ({
    env: 'qa',
    nodes: { api: { run: 'cli', queues: true }, worker: { run: 'cli', queues: true }, web: { run: 'cli' } },
    edges: [],
    queues,
  });
  const moved = plan(withQueues({}), withQueues({ thumbs: 'local', ghost: 'deployed' }), {
    queuesOf: id => queuesOf(stack, id),
  });
  expect(ids(moved)).toEqual({ starts: [], restarts: ['api', 'worker'], stops: [], keeps: ['web'] });
  expect(moved.restarts[0]?.why).toEqual(['it moves to the local thumbs queue']);
});

test('switching an app to a local library, or back, restarts it and says which', () => {
  const withLibraries = (libraries: string[] | null): BoardInput => ({
    env: 'qa',
    nodes: { app: { run: 'cli', ...(libraries && { libraries }) } },
    edges: [],
  });
  expect(plan(withLibraries(null), withLibraries(['acme_design'])).restarts[0]?.why).toEqual([
    'it uses your local acme_design',
  ]);
  expect(plan(withLibraries(['acme_design']), withLibraries(null)).restarts[0]?.why).toEqual([
    'it goes back to the published acme_design',
  ]);
  expect(plan(withLibraries(['a', 'b']), withLibraries(['b', 'a'])).keeps.map(k => k.id)).toEqual(['app']);
});

test('a board keeps only what it understands', () => {
  const read = board({
    env: 'qa',
    nodes: { api: { note: { not: 'text' }, tunnels: false, queues: true, libraries: ['b', 'a'] }, web: { queues: false } },
    edges: [{ from: 'api', to: 'web' }, { from: 'api', to: 'constructor' }, null],
    queues: { thumbs: 'local', other: 'deployed' },
  });
  expect(read.nodes).toEqual({
    api: { branch: '', run: 'cli', tunnels: false, queues: true, libraries: ['a', 'b'] },
    web: { branch: '', run: 'cli' },
  });
  expect(read.edges).toEqual([{ from: 'api', to: 'web' }]);
  expect(read.queues).toEqual({ thumbs: 'local' });
});

test('protected environments come from the stack, or are every one but the first: never from a name', () => {
  expect(protectedEnvs({ envs: ['qa', 'staging', 'live-eu'] })).toEqual(['staging', 'live-eu']);
  expect(protectedEnvs({ envs: ['prod'] })).toEqual([]);
  expect(protectedEnvs({ envs: ['prod', 'qa'], protected: ['prod'] })).toEqual(['prod']);
  expect(protectedEnvs({ envs: ['qa', 'prod'], protected: [] })).toEqual([]);
  expect(isProtected({ envs: ['qa', 'prd'] }, 'prd')).toBe(true);
});

test('an app not switched onto its queues does not restart when its queue goes local for the others', () => {
  const on = (queues: Record<string, string>, nodes: NonNullable<BoardInput['nodes']>): BoardInput => ({
    env: 'qa',
    nodes,
    edges: [],
    queues,
  });
  const both = { pub: { run: 'cli' as const, queues: true }, sub: { run: 'cli' as const } };
  const options = { running: () => true, queuesOf: () => ['orders'] };
  const moved = plan(on({}, both), on({ orders: 'local' }, both), options);
  expect(moved.restarts.map(step => step.id)).toEqual(['pub']);
  expect(moved.keeps.map(step => step.id)).toEqual(['sub']);
  // Taking the choice back while the queue is local moves it over.
  const back = plan(
    on({ orders: 'local' }, both),
    on({ orders: 'local' }, { ...both, sub: { run: 'cli' as const, queues: true } }),
    options,
  );
  expect(back.restarts.find(step => step.id === 'sub')?.why).toEqual(['it moves to the local orders queue']);
});

test('an app asked to restart restarts, and the rest keeps running', () => {
  const nodes = { api: { run: 'cli' as const }, web: { run: 'cli' as const } };
  const edges = [{ from: 'web', to: 'api' }];
  const asked = { env: 'qa', nodes: { ...nodes, api: { ...nodes.api, restart: true } }, edges };
  const steps = plan({ env: 'qa', nodes, edges }, asked, { running: () => true });
  expect(steps.restarts).toEqual([{ id: 'api', why: ['you asked to restart it'] }]);
  expect(steps.keeps.map(step => step.id)).toEqual(['web']);
});
