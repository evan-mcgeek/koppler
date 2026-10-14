// Reads the Terraform in every stack app's clone and drafts what stack.json needs: each app's deployed address,
// the names of its settings and secrets, and the apps it calls. Only names and plain addresses are read out, never other values.
// The draft goes to temp/stack.deployed.json; the shared stack is never changed.
// Usage: koppler discover --deployed [app...]
import fs from 'node:fs';
import path from 'node:path';
import { fail } from '../failure.ts';
import { readClones, readStack, type Registry } from '../data.ts';
import { tempDir } from '../paths.ts';
import { findFiles } from './investigate.ts';
import { hostsByApp } from './sync.ts';
import { writeJson } from '../json-files.ts';
import { appOn } from '../core/stack.ts';

type Pair = [string, string];
/** What a Terraform expression is worked out from. */
export interface Context {
  workspace?: string | null;
  vars: Record<string, string>;
  locals: Record<string, string>;
}
type Resolved = string | Record<string, string> | null;
type QueueType = 'sqs' | 'sns';
/** A queue or topic a Terraform folder declares or looks up, and how its app uses it. */
export interface QueueUse {
  /** Its Terraform address, such as `aws_sqs_queue.orders`. */
  address: string;
  type: QueueType;
  /** Its name as written. */
  raw: string | null;
  reads: boolean;
  sends: boolean;
  /** The settings that carry its address. */
  env: string[];
  /** Outside systems that feed it. */
  fedBy: string[];
}
type NamedQueue = QueueUse & { name: string | null };
interface Domain {
  host: string;
  from: 'api' | 'cdn' | 'dns';
}
interface Setting {
  name: string;
  address: string | null;
  secret: boolean;
}
interface SecretName {
  store: string;
  raw: string;
  name: string | null;
}
/** One Terraform folder as one of its environments has it. */
export interface Module {
  token: string | null;
  queues: NamedQueue[];
  account: string | null;
  domains: Domain[];
  settings: Setting[];
  secrets: SecretName[];
  dir?: string;
}
interface Call {
  to: string;
  setting: string;
  deployed: string;
}
/** The draft for one app on one stack environment. */
export interface Draft {
  deployedUrl: string | null;
  otherAddresses: string[];
  accounts: string[];
  settingsWithAddress: { name: string; address: string }[];
  settings: string[];
  secretSettings: string[];
  secrets: { store: string; name: string }[];
  unnamedSecrets: number;
  calls: Call[];
  queues: Omit<NamedQueue, 'raw'>[];
}
type Drafts = Record<string, Record<string, Partial<Draft>>>;
/** One queue across the apps: who sends, who reads, what feeds it. */
export interface LinkedQueue {
  id: string;
  queue: string | null;
  type: string;
  /** Its name in the environments after the first. */
  envs: Record<string, string>;
  reads: string[];
  sends: string[];
  fedBy: string[];
  /** Per app, the settings that carry its address. */
  env: Record<string, string[]>;
  /** The one app it is internal to. */
  inside: string | null;
  address: string;
  owner: string;
  namedIn?: string[];
}
/** A stack as far as the drafts read it. */
interface EnvStack {
  envs: string[];
  envAliases?: Record<string, string[]> | undefined;
}
type AppsStack = EnvStack & {
  apps: Record<
    string,
    { deployedUrl?: string | undefined; envs?: Record<string, Record<string, unknown>> | undefined } | undefined
  >;
};
interface QueueStack {
  queues?: Record<string, { queue?: string | undefined }> | undefined;
}

export const ENV_TOKEN =
  /(?:^|[-_./])(dev|development|qa|test|uat|staging|stage|prod|production|prd|live)(?=[-_./]|$)/i;
const SYNONYMS: Record<string, string[]> = {
  prod: ['production', 'prd', 'live'],
  staging: ['stage'],
  dev: ['development'],
};
const HOST = /^(?=.{4,253}$)([a-z0-9-]+\.)+[a-z]{2,}$/i;
const SECRETISH = /secret|password|passwd|token|api_?key|private|credential|connectionstring/i;
// Settings and parameters of AWS's own tooling, which say nothing about the app.
const TOOLING = /^(PARAMETERS_SECRETS_EXTENSION|SECRETS_MANAGER_TTL|AWS_|POWERTOOLS_|\/aws\/)/;
const tokenIn = (name: string | undefined) => ENV_TOKEN.exec(name ?? '')?.[1]?.toLowerCase();

/**
 * Terraform text of the same length and lines, with what is inside quotes turned into "_" and comments into spaces, so
 * that braces, brackets and comment marks can be counted without mistaking text for code.
 */
// ponytail: heredocs (<<EOF) are read as code; mask them too if a policy written that way is ever misread
function masked(text: string): string {
  let out = '';
  // What the reader is inside of: a quoted text, or an interpolation with its count of open braces.
  const inside: ('text' | number)[] = [];
  for (let at = 0; at < text.length; at++) {
    const char = text[at] ?? '';
    const two = text.slice(at, at + 2);
    const top = inside.at(-1);
    const hide = (count: number, fill: string) => {
      const part = text.slice(at, at + count);
      at += count - 1;
      return part.replace(/[^\n]/g, fill);
    };
    const rest = (end: number, tail: number) => (end < 0 ? text.length : end + tail) - at;
    if (top === 'text') {
      if (char === '\\') out += hide(2, '_');
      else if (char === '"') {
        inside.pop();
        out += char;
      } else if (two === '${') {
        inside.push(0);
        out += hide(2, '_');
      } else out += hide(1, '_');
    } else if (char === '"') {
      inside.push('text');
      out += typeof top === 'number' ? '_' : char;
    } else if (typeof top === 'number') {
      if (char === '{') inside[inside.length - 1] = top + 1;
      else if (char === '}') {
        if (top === 0) inside.pop();
        else inside[inside.length - 1] = top - 1;
      }
      out += hide(1, '_');
    } else if (char === '#' || two === '//') out += hide(rest(text.indexOf('\n', at), 0), ' ');
    else if (two === '/*') out += hide(rest(text.indexOf('*/', at + 2), 2), ' ');
    else out += char;
  }
  return out;
}

/** The body between the braces that follow each match of `head`. */
export function blocks(text: string, head: RegExp): { match: RegExpExecArray; body: string }[] {
  const out: { match: RegExpExecArray; body: string }[] = [];
  const code = masked(text);
  for (const match of text.matchAll(head)) {
    // Named inside a comment or a quoted text, it is not a block.
    if (code[match.index] !== text[match.index]) continue;
    const open = code.indexOf('{', match.index + match[0].length - 1);
    if (open < 0) continue;
    let depth = 0;
    let at = open;
    for (; at < code.length; at++) {
      if (code[at] === '{') depth++;
      else if (code[at] === '}' && !--depth) break;
    }
    out.push({ match, body: text.slice(open + 1, at) });
  }
  return out;
}

const opened = (code: string) => (code.match(/[{[(]/g) ?? []).length - (code.match(/[}\])]/g) ?? []).length;
/** `key = value` pairs written directly in a block, with a nested map or list kept whole. */
export function assignments(body: string): Pair[] {
  const out: Pair[] = [];
  const code = masked(body).split('\n');
  const lines = body.split('\n').map((line, at) => line.slice(0, (code[at] ?? '').trimEnd().length));
  for (let at = 0, depth = 0; at < lines.length; at++) {
    const [, key, start] = (depth === 0 && /^\s*"?([\w.-]+)"?\s*=\s*(.*)$/.exec(lines[at] ?? '')) || [];
    if (key === undefined) {
      depth += opened(code[at] ?? '');
      continue;
    }
    let value = start ?? '';
    let open = opened(code[at] ?? '');
    while (open > 0 && ++at < lines.length) {
      value += '\n' + (lines[at] ?? '');
      open += opened(code[at] ?? '');
    }
    out.push([key, value.trim().replace(/,$/, '')]);
  }
  return out;
}
const assigned = (body: string, key: string) => assignments(body).find(([name]) => name === key)?.[1];

/** Works out a Terraform expression from variables, locals and the workspace; null when it cannot be told. */
export function resolve(raw: string | null | undefined, context: Context, depth = 0): Resolved {
  if (raw == null || depth > 12) return null;
  const again = (next: string | undefined) => resolve(next, context, depth + 1);
  const value = raw.trim();
  if (/^"[^"]*"$/.test(value) || /^"(?:[^"\\]|\\.|\$\{[^}]*\})*"$/.test(value)) {
    let unknown = 0;
    const text = value.slice(1, -1).replace(/\$\{([^}]+)\}/g, (_, reference: string) => {
      const part = again(reference);
      if (typeof part === 'string') return part;
      unknown++;
      return '';
    });
    return unknown ? null : text;
  }
  if (value.startsWith('{')) return Object.fromEntries(assignments(value.slice(1, value.lastIndexOf('}'))));
  if (value === 'terraform.workspace') return context.workspace ?? null;
  const either = /^([\w.[\]]+)\s*==\s*"([^"]*)"\s*\?\s*(.+?)\s+:\s+(.+)$/s.exec(value);
  if (either) {
    const left = again(either[1]);
    return typeof left === 'string' ? again(left === either[2] ? either[3] : either[4]) : null;
  }
  const index = /^(.+)\[([^[\]]+)\]$/.exec(value);
  if (index) {
    const map = again(index[1]);
    const key = again(index[2]);
    return map && typeof map === 'object' && typeof key === 'string' ? again(map[key]) : null;
  }
  const reference = /^(var|local)\.([\w-]+)$/.exec(value);
  if (reference) return again((reference[1] === 'var' ? context.vars : context.locals)[reference[2] ?? '']);
  return null;
}
const named = (raw: string | null | undefined, context: Context) => {
  const name = resolve(raw, context);
  return typeof name === 'string' ? name : null;
};

/** An address safe to show: a host, or an http(s) URL with no credentials, no query and no path that could be a token. */
export function addressOf(value: unknown): string | null {
  if (typeof value !== 'string') return null;
  if (HOST.test(value)) return value.toLowerCase();
  try {
    const url = new URL(value);
    if (!/^https?:$/.test(url.protocol) || url.username || url.password || url.search || !HOST.test(url.hostname))
      return null;
    // A path is kept only when it reads as a plain API prefix (/api/v1); anything else may be a token (a webhook URL).
    const segments = url.pathname.split('/').filter(Boolean);
    const plain = segments.length <= 3 && segments.every(segment => /^[a-z][a-z0-9-]{0,19}$/.test(segment));
    return plain ? `${url.origin}${url.pathname.replace(/\/$/, '')}` : url.origin;
  } catch {
    return null;
  }
}
/** The smallest {...} around position `at` in `text`. */
function around(text: string, at: number): string {
  let start = at;
  let depth = 0;
  for (; start >= 0; start--) {
    if (text[start] === '}') depth++;
    else if (text[start] === '{' && !depth--) break;
  }
  let end = at;
  depth = 0;
  for (; end < text.length; end++) {
    if (text[end] === '{') depth++;
    else if (text[end] === '}' && !depth--) break;
  }
  return text.slice(Math.max(0, start), end + 1);
}
const DEAD_LETTER = /dlq|dead.?letter/i;
const FEEDERS: Pair[] = [
  ['s3', 'S3 bucket notifications'],
  ['events', 'an EventBridge rule'],
  ['apigateway', 'an API Gateway route'],
  ['sns', 'an SNS topic'],
];
const resource = (types: string) => new RegExp(`(?:resource|data)\\s+"(${types})"\\s+"[\\w-]+"\\s*\\{`, 'g');
/** Settings a task definition gives its containers, as written. */
const taskSettings = (tf: string, value: string) =>
  blocks(tf, resource('aws_ecs_task_definition')).flatMap(block =>
    [...block.body.matchAll(new RegExp(`name\\s*[=:]\\s*"([\\w.]+)"\\s*,?\\s*value\\s*[=:]\\s*(${value})`, 'g'))].map(
      (match): Pair => [match[1] ?? '', match[2] ?? ''],
    ),
  );

/**
 * Queues and topics a Terraform folder declares or looks up, and how its app uses each: whether it reads or sends, the
 * settings that carry the queue's address, and outside systems that feed it. Dead-letter queues are left out.
 */
export function queueUses(tf: string): QueueUse[] {
  interface Found extends Omit<QueueUse, 'env' | 'fedBy'> {
    env: Set<string>;
    fedBy: Set<string>;
  }
  const found = new Map<string, Found>();
  const add = (address: string, type: QueueType, body: string) => {
    if (DEAD_LETTER.test(address)) return;
    const raw = assigned(body, 'name') ?? null;
    found.set(address, { address, type, raw, reads: false, sends: false, env: new Set(), fedBy: new Set() });
  };
  for (const { match, body } of blocks(tf, /(resource|data)\s+"(aws_sqs_queue|aws_sns_topic)"\s+"([\w-]+)"\s*\{/g))
    add(
      `${match[1] === 'data' ? 'data.' : ''}${match[2] ?? ''}.${match[3] ?? ''}`,
      match[2] === 'aws_sns_topic' ? 'sns' : 'sqs',
      body,
    );
  for (const { match, body } of blocks(tf, /module\s+"([\w-]+)"\s*\{/g)) {
    const source = assigned(body, 'source') ?? '';
    if (/\b(sqs|sns)\b/i.test(source)) add(`module.${match[1] ?? ''}`, /\bsns\b/i.test(source) ? 'sns' : 'sqs', body);
  }
  const refTo = (address: string) =>
    new RegExp(`${address.replace(/\./g, '\\.')}(?:\\[[^\\]]*\\])?\\.(?:arn|url|id|name)\\b`, 'g');
  for (const { match, body } of blocks(tf, /(?:resource|data)\s+"([\w-]+)"\s+"[\w-]+"\s*\{/g)) {
    const type = match[1] ?? '';
    for (const queue of found.values())
      for (const use of body.matchAll(refTo(queue.address))) {
        const near = around(body, use.index);
        if (/^aws_(sqs_queue|sns_topic)_policy$/.test(type)) {
          // The queue's own policy says which outside service may send to it.
          for (const [service, what] of FEEDERS) if (body.includes(`${service}.amazonaws.com`)) queue.fedBy.add(what);
        } else if (type === 'aws_lambda_event_source_mapping') queue.reads = true;
        else if (type === 'aws_s3_bucket_notification') queue.fedBy.add('S3 bucket notifications');
        else if (type === 'aws_cloudwatch_event_target') queue.fedBy.add('an EventBridge rule');
        else {
          // One statement can allow both.
          if (/sqs:SendMessage|sns:Publish|"sqs:\*"/.test(near)) queue.sends = true;
          if (/sqs:ReceiveMessage|"sqs:\*"/.test(near)) queue.reads = true;
        }
      }
  }
  // Settings whose value is the queue's address: what a local run sets to the local queue.
  const settings = [
    ...blocks(tf, /resource\s+"aws_lambda_function"\s+"[\w-]+"\s*\{/g)
      .flatMap(block => blocks(block.body, /variables\s*=\s*\{/g))
      .flatMap(block => assignments(block.body)),
    ...blocks(tf, /resource\s+"aws_ecs_task_definition"\s+"[\w-]+"\s*\{/g).flatMap(block =>
      [...block.body.matchAll(/name\s*[=:]\s*"([\w.]+)"\s*,?\s*value\s*[=:]\s*([^\s,}]+)/g)].map((match): Pair => [
        match[1] ?? '',
        match[2] ?? '',
      ]),
    ),
  ];
  for (const queue of found.values())
    for (const [name, raw] of settings) if (refTo(queue.address).test(raw)) queue.env.add(name);
  return [...found.values()].map(queue => ({ ...queue, env: [...queue.env].sort(), fedBy: [...queue.fedBy] }));
}

const hostOf = (address: string) => {
  try {
    return new URL(address.includes('://') ? address : `https://${address}`).hostname;
  } catch {
    return null;
  }
};

/**
 * One Terraform folder: what it declares, worked out once per environment. Environments come from its variable files'
 * names; without those, each name in `workspaces` is tried as the Terraform workspace (and as an `environment` variable).
 */
export function readModule(files: { name: string; text: string }[], workspaces: string[] = []): Module[] {
  const tf = files
    .filter(file => file.name.endsWith('.tf'))
    .map(file => file.text)
    .join('\n');
  const defaults = Object.fromEntries(
    blocks(tf, /variable\s+"([\w-]+)"\s*\{/g).flatMap(({ match, body }): Pair[] => {
      const value = assigned(body, 'default');
      return value === undefined ? [] : [[match[1] ?? '', value]];
    }),
  );
  const locals = Object.fromEntries(blocks(tf, /(^|\n)\s*locals\s*\{/g).flatMap(block => assignments(block.body)));
  const varFiles = files
    .filter(file => file.name.endsWith('.tfvars'))
    .map(file => ({ token: tokenIn(file.name), vars: Object.fromEntries(assignments(file.text)) }));
  const shared = varFiles.reduce((all, file) => (file.token ? all : { ...all, ...file.vars }), defaults);
  const perEnv = varFiles.flatMap(file => (file.token ? [{ token: file.token, vars: file.vars }] : []));
  const asVariables = (token: string) =>
    Object.fromEntries(['environment', 'env', 'stage'].filter(key => !(key in shared)).map(key => [key, `"${token}"`]));
  const contexts: (Context & { token: string | null })[] = perEnv.length
    ? perEnv.map(file => ({ token: file.token, workspace: file.token, vars: { ...shared, ...file.vars }, locals }))
    : workspaces.length
      ? workspaces.map(token => ({ token, workspace: token, vars: { ...asVariables(token), ...shared }, locals }))
      : [{ token: null, workspace: null, vars: shared, locals }];
  const pick = (types: string, key: string) =>
    blocks(tf, resource(types)).flatMap(block =>
      assignments(block.body)
        .filter(([name]) => name === key)
        .map(([, raw]) => raw),
    );
  const listed = (raw: string) =>
    raw.trim().startsWith('[')
      ? raw
          .replace(/^\[|\]$/g, '')
          .split(',')
          .map(item => item.trim())
          .filter(Boolean)
      : [raw];
  const from = (source: Domain['from']) => (raw: string) => ({ raw, from: source });
  const declared = {
    domains: [
      ...pick('aws_api_gateway_domain_name|aws_apigatewayv2_domain_name', 'domain_name').map(from('api')),
      ...pick('aws_cloudfront_distribution', 'aliases').flatMap(listed).map(from('cdn')),
      ...pick('aws_route53_record', 'name').map(from('dns')),
    ],
    settings: [
      ...blocks(tf, resource('aws_lambda_function'))
        .flatMap(block => blocks(block.body, /environment\s*\{/g))
        .flatMap(block => blocks(block.body, /variables\s*=\s*\{/g))
        .flatMap(block => assignments(block.body)),
      ...taskSettings(tf, '"[^"\\n]*"|[^\\s,}]+'),
    ],
    secrets: [
      ...[...pick('aws_secretsmanager_secret', 'name'), ...pick('aws_secretsmanager_secret_version', 'secret_id')].map(
        raw => ({ raw, store: 'Secrets Manager' }),
      ),
      ...pick('aws_ssm_parameter', 'name').map(raw => ({ raw, store: 'Parameter Store' })),
    ],
  };
  const queues = queueUses(tf);
  // Only a variable that names the account, with a value that reads as an id or a name: never a key or a token.
  const accountOf = (context: Context) =>
    Object.entries(context.vars)
      .filter(([key]) => /^(aws_)?account(_?(id|name|alias))?$/i.test(key))
      .map(([, raw]) => named(raw, context))
      .find(value => value !== null && /^[\w.-]{1,64}$/.test(value)) ?? null;
  return contexts.map(context => ({
    token: context.token,
    queues: queues
      .map(queue => ({ ...queue, name: named(queue.raw, context) }))
      .filter(queue => !DEAD_LETTER.test(queue.name ?? '')),
    account: accountOf(context),
    domains: declared.domains.flatMap(({ raw, from: source }): Domain[] => {
      const host = addressOf(resolve(raw, context) ?? '');
      return host && !host.includes('/') ? [{ host, from: source }] : [];
    }),
    settings: declared.settings
      .filter(([name]) => !TOOLING.test(name))
      .map(([name, raw]) => ({
        name,
        address: addressOf(resolve(raw, context)),
        secret: SECRETISH.test(name) || /secret|sensitive/i.test(raw),
      })),
    // A name partly built at deploy time keeps its written form ("svc-${random}"); one that is all code is only counted.
    secrets: declared.secrets
      .map(({ raw, store }) => {
        const written = raw.trim();
        const name = named(raw, context) ?? (/^"[^"]*"$/.test(written) ? written.slice(1, -1) : null);
        return { store, raw: written, name };
      })
      .filter(secret => !TOOLING.test(secret.name ?? '')),
  }));
}

/** Which stack environment a Terraform environment name means: the same name, a common synonym, or one listed in the stack's envAliases. */
export function stackEnv(token: string | null | undefined, stack: EnvStack): string | null {
  if (!token) return stack.envs.length === 1 ? (stack.envs[0] ?? null) : null;
  const means = (env: string) =>
    env === token || SYNONYMS[env]?.includes(token) || stack.envAliases?.[env]?.includes(token);
  return stack.envs.find(means) ?? null;
}

/**
 * The domains a SAM app deploys to, per samconfig.toml environment: its domain-like deploy parameters (HostedZoneName,
 * DomainName, ...), the way Terraform's domain resources are read.
 */
export function samDomains(toml: string): { token: string; domains: Domain[] }[] {
  const out: { token: string; domains: Domain[] }[] = [];
  for (const section of toml.matchAll(/\[([\w-]+)\.deploy\.parameters\]([\s\S]*?)(?=\n\[|$)/g)) {
    // One text or a list of them, in double or single quotes; a commented-out line is not read.
    const overrides = /^[ \t]*parameter_overrides\s*=\s*(\[[\s\S]*?\]|"(?:[^"\\]|\\.)*"|'[^']*')/m.exec(
      section[2] ?? '',
    );
    const line = [...(overrides?.[1] ?? '').matchAll(/"((?:[^"\\]|\\.)*)"|'([^']*)'/g)]
      .map(text => text[2] ?? (text[1] ?? '').replace(/\\(.)/g, '$1'))
      .join(' ');
    // Only parameters that name the app's own domain: a database or cache host is someone else's address.
    const domains = [...line.matchAll(/(\w+)=(?:"([^"]*)"|(\S+))/g)].flatMap(([, key = '', quoted, bare]): Domain[] => {
      const value = quoted ?? bare ?? '';
      const own = /(domain|hostedzone)(name)?$/i.test(key) && addressOf(value) && !value.includes('/');
      return own ? [{ host: value.toLowerCase(), from: 'api' }] : [];
    });
    out.push({ token: (section[1] ?? '').toLowerCase(), domains });
  }
  return out.filter(section => section.domains.length);
}

/** Every Terraform folder of a clone, read per environment; a SAM app's samconfig.toml adds its domains. */
export function readRepo(repo: string, workspaces: string[] = []): Module[] {
  const byDir = new Map<string, { name: string; text: string }[]>();
  for (const file of findFiles(repo, name => /\.(tf|tfvars)$/.test(name), 7)) {
    let text: string;
    try {
      text = fs.readFileSync(file, 'utf8');
    } catch {
      continue;
    }
    const dir = path.dirname(file);
    byDir.set(dir, [...(byDir.get(dir) ?? []), { name: path.basename(file), text }]);
  }
  const terraform = [...byDir]
    .filter(([, files]) => files.some(file => file.name.endsWith('.tf')))
    .flatMap(([dir, files]) =>
      readModule(files, workspaces).map(module => ({ ...module, dir: path.relative(repo, dir) })),
    );
  let sam: Module[] = [];
  try {
    sam = samDomains(fs.readFileSync(path.join(repo, 'samconfig.toml'), 'utf8')).map(({ token, domains }) => ({
      token,
      account: null,
      domains,
      settings: [],
      secrets: [],
      queues: [],
      dir: 'samconfig.toml',
    }));
  } catch {
    // Not a SAM app.
  }
  return [...terraform, ...sam];
}

const RANK = { api: 0, cdn: 1, dns: 2 };
const deployedUrlOf = (stack: AppsStack, id: string, env: string) => appOn(stack, id, env)?.deployedUrl;
const union = (a: string[] | undefined, b: string[]) => [...new Set([...(a ?? []), ...b])];

/** The draft for one app: per stack environment its address, account, settings, secrets and calls. */
export function draftApp(
  id: string,
  modules: Module[],
  stack: AppsStack,
  owners: Map<string | null, string>,
): Record<string, Draft> {
  interface Gathered {
    domains: (Domain & { own: boolean })[];
    settings: Map<string, Setting>;
    secrets: Map<string, SecretName>;
    accounts: Set<string>;
    queues: Map<string, Omit<NamedQueue, 'raw'>>;
  }
  const gathered: Record<string, Gathered> = {};
  // What a repo says under the environment's own name wins over what it says under an alias.
  const own = (module: Module) => stack.envs.includes(module.token ?? '');
  for (const module of [...modules].sort((a, b) => Number(own(a)) - Number(own(b)))) {
    const env = stackEnv(module.token, stack);
    if (!env) continue;
    const into = (gathered[env] ??= {
      domains: [],
      settings: new Map(),
      secrets: new Map(),
      accounts: new Set(),
      queues: new Map(),
    });
    if (own(module) && module.domains.length) into.domains = into.domains.filter(domain => domain.own);
    into.domains.push(...module.domains.map(domain => ({ ...domain, own: own(module) })));
    if (module.account) into.accounts.add(module.account);
    for (const setting of module.settings) {
      const had = into.settings.get(setting.name);
      into.settings.set(setting.name, { ...had, ...setting, address: setting.address ?? had?.address ?? null });
    }
    for (const secret of module.secrets) into.secrets.set(`${secret.store}:${secret.name ?? secret.raw}`, secret);
    for (const queue of (module.queues as NamedQueue[] | undefined) ?? []) {
      const key = queue.name ?? `${module.dir ?? ''}:${queue.address}`;
      const had = into.queues.get(key);
      into.queues.set(key, {
        type: queue.type,
        name: queue.name,
        address: queue.address,
        reads: had?.reads || queue.reads,
        sends: had?.sends || queue.sends,
        env: union(had?.env, queue.env).sort(),
        fedBy: union(had?.fedBy, queue.fedBy),
      });
    }
  }
  return Object.fromEntries(
    Object.entries(gathered).map(([env, found]): [string, Draft] => {
      const ranked = found.domains.sort((a, b) => RANK[a.from] - RANK[b.from]);
      const domains = [...new Map(ranked.map(domain => [domain.host, domain])).values()];
      const settings = [...found.settings.values()];
      const calls = settings.flatMap(({ name, address }): Call[] => {
        const callee = address && owners.get(hostOf(address));
        return callee && callee !== id ? [{ to: callee, setting: name, deployed: address }] : [];
      });
      // The address the stack already has, when Terraform names it too, stays the app's address.
      const have = hostOf(deployedUrlOf(stack, id, env) ?? '');
      domains.sort((a, b) => Number(b.host === have) - Number(a.host === have));
      const [first, ...others] = domains;
      const secrets = [...found.secrets.values()];
      return [
        env,
        {
          deployedUrl: first ? `https://${first.host}/` : null,
          otherAddresses: others.map(domain => domain.host),
          accounts: [...found.accounts],
          settingsWithAddress: settings.flatMap(({ name, address, secret }) =>
            !secret && address ? [{ name, address }] : [],
          ),
          settings: settings
            .filter(setting => !setting.secret)
            .map(setting => setting.name)
            .sort(),
          secretSettings: settings
            .filter(setting => setting.secret)
            .map(setting => setting.name)
            .sort(),
          secrets: secrets.flatMap(({ store, name }) => (name ? [{ store, name }] : [])),
          unnamedSecrets: secrets.filter(secret => !secret.name).length,
          calls,
          queues: [...found.queues.values()],
        },
      ];
    }),
  );
}

/**
 * One entry per queue across the apps, by its name in the first environment: who sends, who reads, what feeds it.
 * A queue only one app touches, with nothing outside feeding it, is internal to that app and not a link.
 */
export function linkQueues(drafts: Drafts, stack: EnvStack): LinkedQueue[] {
  interface User {
    reads: boolean;
    sends: boolean;
    env: Set<string>;
  }
  interface Entry {
    queue: string | null;
    address: string;
    type: string;
    users: Map<string, User>;
    fedBy: Set<string>;
    envs: Record<string, string>;
  }
  const [first = ''] = stack.envs;
  const byName = new Map<string, Entry>();
  const all = Object.entries(drafts).flatMap(([app, envs]) =>
    Object.entries(envs).flatMap(([env, draft]) => (draft.queues ?? []).map(queue => ({ app, env, queue }))),
  );
  for (const { app, env, queue } of all) {
    if (env !== first) continue;
    const key = queue.name ?? `${app}:${queue.address}`;
    const entry: Entry = byName.get(key) ?? {
      queue: queue.name,
      address: queue.address,
      type: queue.type,
      users: new Map(),
      fedBy: new Set(),
      envs: {},
    };
    const user = entry.users.get(app) ?? { reads: false, sends: false, env: new Set<string>() };
    entry.users.set(app, {
      reads: user.reads || queue.reads,
      sends: user.sends || queue.sends,
      env: new Set([...user.env, ...queue.env]),
    });
    for (const feeder of queue.fedBy) entry.fedBy.add(feeder);
    byName.set(key, entry);
  }
  // The same queue's name in the other environments, from the app that declares it.
  for (const { app, env, queue } of all) {
    if (env === first) continue;
    const name = drafts[app]?.[first]?.queues?.find(other => other.address === queue.address)?.name;
    const entry = name ? byName.get(name) : undefined;
    if (entry && queue.name && queue.name !== name) entry.envs[env] = queue.name;
  }
  // A queue or topic no app sends to or reads, and nothing feeds (an alarm topic, a spare dead-letter queue), is not a link.
  const used = (user: User) => user.reads || user.sends || user.env.size > 0;
  return [...byName.values()]
    .filter(entry => entry.fedBy.size || [...entry.users.values()].some(used))
    .map(entry => {
      const users = [...entry.users];
      const owner = users[0]?.[0] ?? '';
      const resourceName = (entry.address.split('.').pop() ?? '').replace(/_/g, '-');
      const reads = users.filter(([, user]) => user.reads).map(([app]) => app);
      // An app that only carries the address and neither sends nor reads by itself is taken to send.
      const sends = users.filter(([, user]) => user.sends || (!user.reads && user.env.size)).map(([app]) => app);
      // Internal: one app both sends and reads, and nothing outside feeds it. One side unknown is a link still to find.
      const internal = users.length === 1 && !entry.fedBy.size && reads.length && sends.length;
      return {
        id: entry.queue ? queueId(entry.queue) : `${owner}-${resourceName}`,
        queue: entry.queue,
        type: entry.type,
        envs: entry.envs,
        reads,
        sends,
        fedBy: [...entry.fedBy],
        env: Object.fromEntries(users.map(([app, user]) => [app, [...user.env].sort()])),
        inside: internal ? owner : null,
        address: entry.address,
        owner,
      };
    });
}
const QUEUE_WORDS = ['sqs', 'sns', 'queue', 'topic'];
/** "bookings-sqs-queue-dev" and "user-media-thumbnail-queue" become "bookings" and "user-media-thumbnail". */
export const queueId = (name: string): string =>
  name
    .toLowerCase()
    .replace(/\.fifo$/, '')
    .split(/[^a-z0-9]+/)
    .filter(word => word && !ENV_TOKEN.test(`-${word}-`) && !QUEUE_WORDS.includes(word))
    .join('-') || 'queue';
/** A queue the stack already has, by its id or its real name. */
export const inStack = (queue: Pick<LinkedQueue, 'id' | 'queue'>, stack: QueueStack): boolean =>
  !!stack.queues?.[queue.id] || Object.values(stack.queues ?? {}).some(own => own.queue && own.queue === queue.queue);
const titled = (id: string) =>
  id
    .split('-')
    .map(word => word.charAt(0).toUpperCase() + word.slice(1))
    .join(' ');
/** What stack.json would need for the queues it does not list yet: the queue, and publishes / reads on each app. */
export function queueDraft(queues: LinkedQueue[], stack: QueueStack) {
  const out: {
    queues: Record<string, object>;
    apps: Record<string, Partial<Record<'publishes' | 'reads', Record<string, { env?: string[] }>>>>;
  } = { queues: {}, apps: {} };
  for (const queue of queues) {
    if (queue.inside || inStack(queue, stack)) continue;
    const perEnv = Object.entries(queue.envs).map(([env, name]) => [env, { queue: name }]);
    out.queues[queue.id] = {
      name: titled(queue.id),
      type: queue.type,
      ...(queue.queue && { queue: queue.queue }),
      ...(perEnv.length && { envs: Object.fromEntries(perEnv) as object }),
      ...(queue.fedBy.length && { note: `Fed by ${queue.fedBy.join(' and ')}` }),
    };
    for (const [key, apps] of [
      ['publishes', queue.sends],
      ['reads', queue.reads],
    ] as const)
      for (const app of apps) {
        const env = queue.env[app];
        ((out.apps[app] ??= {})[key] ??= {})[queue.id] = env?.length ? { env } : {};
      }
  }
  return out;
}

/** Outside systems recognised by their addresses: never run locally, each environment uses its own (a sandbox below PROD). */
export const OUTSIDE = [
  {
    id: 'salesforce',
    name: 'Salesforce',
    test: /(^|\.)(my\.salesforce\.com|my\.site\.com|force\.com|salesforce-scrt\.com|my\.salesforce-sites\.com)$/i,
    why: 'the Salesforce org: never runs locally; each environment uses its own org, a sandbox below PROD',
  },
];
type Reached = Record<string, Record<string, { hosts: Set<string>; settings: Set<string> }>>;
/** Each outside system an app reaches, per stack environment: from its Terraform settings and its appsettings.<Env>.json files. */
export function outsideCalls(repo: string, drafts: Record<string, Partial<Draft>>, stack: EnvStack): Reached {
  const found: Reached = {};
  const add = (env: string, address: string, setting: string) => {
    const host = hostOf(address);
    const provider = host && OUTSIDE.find(outside => outside.test.test(host));
    if (!host || !provider) return;
    const reached = ((found[provider.id] ??= {})[env] ??= { hosts: new Set(), settings: new Set() });
    reached.hosts.add(host);
    if (setting) reached.settings.add(setting);
  };
  for (const [env, draft] of Object.entries(drafts))
    for (const setting of draft.settingsWithAddress ?? []) add(env, setting.address, setting.name);
  for (const file of findFiles(repo, name => /^appsettings\.[\w-]+\.json$/i.test(name), 6)) {
    const env = stackEnv(tokenIn(path.basename(file)), stack);
    if (!env) continue;
    let text: string;
    try {
      text = fs.readFileSync(file, 'utf8');
    } catch {
      continue;
    }
    for (const [, key = '', address = ''] of text.matchAll(/"([\w.:-]+)"\s*:\s*"(https?:\/\/[^"\s]+)"/g))
      add(env, address, key.replace(/:/g, '__'));
  }
  return found;
}

interface Suggested {
  deployedUrl?: string;
  consumes?: Record<string, { how: string; env: string[]; deployed: string }>;
  envs?: Record<string, Suggested>;
}
const isEmpty = (value: object) => !Object.keys(value).length;
/** Ready to copy into stack.json: only what it does not have yet. */
function suggestionsFor(stack: Registry, drafts: Record<string, Record<string, Draft>>): Record<string, Suggested> {
  const suggestions: Record<string, Suggested> = {};
  for (const [id, envs] of Object.entries(drafts))
    for (const [env, draft] of Object.entries(envs)) {
      const whole = (suggestions[id] ??= {});
      const target = env === stack.envs[0] ? whole : ((whole.envs ??= {})[env] ??= {});
      if (draft.deployedUrl && !deployedUrlOf(stack, id, env)) target.deployedUrl = draft.deployedUrl;
      for (const call of draft.calls)
        if (!stack.apps[id]?.consumes?.[call.to])
          (target.consumes ??= {})[call.to] = { how: 'env', env: [call.setting], deployed: call.deployed };
    }
  // An environment, and then an app, with nothing new is left out; the rest keeps its order.
  const withSomething = <T extends object>(from: Record<string, T>) =>
    Object.fromEntries(Object.entries(from).filter(([, value]) => !isEmpty(value)));
  for (const [id, whole] of Object.entries(suggestions)) {
    const envs = withSomething(whole.envs ?? {});
    const kept = Object.entries(whole).flatMap(([key, value]): [string, unknown][] =>
      key !== 'envs' ? [[key, value]] : isEmpty(envs) ? [] : [[key, envs]],
    );
    suggestions[id] = Object.fromEntries(kept);
  }
  return withSomething(suggestions);
}

export function deployed(args: string[] = []): void {
  const stack = readStack() ?? fail('no stack loaded (koppler init)');
  const clones = readClones();
  const ids = args.filter(arg => !arg.startsWith('--'));
  for (const id of ids) if (!stack.apps[id]) fail(`${id} is not an app in the stack`);
  const nameOf = (id: string) => String(stack.apps[id]?.name);
  const cloned = Object.keys(stack.apps).flatMap((id): [string, string][] => {
    const repo = clones[id]?.path;
    return repo ? [[id, repo]] : [];
  });
  const workspaces = [...new Set(stack.envs.flatMap(env => [env, ...(stack.envAliases?.[env] ?? [])]))];
  const repos = Object.fromEntries(cloned.map(([id, repo]) => [id, readRepo(repo, workspaces)]));
  // Hosts the stack already knows, plus the addresses drafted here, so calls to apps without an address yet are found too.
  const owners = new Map<string | null, string>(
    Object.entries(hostsByApp(stack)).flatMap(([id, hosts]) => [...hosts].map((host): [string, string] => [host, id])),
  );
  const draftAll = () =>
    Object.fromEntries(Object.entries(repos).map(([id, modules]) => [id, draftApp(id, modules, stack, owners)]));
  for (const [id, envs] of Object.entries(draftAll()))
    for (const draft of Object.values(envs)) {
      const host = draft.deployedUrl && hostOf(draft.deployedUrl);
      if (host && !owners.has(host)) owners.set(host, id);
    }
  const drafts = draftAll();

  for (const id of ids.length ? ids : Object.keys(stack.apps)) {
    const app = stack.apps[id];
    const envs = drafts[id] ?? {};
    const modules = repos[id];
    console.log(`\n${nameOf(id)} (${id})`);
    if (!modules) {
      console.log('  not cloned');
      continue;
    }
    if (!modules.length) {
      console.log('  no Terraform in its clone');
      continue;
    }
    if (isEmpty(envs)) {
      const theirs = [...new Set(modules.map(module => module.token ?? 'unnamed'))].join(', ');
      console.log(
        `  Terraform found, but none of its environments (${theirs}) matches the stack's (${stack.envs.join(', ')}); list them in envAliases`,
      );
      continue;
    }
    const lines = Object.entries(envs).map(([env, draft]): [string, string[]] => {
      const have = deployedUrlOf(stack, id, env);
      const same = have && draft.deployedUrl && hostOf(have) === hostOf(draft.deployedUrl);
      const against = !draft.deployedUrl
        ? have
          ? `  (stack.json has ${have})`
          : ''
        : same
          ? '  (matches stack.json)'
          : have
            ? `  OTHER than stack.json: ${have}`
            : '  NEW';
      const said = [
        `address   ${draft.deployedUrl ?? 'not found'}${against}`,
        draft.otherAddresses.length && `also      ${draft.otherAddresses.join(', ')}`,
        draft.accounts.length && `account   ${draft.accounts.join(', ')}`,
        ...draft.calls.map(
          call =>
            `calls     ${call.to} through ${call.setting}${app?.consumes?.[call.to] ? '  (in stack.json)' : '  NEW'}`,
        ),
        draft.settings.length && `settings  ${draft.settings.join(', ')}`,
        draft.secretSettings.length && `settings that hold or point to a secret  ${draft.secretSettings.join(', ')}`,
        ...draft.secrets.map(
          secret => `${secret.store === 'Secrets Manager' ? 'secret   ' : 'parameter'} ${secret.name}`,
        ),
        draft.unnamedSecrets && `secrets   ${String(draft.unnamedSecrets)} more, named when deployed`,
      ];
      return [env, said.filter(line => typeof line === 'string')];
    });
    // What every environment shares is printed once.
    const [first, ...others] = lines.map(([, said]) => said);
    const common = first && others.length ? first.filter(line => others.every(said => said.includes(line))) : [];
    for (const [env, said] of lines) {
      const own = said.filter(line => !common.includes(line));
      if (own.length) console.log(`  ${env.toUpperCase()}`);
      for (const line of own) console.log(`    ${line}`);
    }
    if (common.length) {
      console.log('  EVERY ENVIRONMENT');
      for (const line of common) console.log(`    ${line}`);
    }
  }
  const suggestions = suggestionsFor(stack, drafts);
  const queues = linkQueues(drafts, stack);
  // Other apps whose code or settings name a queue: likely its other side, for the user to confirm.
  const namesOf = (queue: LinkedQueue) =>
    [queue.queue, ...Object.values(queue.envs)].flatMap(name => (name ? [name.replace(/\.fifo$/, '')] : []));
  const isCode = (name: string) =>
    /\.(json|cs|ts|js|py|go|java|kt|dart|yaml|yml|env)$/.test(name) && !/lock|\.min\./.test(name);
  const textOf = (file: string) => {
    try {
      return fs.statSync(file).size < 512 * 1024 ? fs.readFileSync(file, 'utf8') : '';
    } catch {
      return '';
    }
  };
  const texts = Object.fromEntries(cloned.map(([id, repo]) => [id, findFiles(repo, isCode, 6).map(textOf).join('\n')]));
  for (const queue of queues)
    queue.namedIn = Object.entries(texts)
      .filter(
        ([id, text]) =>
          ![...queue.sends, ...queue.reads].includes(id) && namesOf(queue).some(name => text.includes(name)),
      )
      .map(([id]) => id);
  if (queues.length) {
    console.log('\nQueues and topics');
    for (const queue of queues) {
      const users = [
        ...queue.sends.map(app => `${nameOf(app)} sends`),
        ...queue.reads.map(app => `${nameOf(app)} reads`),
        ...queue.fedBy.map(feeder => `fed by ${feeder}`),
      ];
      const oneSided = !queue.inside && !queue.fedBy.length;
      const missing = !oneSided
        ? ''
        : !queue.reads.length
          ? ', reader not found'
          : !queue.sends.length
            ? ', sender not found'
            : '';
      if (queue.namedIn?.length) users.push(`named in ${queue.namedIn.map(nameOf).join(', ')}'s code`);
      const what = queue.queue ?? `${queue.address} in ${nameOf(queue.owner)}, named when deployed`;
      const where = queue.inside
        ? `  (inside ${nameOf(queue.inside)} only)`
        : inStack(queue, stack)
          ? '  (in stack.json)'
          : '  NEW';
      console.log(`  ${what} (${queue.type.toUpperCase()})  ${users.join(', ') || 'no use found'}${missing}${where}`);
    }
  }
  // Outside systems the apps reach, with the address each environment uses.
  const outside: Record<string, Record<string, { hosts: Set<string>; apps: Record<string, string[]> }>> = {};
  for (const [id, envs] of Object.entries(drafts))
    for (const [provider, byEnv] of Object.entries(outsideCalls(clones[id]?.path ?? '', envs, stack)))
      for (const [env, reached] of Object.entries(byEnv)) {
        const known = ((outside[provider] ??= {})[env] ??= { hosts: new Set(), apps: {} });
        for (const host of reached.hosts) known.hosts.add(host);
        known.apps[id] = union(known.apps[id], [...reached.settings]);
      }
  const outsideSuggestions: { apps: Record<string, Record<string, unknown>> } = { apps: {} };
  for (const [provider, byEnv] of Object.entries(outside)) {
    const known = stack.apps[provider];
    const system = OUTSIDE.find(one => one.id === provider);
    if (!system) continue;
    console.log(`\n${system.name} (outside)${known ? '  (in stack.json)' : '  NEW'}`);
    for (const env of stack.envs) {
      const reached = byEnv[env];
      if (!reached) continue;
      const users = Object.keys(reached.apps).map(nameOf).join(', ');
      console.log(`  ${env.toUpperCase()}  ${[...reached.hosts].join(', ')}  used by ${users}`);
    }
    // The address each environment uses: the one most apps name.
    const pick = (env: string) => {
      const hosts = [...(byEnv[env]?.hosts ?? [])].sort((a, b) => b.length - a.length);
      const host = hosts.find(one => /\.my\.site\.com$|\.my\.salesforce\.com$/.test(one)) ?? hosts[0];
      return host ? `https://${host}` : null;
    };
    if (!known) {
      const [firstEnv = '', ...laterEnvs] = stack.envs;
      const first = pick(firstEnv);
      const more = laterEnvs.flatMap((env): [string, { deployedUrl: string }][] => {
        const url = pick(env);
        return url ? [[env, { deployedUrl: url }]] : [];
      });
      outsideSuggestions.apps[provider] = {
        name: system.name,
        kind: 'other',
        outside: system.why,
        ...(first && { deployedUrl: first }),
        ...(more.length && { envs: Object.fromEntries(more) }),
      };
    }
    for (const reached of Object.values(byEnv))
      for (const [app, settings] of Object.entries(reached.apps)) {
        if (stack.apps[app]?.consumes?.[provider]) continue;
        const consumes = ((outsideSuggestions.apps[app] ??= {})['consumes'] ??= {}) as Record<string, unknown>;
        consumes[provider] = { how: 'env', env: settings.length ? settings : undefined };
      }
  }
  const queueSuggestions = queueDraft(queues, stack);
  const file = path.join(tempDir(), 'stack.deployed.json');
  const draft = { at: new Date().toISOString(), suggestions, queueSuggestions, outsideSuggestions, apps: drafts };
  writeJson(file, draft);
  const newQueues = Object.keys(queueSuggestions.queues).length;
  if (newQueues) console.log(`${String(newQueues)} queues are new for stack.json (queueSuggestions in the draft).`);
  console.log(
    `\n${String(Object.keys(suggestions).length)} apps have something new for stack.json. Draft for review: ${file}`,
  );
}
