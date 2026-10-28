import { expect, test } from 'vitest';
import { check, migrate, VERSION, type StackFacts } from './presets.ts';

const stack: StackFacts = {
  known: id => ['app', 'api', 'db-api', 'far'].includes(id),
  cloned: id => id !== 'far',
  runIn: id => (id === 'app' ? ['ide', 'cli'] : ['cli', 'ide']),
  platforms: id => (id === 'app' ? ['ios', 'android', 'phone'] : []),
  canCall: (from, to) => `${from}>${to}` !== 'db-api>api',
  branches: id => (id === 'api' ? ['main', 'develop'] : null),
  checkedOut: () => null,
};

test('what cannot be a preset is refused with a reason', () => {
  const cases: [unknown, RegExp][] = [
    [null, /not a preset/],
    [[], /not a preset/],
    [{ nodes: { api: {} } }, /no name/],
    [{ name: 'x' }, /no apps/],
    [{ name: 'x', nodes: {} }, /no apps/],
    [{ name: 'x', version: 99, nodes: { api: {} } }, /newer Koppler/],
  ];
  for (const [bad, why] of cases) expect(migrate(bad).error).toMatch(why);
});

test('an older preset is brought to the current format; a current one is left alone', () => {
  expect(migrate({ name: 'Old', nodes: { api: {}, app: { run: 'ide' } } })).toEqual({
    preset: {
      name: 'Old',
      nodes: { api: { run: 'cli' }, app: { run: 'ide' } },
      edges: [],
      version: VERSION,
      koppler: '0.1.0',
    },
    migratedFrom: '0.0.0',
  });
  const current = { name: 'Now', version: VERSION, koppler: '0.1.0', nodes: { api: { run: 'cli' } }, edges: [] };
  expect(migrate(current)).toEqual({ preset: current, migratedFrom: null });
  // No Koppler version yet: read as the oldest, run through every migration, and stamped.
  const numbered = { name: 'Then', version: VERSION, nodes: { api: { run: 'ide' } }, edges: [] };
  expect(migrate(numbered)).toEqual({ preset: { ...numbered, koppler: '0.1.0' }, migratedFrom: '0.0.0' });
  expect(migrate({ ...current, koppler: '9.0.0' }).error).toMatch(/newer Koppler/);
});

test('only what this stack can run opens, and every change is noted', () => {
  const result = check(
    {
      name: '  PR 12  ',
      source: 'pr.json',
      nodes: {
        app: { run: 'cli', platform: 'windows' },
        api: { run: 'docker', branch: 'feat/x', note: 'flag on', tunnels: false },
        'db-api': { run: 'cli', platform: 'ios' },
        far: { run: 'cli' },
        gone: { run: 'cli' },
      },
      edges: [
        { from: 'app', to: 'api' },
        { from: 'app', to: 'api' },
        { from: 'db-api', to: 'api' },
        { from: 'api', to: 'far' },
        { from: 'api', to: 'gone' },
        null,
      ],
    },
    stack,
  );
  expect(result.preset).toEqual({
    name: 'PR 12',
    version: VERSION,
    koppler: '0.1.0',
    source: 'pr.json',
    nodes: {
      app: { run: 'cli', platform: 'ios' },
      api: { run: 'cli', branch: 'feat/x', note: 'flag on', tunnels: false },
      'db-api': { run: 'cli' },
    },
    edges: [{ from: 'app', to: 'api' }],
  });
  expect(result.notes).toEqual([
    'it had no version, read as the oldest format',
    'not in this stack: gone',
    'not cloned: far',
    'app has no "windows" platform, using ios',
    'api cannot run in "docker", using cli',
    'api has no branch feat/x in your clone (fetch it first)',
    'db-api does not call api, cable left out',
    '1 cable left out with their apps',
  ]);
});

test('a clean preset opens with nothing to say', () => {
  const clean = {
    name: 'Ok',
    version: 1,
    nodes: { app: { run: 'ide' }, api: { run: 'cli', branch: 'main' } },
    edges: [{ from: 'app', to: 'api' }],
  };
  expect(check(clean, stack)).toEqual({ preset: { ...clean, koppler: '0.1.0' }, notes: [] });
});

test('a clone with uncommitted work on another branch keeps its branch, and the note says why', () => {
  const board = { name: 'Orders', version: 1, nodes: { api: { run: 'cli', branch: 'develop' } }, edges: [] };
  const dirty = check(board, { ...stack, checkedOut: () => ({ branch: 'master', dirty: 3 }) });
  expect(dirty.preset?.nodes).toEqual({ api: { run: 'cli', branch: 'develop', followsClone: true } });
  expect(dirty.notes).toEqual([
    'api stays on master: 3 uncommitted files. The board asks for develop; pick it on the card to switch',
  ]);
  const clean = check(board, { ...stack, checkedOut: () => ({ branch: 'master', dirty: 0 }) });
  expect(clean.preset?.nodes).toEqual({ api: { run: 'cli', branch: 'develop' } });
  expect(clean.notes).toEqual([]);
  const there = check(board, { ...stack, checkedOut: () => ({ branch: 'develop', dirty: 3 }) });
  expect(there.preset?.nodes).toEqual({ api: { run: 'cli', branch: 'develop' } });
  expect(there.notes).toEqual([]);
});

test('nothing left to open is an error, not an empty board', () => {
  expect(check({ name: 'x', nodes: { gone: {} } }, stack).error).toMatch(/None of its apps are in this stack/);
  expect(check({ name: 'x', nodes: { far: {} } }, stack).error).toMatch(/None of its apps are cloned here/);
});

test('a preset written by hand is read safely', () => {
  // An app without settings, and cables that are not a list.
  const loose = { name: 'Odd', version: 1, nodes: { app: null, api: {} }, edges: { from: 'app', to: 'api' } };
  expect(check(loose, stack).preset?.edges).toEqual([]);
  // A cable naming something every object has.
  const edges = [null, { from: 'constructor', to: 'api' }, { from: 'app', to: 'api' }];
  expect(check({ name: 'Odd', version: 1, nodes: { app: {}, api: {} }, edges }, stack).preset?.edges).toEqual([
    { from: 'app', to: 'api' },
  ]);
});
