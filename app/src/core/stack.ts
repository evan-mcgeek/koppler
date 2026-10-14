// The stack file: its shape, the types the rest of the code reads it by, and the check a stack has to pass before it
// is used. One definition gives all three.
import * as z from 'zod';
import { loadsCode } from '../safe-env.ts';
import { BUILT_IN_KINDS } from './kinds.ts';
import { QUEUE_TYPES } from './plan.ts';
import { VERSION as PRESET_VERSION } from './presets.ts';

/** The kinds of stored secret Koppler can test by connecting. */
export const SECRET_TYPES = ['postgres', 'mysql', 'redis'] as const;

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
    cmd: z.string().optional().describe('The command that opens the tunnel, when it is not the usual one'),
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
/** How one app calls another, and so what to change to point it at a local copy. */
const Call = z.looseObject(
  {
    how: z.string().optional().describe('How it picks the address: a setting, a settings file, an edit'),
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

/** What differs for an app on an environment other than the stack's first. */
const EnvOverlay = z.looseObject(
  {
    prereqs: z.array(Prereq, { error: 'a list' }).optional(),
    secrets: z.array(Secret, { error: 'a list' }).optional(),
    start: start.optional(),
  },
  { error: 'an object' },
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
  for (const key of ['publishes', 'reads'])
    for (const [queue] of entries(app[key]))
      if (!has(stack['queues'], queue)) problems.push(`${at}.${key}.${queue}: no such queue under "queues"`);
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
  for (const [id] of entries(stack['queues']))
    if (!/^[a-z0-9-]{1,64}$/.test(id)) problems.push(`queues.${id}: id must be lowercase letters, digits and dashes`);
  for (const [id, app] of entries(stack['apps'])) {
    if (!ID.test(id)) problems.push(`apps.${id}: id must be lowercase letters, digits and dashes`);
    if (isObject(app)) problems.push(...appProblems(id, app, stack, envs));
  }
  for (const [index, preset] of list(stack['presets']).entries())
    if (isObject(preset)) problems.push(...presetProblems(index, preset, stack));
  for (const [name] of entries(stack['signIns']))
    if (!NAME.test(name)) problems.push(`signIns.${name}: a name of letters, digits, dots, dashes and underscores`);
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
export function validateStack(stack: unknown): string[] {
  const parsed = StackSchema.safeParse(stack);
  const shape = parsed.success
    ? []
    : parsed.error.issues.map(issue =>
        issue.path.length > 0 ? `${where(issue.path)}: ${issue.message}` : issue.message,
      );
  return [...new Set([...shape, ...(isObject(stack) ? crossProblems(stack) : [])])];
}
