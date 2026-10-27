// The stack file: its shape, the types the rest of the code reads it by, and the check a stack has to pass before it
// is used. One definition gives all three.
import * as z from 'zod';
import { loadsCode } from '../safe-env.ts';
import { expressionProblems, resolveExpressions } from './expressions.ts';
import { BUILT_IN_KINDS } from './kinds.ts';
import { QUEUE_TYPES } from './plan.ts';
import { VERSION as PRESET_VERSION } from './presets.ts';
import { BOARD_FORMAT } from './migrations/board/index.ts';
import { compareVersions, isVersion } from './migrations/run.ts';
import { SECRET_TYPES } from './secret-types.ts';

// Values that end up in commands (tunnels, sign-ins, hosts entries, secret steps, clone commands) must look like what
// they are, so a shared stack file cannot smuggle shell syntax into them.
const HOST =
  /^(?=.{1,253}$)[A-Za-z0-9](?:[A-Za-z0-9-]{0,61}[A-Za-z0-9])?(?:\.[A-Za-z0-9](?:[A-Za-z0-9-]{0,61}[A-Za-z0-9])?)*$/;
const NAME = /^[\w.-]{1,128}$/;
const SETTING = /^[A-Za-z_][\w.:-]{0,127}$/;
const SLUG = /^[\w.-]+(?:\/[\w.-]+)+$/;
const ID = /^[a-z0-9-]+$/;

const matching = (pattern: RegExp, what: string) => z.string({ error: what }).regex(pattern, what);
const required = z.string({ error: 'required' }).min(1, 'required');
const host = matching(HOST, 'a host name');
const setting = matching(SETTING, 'a setting name');
const queueName = matching(NAME, 'a queue or topic name');
const START = 'a shell command (up to 2000 characters)';
const start = z.string({ error: START }).min(1, START).max(2000, START);
const PORT = 'a port number from 1 to 65535';

/** Something an app needs before it can run: a tunnel, a sign-in, a hosts entry. */
const Prereq = z.looseObject(
  {
    tunnel: host.optional().describe('The host the tunnel reaches, such as a database'),
    // A number: it reaches the page, shell commands and the port probe.
    port: z
      .number({ error: PORT })
      .int(PORT)
      .min(1, PORT)
      .max(65535, PORT)
      .optional()
      .describe('The local port it opens'),
    /** The app's setting that holds the tunnel's address. */
    env: setting.optional().describe("The app's setting that holds the tunnel's address"),
    what: z.string().optional().describe('What it is, in words: Database (Postgres)'),
    /** The name the app dials, when that is not the tunnel's host. */
    connectsAs: host.optional().describe('The name the app dials, when that is not the host'),
    hosts: host.optional().describe('A name to point at this Mac in /etc/hosts'),
    sso: matching(NAME, 'an AWS profile name').optional().describe('The AWS profile to be signed in with'),
    /** The AWS account that profile must be signed in to. */
    account: matching(/^\d{12}$/, 'a 12-digit AWS account id')
      .optional()
      .describe('The AWS account that profile must be in'),
    /** A sign-in of the stack's own, by its name under `signIns`. */
    signIn: matching(NAME, 'the name of a sign-in').optional().describe('A sign-in of the stack, by its name'),
    devCerts: z.boolean().optional().describe('It serves https here: the local certificate must be trusted'),
    nuget: z.boolean().optional().describe('It downloads packages from a private feed while it builds'),
    cmd: z.string().optional().describe('How the team opens it by hand; Koppler checks that its program is installed'),
    note: z.string().optional().describe('Anything else worth knowing, in words'),
  },
  { error: 'an object: a tunnel, a sign-in or another need' },
);
const Secret = z.looseObject(
  {
    /** The setting the stored value is given to the app as. */
    env: setting.optional().describe('The setting the stored value is given to the app as'),
    type: z.string().optional().describe('postgres, mysql or redis, so it can be tested'),
    file: z.string().optional().describe("A file in the app's repo that holds the secret, instead of a setting"),
    when: z.string().optional().describe('When it is needed, if not always'),
    fetch: z
      .looseObject({
        cli: z.string().optional().describe('The command that stores it, run in your own terminal'),
        ui: z.string().optional().describe('Where to find it by hand'),
      })
      .optional()
      .describe('How to get it'),
    note: z.string().optional().describe('Anything else worth knowing, in words'),
  },
  { error: 'an object' },
);
/** The ways of calling Koppler applies, to point a caller at a local copy. */
export const CALL_HOWS = ['env', 'env-file', 'edit', 'secret', 'unknown'] as const;
/** How one app calls another, and so what to change to point it at a local copy. */
const Call = z.looseObject(
  {
    how: z
      .enum(CALL_HOWS, { error: `one of ${CALL_HOWS.join(', ')}; anything else in words goes in note` })
      .optional()
      .describe('How it picks the address: a setting, a settings file, an edit, a secret, or not known yet'),
    env: z
      .union([z.string(), z.array(z.string())], { error: 'a setting name, or a list of them' })
      .optional()
      .describe('The setting that holds the address'),
    file: z.string().optional().describe('The file that holds the address, inside its repo'),
    key: z.string().optional().describe('The name or line in that file'),
    /** An address to use instead of the worked-out one: one for all, or one per platform (ios, android). */
    value: z
      .union([z.string(), z.record(z.string(), z.string())])
      .optional()
      .describe('An address to use instead of the worked-out one'),
    /** The route the caller's setting holds after the callee's address, kept when the call goes local. */
    path: z
      .string()
      .regex(/^\/[^\s?#]*$/, { error: 'a path that starts with / (no query)' })
      .optional()
      .describe('The route kept after the address, such as /api'),
    deployed: z.string().optional().describe('The deployed address it calls today'),
    found: z.string().optional().describe('Where the call was seen in its code'),
    note: z.string().optional().describe('Anything else worth knowing, in words'),
    ifDown: z
      .enum(['skip', 'start'], { error: 'skip or start' })
      .optional()
      .describe('When the local app it calls does not start: skip this one too (the default), or start it anyway'),
  },
  { error: 'an object (how the call is made; {} when not known yet)' },
);
const LOCAL_CHANGE = "needs file (a path inside the app's clone, no .. or leading /), find and replace";
const insideClone = (file: string) =>
  !file.startsWith('/') && !/^[A-Za-z]:[\\/]/.test(file) && !file.split(/[\\/]/).includes('..');
/** A code change the stack remembers for local runs: one file inside the app's own clone. */
const LocalChange = z
  .looseObject({ file: z.string().min(1), find: z.string().min(1), replace: z.string() }, { error: LOCAL_CHANGE })
  .refine(change => insideClone(change.file), LOCAL_CHANGE);

/** Where a database or cache is reached on one environment: the tunnel to it, and the name the apps' own settings dial. */
const DatabaseReach = {
  tunnel: host.optional().describe('The host the tunnel reaches'),
  port: z
    .number({ error: PORT })
    .int(PORT)
    .min(1, PORT)
    .max(65535, PORT)
    .optional()
    .describe('The local port it opens'),
  cmd: z.string().optional().describe('How the team opens the tunnel by hand'),
  hosts: host.optional().describe("The name the apps' own connection settings dial, pointed at the tunnel"),
};
/** A database or cache the stack's apps use, named once and reached the same way by each. */
const Database = z.looseObject(
  {
    name: z.string().optional().describe('Its name on the board, from the code'),
    kind: z.string().optional().describe('postgres, mysql, valkey and so on'),
    ...DatabaseReach,
    envs: z
      .record(z.string(), z.looseObject(DatabaseReach, { error: 'an object' }), {
        error: 'an object keyed by environment',
      })
      .optional()
      .describe('Where it is reached on another environment'),
    note: z.string().optional().describe('Anything else worth knowing, in words'),
  },
  { error: 'an object' },
);
/** How an app finds a database it uses. */
const Use = z.looseObject(
  {
    setting: setting.optional().describe('The setting its connection comes from, set to a local database when Local'),
    change: LocalChange.optional().describe(
      'A code change for a run on a local database, when the app reads no setting for it; {local} is its address',
    ),
    note: z.string().optional().describe('Anything else worth knowing, in words'),
  },
  { error: 'an object ({} when nothing is known yet)' },
);

/** What differs for an app on an environment other than the stack's first. */
const EnvOverlay = z.looseObject(
  {
    prereqs: z.array(Prereq, { error: 'a list' }).optional(),
    secrets: z.array(Secret, { error: 'a list' }).optional(),
    start: start.optional(),
  },
  { error: 'an object' },
);
/** The icons a command's button can have on its card. */
export const COMMAND_ICONS = [
  'play',
  'database',
  'sprout',
  'refresh',
  'trash',
  'terminal',
  'upload',
  'download',
] as const;
const AppCommand = z.looseObject(
  {
    label: required.describe('Its button: Seed, Migrate'),
    run: z.string({ error: 'a shell command' }).min(1).describe('The shell command, run in its repo with its secrets'),
    icon: z.enum(COMMAND_ICONS, { error: `one of ${COMMAND_ICONS.join(', ')}` }).optional(),
    confirm: z.string().optional().describe('A question to answer yes to first, for a command that changes data'),
    args: z
      .array(
        z.looseObject({
          name: z.string().regex(/^[A-Za-z][A-Za-z0-9_]{0,31}$/, { error: 'a name such as COUNT' }),
          label: z.string().optional(),
          type: z.enum(['text', 'number', 'choice'], { error: 'text, number or choice' }).optional(),
          choices: z.array(z.string()).optional(),
          required: z.boolean().optional(),
        }),
        { error: 'a list' },
      )
      .optional()
      .describe('What it asks for; each value reaches the command as a setting of its name'),
    show: z
      .enum(['canvas', 'cli', 'both'], { error: 'canvas, cli or both' })
      .optional()
      .describe('Where it is offered: a button on the card, koppler do, or both (the default)'),
    timeout: z.number().positive().optional().describe('Seconds it may take, 1800 by default'),
  },
  { error: 'an object with a label and a command to run' },
);
const MockResponse = z.looseObject(
  {
    method: z
      .enum(['GET', 'POST', 'PUT', 'PATCH', 'DELETE'], { error: 'GET, POST, PUT, PATCH or DELETE' })
      .optional()
      .describe('Its method; any method when left out'),
    path: z
      .string({ error: 'a path such as /orders' })
      .regex(/^\//, 'a path such as /orders')
      .describe('The path it answers; one ending in * answers every path under it'),
    status: z.int().min(100).max(599).optional().describe('Its status, 200 by default'),
    body: z.unknown().optional().describe('What it answers: JSON, or text'),
    headers: z.record(z.string(), z.string(), { error: 'an object' }).optional().describe('Headers it adds'),
  },
  { error: 'an object with a path' },
);
const App = z.looseObject(
  {
    name: required.describe('Its name on the canvas'),
    kind: required.describe('What it is built with: dotnet, node, web, flutter, lambda, other'),
    /** Its repo: owner/repo, or host/path/to/repo. An outside system has none. */
    slug: matching(SLUG, 'owner/repo, or host/path/to/repo').optional().describe('Its repo: owner/repo'),
    /** Set for a system that is never run locally (a SaaS), to what it is. */
    outside: z
      .union([z.string(), z.boolean()])
      .optional()
      .describe('Set for a system that never runs here, to what it is'),
    pending: z
      .union([z.string(), z.boolean()])
      .optional()
      .describe('Set while its facts are not filled in yet; a run refuses it until this is taken out'),
    /** Where it answers when it runs on this machine. */
    url: z.string().optional().describe('Where it answers when it runs on this Mac'),
    deployedUrl: z.string().optional().describe('Where the deployed one answers'),
    /** The shell command that starts it, run in its clone. */
    start: start.optional().describe('The shell command that starts it, run in its repo'),
    /** When it is ready: a GET of this path on its `url` answers, with this status when one is given. */
    ready: z
      .looseObject(
        {
          path: z.string().regex(/^\/\S*$/, { error: 'a path that starts with /' }),
          status: z.int().min(100).max(599).optional(),
          timeout: z.number().positive().optional(),
        },
        { error: 'an object with a path' },
      )
      .optional()
      .describe('When it is ready: this path answers on its url, with this status'),
    /** It runs to completion, such as a migration or seed data, instead of staying up. */
    once: z
      .looseObject(
        {
          exitCode: z.int().min(0).max(255).optional(),
          timeout: z.number().positive().optional(),
        },
        { error: 'an object' },
      )
      .optional()
      .describe(
        'It runs to completion, like a migration: the exit code it must end with (0) and the seconds it may take',
      ),
    browserConsole: z
      .looseObject({ file: z.string().min(1) }, { error: 'an object with the HTML file' })
      .refine(value => insideClone(value.file), "needs file: its HTML entry file, inside the app's clone")
      .optional()
      .describe('Web: its browser console on its card; file is its HTML entry file, such as index.html'),
    watch: z
      .looseObject({ ignore: z.array(z.string(), { error: 'a list of paths' }).optional() }, { error: 'an object' })
      .optional()
      .describe('Restart on change: paths in its repo whose changes do not restart it'),
    commands: z
      .record(z.string().regex(/^[a-z0-9][a-z0-9-]{0,31}$/, { error: 'an id such as seed' }), AppCommand, {
        error: 'an object',
      })
      .optional()
      .describe('Buttons such as Seed or Migrate on its card, also run with koppler do'),
    mock: z
      .array(MockResponse, { error: 'a list' })
      .optional()
      .describe('Canned responses answered on its local address in its place, when its card is set to Mock'),
    after: z
      .array(z.string(), { error: 'a list of app ids' })
      .optional()
      .describe('Apps in the same run that must finish (a once app) or start before this one does'),
    prereqs: z
      .array(Prereq, { error: 'a list' })
      .optional()
      .describe('What it needs first: tunnels, sign-ins, hosts entries'),
    secrets: z
      .array(Secret, { error: 'a list' })
      .optional()
      .describe('The secrets it needs, by name; values stay in your keychain'),
    consumes: z
      .record(z.string(), Call, { error: 'an object' })
      .optional()
      .describe('The apps it calls, and how it finds each'),
    uses: z
      .record(z.string(), Use, { error: 'an object keyed by database id' })
      .optional()
      .describe('The databases and caches it uses, by id under databases'),
    publishes: z.record(z.string(), z.unknown(), { error: 'an object' }).optional().describe('The queues it sends to'),
    reads: z.record(z.string(), z.unknown(), { error: 'an object' }).optional().describe('The queues it reads from'),
    envs: z
      .record(z.string(), EnvOverlay, { error: 'an object' })
      .optional()
      .describe('What differs on another environment; a list given here replaces the one above'),
    localChanges: z
      .array(LocalChange, { error: LOCAL_CHANGE })
      .optional()
      .describe('Code changes made for a local run and undone on Stop'),
    /** .NET: the project to run, its launch settings file, and the profile to start from. */
    project: z.string().optional().describe('.NET: the project to run'),
    launchSettings: z.string().optional().describe('.NET: its launch settings file'),
    baseProfile: z.string().optional().describe('.NET: the launch profile to start from'),
    /** Node and web: the package.json script, when it is not `dev` or `start`. */
    script: z.string().optional().describe('Node and web: the package.json script, when not dev or start'),
    flutter: z
      .looseObject({
        fvm: z.boolean().optional(),
        flavor: z.boolean().optional(),
        defineFile: z.string().optional(),
      })
      .optional()
      .describe('Flutter: fvm, flavor, the --dart-define file'),
    mobile: z
      .looseObject({
        iosBundleId: z.string().optional(),
        androidPackage: z.string().optional(),
      })
      .optional()
      .describe('The app ids on iOS and Android'),
    lambda: z
      .looseObject({
        handler: z.string().optional(),
        runtime: z.string().optional(),
        project: z.string().optional().describe('The folder to build, when not the repo itself'),
        timeout: z.number().positive().optional().describe('Seconds a call may take'),
        routes: z.array(z.string()).optional().describe('The paths it answers on'),
        env: z
          .array(z.string())
          .optional()
          .describe('The settings it reads, given what Koppler sets for them: a cable, a stored secret'),
        environment: z.record(z.string(), z.string()).optional().describe('Settings it always gets, by name'),
        parameters: z
          .array(z.looseObject({ name: z.string(), from: z.string() }))
          .optional()
          .describe('Parameter Store values it reads: the name, and the stored value that holds it'),
        secret: z
          .looseObject({ id: z.string().optional(), from: z.string().optional() })
          .optional()
          .describe('The secret it reads when it starts, and the stored value that holds it'),
      })
      .optional()
      .describe('Lambda: handler and runtime'),
    sam: z
      .looseObject({
        template: z.string().optional(),
        envs: z.record(z.string(), z.union([z.string(), z.array(z.string())])).optional(),
      })
      .optional()
      .describe('SAM: template, and the stack per environment'),
    /** The setting (or settings) that lists the browser origins this API allows. */
    cors: z
      .looseObject({ env: z.union([z.string(), z.array(z.string())]).optional() })
      .optional()
      .describe('The setting that lists the browser origins it allows'),
  },
  { error: 'an object' },
);

const Kind = z.looseObject(
  {
    label: required,
    start: z.string({ error: 'a shell command' }).optional(),
    detect: z.union([z.string(), z.array(z.string())], { error: 'file names' }).optional(),
  },
  { error: 'an object with a label' },
);
const Queue = z.looseObject(
  {
    name: required,
    type: z.enum(QUEUE_TYPES, { error: `one of ${QUEUE_TYPES.join(', ')}` }),
    queue: queueName.optional(),
    envs: z.record(z.string(), z.looseObject({ queue: queueName.optional() })).optional(),
    note: z.string().optional(),
    feeds: z
      .record(
        z.string(),
        z.looseObject({ via: z.enum(['pipe', 'rule', 'subscription'], { error: 'pipe, rule or subscription' }) }),
        { error: 'an object keyed by queue id' },
      )
      .optional()
      .describe('The queues, topics and buses it feeds, and how: a pipe, a rule or a subscription'),
  },
  { error: 'an object' },
);
const CHECK = 'needs a name (up to 80 characters) and a run command (up to 2000)';
// What gets approved is what runs: a check list or command too long to show in full is refused, never cut short.
const isCheck = (value: unknown): value is { name: string; run: string } => {
  if (typeof value !== 'object' || value === null) return false;
  const { name, run } = value as { name?: unknown; run?: unknown };
  const sized = (text: unknown, most: number) => typeof text === 'string' && text.length > 0 && text.length <= most;
  return sized(name, 80) && sized(run, 2000);
};
const Check = z.custom<{ name: string; run: string }>(isCheck, CHECK);
const CHECKS = 'a list of at most 50 checks';
const COMMAND = 'a command, as text of at most 2000 characters';
const command = z.string({ error: COMMAND }).min(1, COMMAND).max(2000, COMMAND);
/** A sign-in the stack declares: how to tell it holds, how to sign in, and the settings it gives the app. */
const SignIn = z.looseObject(
  {
    what: z.string().optional(),
    check: command,
    login: command,
    env: z.record(setting, z.string({ error: 'text' }), { error: 'an object of settings' }).optional(),
  },
  { error: 'an object with check and login' },
);
const PRESET_VERSION_NEEDED = `required (the current preset format is ${String(PRESET_VERSION)})`;
const Preset = z.looseObject(
  {
    name: required,
    version: z.number({ error: PRESET_VERSION_NEEDED }).int(PRESET_VERSION_NEEDED),
    koppler: z
      .string()
      .regex(/^\d+\.\d+\.\d+$/, 'a Koppler version, such as 0.1.0')
      .optional()
      .describe('The Koppler board format it is written in'),
    nodes: z
      .record(z.string(), z.looseObject({}, { error: 'an object ({} for the defaults)' }), {
        error: 'an object keyed by app id',
      })
      .optional(),
    edges: z.array(z.unknown(), { error: 'a list of { from, to }' }).optional(),
  },
  { error: 'an object' },
);

const ENVS = 'a non-empty list of lowercase names, each once';
const isEnvList = (value: unknown): value is string[] =>
  Array.isArray(value) &&
  value.length > 0 &&
  value.every(env => typeof env === 'string' && ID.test(env)) &&
  new Set(value).size === value.length;
const PROTECTED =
  'a list of environments from envs (the ones that ask before every secret read and get the careful review)';

export const StackSchema = z.looseObject(
  {
    name: z.string().optional(),
    /** The Koppler version whose format the stack is written in; Koppler sets it when it brings the file up to date. */
    koppler: z
      .string()
      .regex(/^\d+\.\d+\.\d+$/, 'a Koppler version, such as 0.2.0')
      .optional()
      .describe('The Koppler version whose format it is written in; Koppler sets it as it reads the file'),
    /** The environments, the first being the one apps run against by default. */
    envs: z.custom<string[]>(isEnvList, ENVS),
    /** The environments where a mistake costs something; without this, every one but the first. */
    protected: z.array(z.string(), { error: PROTECTED }).optional(),
    /** Other names an environment goes by in the repos. */
    envAliases: z
      .record(z.string(), z.array(z.string(), { error: 'must be one of envs, with a list of names' }), {
        error: 'an object keyed by environment',
      })
      .optional(),
    apps: z.record(z.string(), App, { error: 'an object keyed by app id' }),
    kinds: z.record(z.string(), Kind, { error: 'an object keyed by kind id' }).optional(),
    queues: z.record(z.string(), Queue, { error: 'an object keyed by queue id' }).optional(),
    databases: z.record(z.string(), Database, { error: 'an object keyed by database id' }).optional(),
    checks: z.array(Check, { error: CHECKS }).max(50, CHECKS).optional(),
    signIns: z.record(z.string(), SignIn, { error: 'an object keyed by sign-in name' }).optional(),
    presets: z.array(Preset, { error: 'a list' }).optional(),
    /** How to install a program the stack's apps need, by its name. */
    install: z
      .record(z.string(), z.string(), { error: 'an object of program names and how to install each' })
      .optional(),
  },
  { error: 'a stack is an object with envs and apps' },
);

export type Stack = z.infer<typeof StackSchema>;
export type App = z.infer<typeof App>;
export type Prereq = z.infer<typeof Prereq>;
export type Database = z.infer<typeof Database>;
export type Secret = z.infer<typeof Secret>;
export type Call = z.infer<typeof Call>;

type Loose = Record<string, unknown>;
const isObject = (value: unknown): value is Loose =>
  typeof value === 'object' && value !== null && !Array.isArray(value);
/** Whether the stack has this app, queue or kind as its own: `constructor` is not one. */
const has = (table: unknown, key: string) => isObject(table) && Object.hasOwn(table, key);
const entries = (table: unknown): [string, unknown][] => (isObject(table) ? Object.entries(table) : []);
const list = (value: unknown): unknown[] => (Array.isArray(value) ? value : []);

/** What one app's parts refer to: apps it calls, queues it uses, environments, and settings it must not be given. */
function appProblems(id: string, app: Loose, stack: Loose, envs: string[]): string[] {
  const at = `apps.${id}`;
  const problems: string[] = [];
  const kind = app['kind'];
  if (typeof kind === 'string' && kind && !BUILT_IN_KINDS.includes(kind) && !has(stack['kinds'], kind))
    problems.push(
      `${at}.kind: "${kind}" is not a kind Koppler knows; define it under "kinds", or use "other" with a "start" command`,
    );
  // An outside system may have no repo of its own.
  if (!app['outside'] && app['slug'] === undefined) problems.push(`${at}.slug: required`);
  for (const [dep] of entries(app['consumes']))
    if (!has(stack['apps'], dep)) problems.push(`${at}.consumes.${dep}: no such app`);
  for (const [n, dep] of list(app['after']).entries())
    if (typeof dep !== 'string' || !has(stack['apps'], dep)) problems.push(`${at}.after[${String(n)}]: no such app`);
  for (const key of ['publishes', 'reads'])
    for (const [queue, use] of entries(app[key])) {
      if (!has(stack['queues'], queue)) problems.push(`${at}.${key}.${queue}: no such queue under "queues"`);
      const via = isObject(use) ? use['via'] : undefined;
      if (via !== undefined && (typeof via !== 'string' || !via || via.length > 80))
        problems.push(`${at}.${key}.${queue}.via: how it is read, as text of at most 80 characters`);
    }
  for (const [env] of entries(app['envs']))
    if (!envs.includes(env)) problems.push(`${at}.envs.${env}: not one of envs (${envs.join(', ')})`);

  const overlays = entries(app['envs']).map(
    ([env, overlay]) => [`envs.${env}.secrets`, isObject(overlay) ? overlay['secrets'] : undefined] as const,
  );
  const secretLists = [['secrets', app['secrets']] as const, ...overlays];
  const secrets = secretLists.flatMap(([where, secrets]) =>
    list(secrets)
      .filter(isObject)
      .map(secret => ({ where, secret })),
  );
  // A secret or a cable's setting named like a variable that makes a runtime load code would run the stack author's
  // code in the app.
  const cableSettings = entries(app['consumes']).flatMap(([, call]) => (isObject(call) ? [call['env']].flat() : []));
  for (const name of [...secrets.map(({ secret }) => secret['env']), ...cableSettings])
    if (typeof name === 'string' && (loadsCode(name) || name === 'PATH'))
      problems.push(`${at}: "${name}" cannot be a secret or a cable setting; it changes what code the app runs`);
  for (const { where, secret } of secrets) {
    const type = secret['type'];
    if (type !== undefined && !(SECRET_TYPES as readonly unknown[]).includes(type))
      problems.push(
        `${at}.${where}: type "${typeof type === 'string' ? type : JSON.stringify(type)}" is not one Koppler tests (${SECRET_TYPES.join(', ')})`,
      );
  }
  return problems;
}

function presetProblems(index: number, preset: Loose, stack: Loose): string[] {
  const at = `presets[${String(index)}]`;
  const problems: string[] = [];
  const version = preset['version'];
  if (typeof version === 'number' && version > PRESET_VERSION)
    problems.push(
      `${at}.version: ${String(version)} is newer than this Koppler reads (${String(PRESET_VERSION)}); update Koppler`,
    );
  const format = preset['koppler'];
  if (isVersion(format) && compareVersions(format, BOARD_FORMAT.version) > 0)
    problems.push(
      `${at}.koppler: ${format} is newer than this Koppler reads (${BOARD_FORMAT.version}); update Koppler`,
    );
  for (const [id] of entries(preset['nodes']))
    if (!has(stack['apps'], id)) problems.push(`${at}.nodes.${id}: no such app`);
  for (const [n, edge] of list(preset['edges']).entries()) {
    const from = isObject(edge) ? edge['from'] : undefined;
    const to = isObject(edge) ? edge['to'] : undefined;
    if (typeof from !== 'string' || typeof to !== 'string')
      problems.push(`${at}.edges[${String(n)}]: needs from and to`);
    else if (!has(preset['nodes'], from) || !has(preset['nodes'], to))
      problems.push(`${at}.edges: ${from} -> ${to} needs both apps in the preset`);
  }
  return problems;
}

/** Every sign-in an app names must be one the stack declares. */
function signInProblems(stack: Loose): string[] {
  const declared = new Set(entries(stack['signIns']).map(([name]) => name));
  const problems: string[] = [];
  for (const [id, app] of entries(stack['apps'])) {
    if (!isObject(app)) continue;
    const lists: [string, unknown][] = [
      [`apps.${id}.prereqs`, app['prereqs']],
      ...entries(app['envs']).map(([env, own]): [string, unknown] => [
        `apps.${id}.envs.${env}.prereqs`,
        isObject(own) ? own['prereqs'] : undefined,
      ]),
    ];
    for (const [at, prereqs] of lists)
      for (const [index, prereq] of list(prereqs).entries()) {
        const name = isObject(prereq) ? prereq['signIn'] : undefined;
        if (typeof name === 'string' && !declared.has(name))
          problems.push(`${at}[${String(index)}].signIn: no sign-in called ${name} under signIns`);
      }
  }
  return problems;
}
/** What the parts of a stack refer to in each other: the schema checks each part's shape, this checks they fit. */
function crossProblems(stack: Loose): string[] {
  const envs = isEnvList(stack['envs']) ? stack['envs'] : [];
  const problems: string[] = [];
  if (Array.isArray(stack['protected']) && !stack['protected'].every(env => envs.includes(env as string)))
    problems.push(`protected: ${PROTECTED}`);
  for (const [env] of entries(stack['envAliases']))
    if (!envs.includes(env)) problems.push(`envAliases.${env}: must be one of envs, with a list of names`);
  for (const [id] of entries(stack['kinds'])) {
    if (!/^[a-z0-9-]{1,32}$/.test(id)) problems.push(`kinds.${id}: id must be lowercase letters, digits and dashes`);
    else if (BUILT_IN_KINDS.includes(id)) problems.push(`kinds.${id}: Koppler already has a kind with this id`);
  }
  for (const [id, queue] of entries(stack['queues'])) {
    if (!/^[a-z0-9-]{1,64}$/.test(id)) problems.push(`queues.${id}: id must be lowercase letters, digits and dashes`);
    for (const [to] of entries(isObject(queue) ? queue['feeds'] : undefined))
      if (to === id) problems.push(`queues.${id}.feeds.${to}: a queue cannot feed itself`);
      else if (!has(stack['queues'], to)) problems.push(`queues.${id}.feeds.${to}: no such queue under "queues"`);
  }
  for (const [id, database] of entries(stack['databases'])) {
    if (!ID.test(id)) problems.push(`databases.${id}: id must be lowercase letters, digits and dashes`);
    for (const [env] of entries(isObject(database) ? database['envs'] : undefined))
      if (!envs.includes(env)) problems.push(`databases.${id}.envs.${env}: must be one of envs`);
  }
  for (const [id, app] of entries(stack['apps'])) {
    if (!ID.test(id)) problems.push(`apps.${id}: id must be lowercase letters, digits and dashes`);
    for (const [used] of entries(isObject(app) ? app['uses'] : undefined))
      if (!has(stack['databases'], used)) problems.push(`apps.${id}.uses.${used}: no such database under "databases"`);
    if (isObject(app)) problems.push(...appProblems(id, app, stack, envs));
  }
  for (const [index, preset] of list(stack['presets']).entries())
    if (isObject(preset)) problems.push(...presetProblems(index, preset, stack));
  for (const [name, signIn] of entries(stack['signIns'])) {
    if (!NAME.test(name)) problems.push(`signIns.${name}: a name of letters, digits, dots, dashes and underscores`);
    // What a sign-in gives an app is set where the app starts: never a variable that makes a runtime load code.
    for (const [setting] of entries(isObject(signIn) ? signIn['env'] : undefined))
      if (loadsCode(setting) || setting === 'PATH')
        problems.push(`signIns.${name}.env: "${setting}" cannot be given to an app; it changes what code the app runs`);
  }
  problems.push(...signInProblems(stack));
  return problems;
}

const where = (path: PropertyKey[]) =>
  path.reduce<string>(
    (text, part) =>
      typeof part === 'number' ? `${text}[${String(part)}]` : text ? `${text}.${String(part)}` : String(part),
    '',
  );

/**
 * Everything wrong with a stack, one line each, as `where: what`; empty when it can be used. Never throws, whatever it
 * is given.
 */
export function validateStack(raw: unknown): string[] {
  // Checked as it is used: with its expressions filled in.
  const stack = resolveExpressions(raw);
  const parsed = StackSchema.safeParse(stack);
  const expressions = expressionProblems(raw);
  // A value whose expression names nothing is that problem alone.
  const named = new Set(expressions.map(problem => problem.slice(0, problem.indexOf(': '))));
  const shape = parsed.success
    ? []
    : parsed.error.issues
        .filter(issue => !named.has(where(issue.path)))
        .map(issue => (issue.path.length > 0 ? `${where(issue.path)}: ${issue.message}` : issue.message));
  return [...new Set([...expressions, ...shape, ...(isObject(stack) ? crossProblems(stack) : [])])];
}

/** An app as an environment has it: that environment's fields replace the app's own, a list whole. */
export function appOn<A extends object>(
  stack: { envs: readonly string[]; apps: Record<string, A | undefined> },
  id: string,
  env: string,
): A | undefined {
  const app = Object.hasOwn(stack.apps, id) ? stack.apps[id] : undefined;
  if (!app || env === stack.envs[0]) return app;
  return { ...app, ...(app as { envs?: Record<string, object | undefined> }).envs?.[env] };
}

/** Where an app's secrets for an environment are stored: the first environment's under the app's id alone. */
export const storeOf = (stack: { envs: readonly string[] }, id: string, env: string): string =>
  env === stack.envs[0] ? id : `${id}@${env}`;
