// Reads Terraform and SAM config text: what each module declares per environment (addresses, settings, secret names,
// calls and queues). Only names and plain addresses are read out, never other values.

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

export type NamedQueue = QueueUse & { name: string | null };

export interface Domain {
  host: string;
  from: 'api' | 'cdn' | 'dns';
}

export interface Setting {
  name: string;
  address: string | null;
  secret: boolean;
}

export interface SecretName {
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

export interface Call {
  to: string;
  setting: string;
  deployed: string;
}

/** A stack as far as the drafts read it. */
export interface EnvStack {
  envs: string[];
  envAliases?: Record<string, string[]> | undefined;
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

export const tokenIn = (name: string | undefined) => ENV_TOKEN.exec(name ?? '')?.[1]?.toLowerCase();

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

export const hostOf = (address: string) => {
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
