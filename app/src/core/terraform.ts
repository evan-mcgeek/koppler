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

type QueueType = 'sqs' | 'sns' | 'eventbridge' | 'kafka';
export type FeedVia = 'pipe' | 'rule' | 'subscription';

/** One queue, topic or bus feeding another: `to` is another's Terraform address here, or `name:<its name>` elsewhere. */
export interface Feed {
  to: string;
  via: FeedVia;
}

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
  /** The queues, topics and buses it feeds. */
  feeds: Feed[];
  /** How its app reads it when not by itself: a pipe or rule to a Lambda or an API destination. */
  via?: string;
  /** Its name is a list or map of names, one queue each (Kafka topics a pipe reads): its keys, or its values. */
  list?: 'key' | 'value';
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

/** A bucket an app's role may read or write: one its Terraform declares (`aws_s3_bucket.x`), or `name:<bucket>`. */
export interface BucketUse {
  address: string;
  name: string | null;
  reads: boolean;
  writes: boolean;
}

/** An API Gateway route and what it hands to: the app's own Lambda, a queue or a state machine, by Terraform address. */
export interface RouteUse {
  api: string;
  apiName: string | null;
  route: string;
  to: { own: true } | { queue: string } | { machine: string };
}

/** A Step Functions state machine: its steps in order, whether the app's own Lambda runs each, and what starts it. */
export interface MachineUse {
  address: string;
  name: string | null;
  steps: { name: string; own: boolean }[];
  /** The app's own role may start it. */
  startedHere: boolean;
  /** A schedule starts it. */
  scheduled: boolean;
}

/** One Terraform folder as one of its environments has it. */
export interface Module {
  token: string | null;
  queues: NamedQueue[];
  buckets: BucketUse[];
  routes: RouteUse[];
  machines: MachineUse[];
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
  const add = (address: string, type: QueueType, raw: string | null) => {
    if (DEAD_LETTER.test(address)) return;
    found.set(address, { address, type, raw, reads: false, sends: false, env: new Set(), fedBy: new Set(), feeds: [] });
  };
  const TYPES: Record<string, QueueType> = {
    aws_sqs_queue: 'sqs',
    aws_sns_topic: 'sns',
    aws_cloudwatch_event_bus: 'eventbridge',
  };
  for (const { match, body } of blocks(
    tf,
    /(resource|data)\s+"(aws_sqs_queue|aws_sns_topic|aws_cloudwatch_event_bus)"\s+"([\w-]+)"\s*\{/g,
  ))
    add(
      `${match[1] === 'data' ? 'data.' : ''}${match[2] ?? ''}.${match[3] ?? ''}`,
      TYPES[match[2] ?? ''] ?? 'sqs',
      assigned(body, 'name') ?? null,
    );
  for (const { match, body } of blocks(tf, /module\s+"([\w-]+)"\s*\{/g)) {
    const source = assigned(body, 'source') ?? '';
    if (/\b(sqs|sns)\b/i.test(source))
      add(`module.${match[1] ?? ''}`, /\bsns\b/i.test(source) ? 'sns' : 'sqs', assigned(body, 'name') ?? null);
  }
  // A pipe that reads Kafka: its topic is a queue of its own (one per topic when it reads a list of them).
  const pipes = blocks(tf, /resource\s+"(aws_pipes_pipe|awscc_pipes_pipe)"\s+"([\w-]+)"\s*\{/g);
  for (const { match, body } of pipes) {
    const topic = /topic_name\s*=\s*([^\n,}]+)/.exec(body)?.[1]?.trim();
    if (!topic) continue;
    const pick = /^each\.(key|value)$/.exec(topic)?.[1] as 'key' | 'value' | undefined;
    const each = pick ? /toset\(\s*([\w.-]+)\s*\)|^\s*([\w.-]+)\s*$/.exec(assigned(body, 'for_each') ?? '') : null;
    const address = `kafka.${match[2] ?? ''}`;
    add(address, 'kafka', each ? (each[1] ?? each[2] ?? null) : topic);
    const queue = found.get(address);
    // A set's keys and values are the same items.
    if (queue && each && pick) queue.list = each[1] ? 'value' : pick;
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
        else if (type === 'aws_apigatewayv2_integration') queue.fedBy.add('an API Gateway route');
        else {
          // One statement can allow both.
          if (/sqs:SendMessage|sns:Publish|"sqs:\*"/.test(near)) queue.sends = true;
          if (/sqs:ReceiveMessage|"sqs:\*"/.test(near)) queue.reads = true;
        }
      }
  }
  const queueIn = (raw: string | undefined) =>
    raw
      ? [...found.values()].find(queue => refTo(queue.address).test(raw) || raw.includes(`${queue.address}.`))
      : undefined;
  // What a pipe or rule hands its events to that is not a queue: a Lambda or an API destination of this app.
  const endOf = (raw: string | undefined) =>
    /aws_lambda_function\./.test(raw ?? '') ? 'Lambda' : /api_destination/i.test(raw ?? '') ? 'API destination' : null;
  // Queues a pipe, rule or subscription here fills: the right to send to them is that one's, not the app's.
  const filled = new Set<string>();
  const feed = (from: Found | undefined, to: string | undefined, via: FeedVia, other: Feed['to'] | null = null) => {
    if (!from) return;
    const target = queueIn(to);
    const end = endOf(to);
    if (target && target !== from) {
      from.feeds.push({ to: target.address, via });
      filled.add(target.address);
    } else if (other) from.feeds.push({ to: other, via });
    else if (end) {
      from.reads = true;
      from.via = `${via} to ${end}`;
    }
  };
  for (const { match, body } of pipes) {
    const source = found.get(`kafka.${match[2] ?? ''}`) ?? queueIn(assigned(body, 'source'));
    feed(source, assigned(body, 'target'), 'pipe');
  }
  // A rule belongs to a bus; its targets are what the bus feeds.
  const ruleBus = new Map<string, Found | undefined>(
    blocks(tf, /resource\s+"aws_cloudwatch_event_rule"\s+"([\w-]+)"\s*\{/g).map(
      ({ match, body }) =>
        [`aws_cloudwatch_event_rule.${match[1] ?? ''}`, queueIn(assigned(body, 'event_bus_name'))] as const,
    ),
  );
  for (const { body } of blocks(tf, resource('aws_cloudwatch_event_target'))) {
    const rule = /aws_cloudwatch_event_rule\.[\w-]+/.exec(assigned(body, 'rule') ?? '')?.[0];
    const bus = (rule ? ruleBus.get(rule) : undefined) ?? queueIn(assigned(body, 'event_bus_name'));
    const arn = assigned(body, 'arn');
    feed(bus, arn, 'rule', busNamed(arn, tf));
  }
  for (const { body } of blocks(tf, resource('aws_sns_topic_subscription')))
    feed(queueIn(assigned(body, 'topic_arn')), assigned(body, 'endpoint'), 'subscription');
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
  return [...found.values()].map(queue => ({
    ...queue,
    sends: queue.sends && (!filled.has(queue.address) || queue.env.size > 0),
    env: [...queue.env].sort(),
    fedBy: [...queue.fedBy],
  }));
}

const READS_BUCKET = /s3:(Get|List)\w*|s3:\*/;
const WRITES_BUCKET = /s3:(Put|Delete|Abort)\w*|s3:\*/;
const reference = (address: string, fields: string) =>
  new RegExp(`${address.replace(/\./g, '\\.')}(?:\\[[^\\]]*\\])?\\.(?:${fields})\\b`, 'g');

/** The entries of a JSON-like object body, in written order: each `"name": { ... }` with its body. */
function objectEntries(body: string): { name: string; body: string }[] {
  const out: { name: string; body: string }[] = [];
  const head = /^[\s,]*"([^"]+)"\s*[:=]\s*\{/;
  for (let rest = body, match = head.exec(rest); match; match = head.exec(rest)) {
    const [block] = blocks(rest, new RegExp(head.source, 'g'));
    if (!block) break;
    out.push({ name: match[1] ?? '', body: block.body });
    rest = rest.slice(match[0].length + block.body.length + 1);
  }
  return out;
}

/** The steps of a state machine's `jsonencode` definition: from StartAt along each Next, then the rest as written. */
function stepsOf(definition: string): { name: string; body: string }[] {
  const [states] = blocks(definition, /"States"\s*[:=]\s*\{/g);
  if (!states) return [];
  const all = objectEntries(states.body);
  // Its own Next, not one of the states nested in it (a Map's).
  const next = (body: string) => {
    let own = body;
    for (let was = ''; was !== own;) [was, own] = [own, own.replace(/\{[^{}]*\}/g, '')];
    return /"Next"\s*[:=]\s*"([^"]+)"/.exec(own)?.[1];
  };
  const ordered: typeof all = [];
  for (let name = /"StartAt"\s*[:=]\s*"([^"]+)"/.exec(definition)?.[1]; name;) {
    const state = all.find(one => one.name === name);
    if (!state || ordered.includes(state)) break;
    ordered.push(state);
    name = next(state.body);
  }
  // A Fail or Succeed state only ends the run.
  return [...ordered, ...all.filter(one => !ordered.includes(one))].filter(
    one => !/"Type"\s*[:=]\s*"(Fail|Succeed)"/.test(one.body),
  );
}

/**
 * The buckets, API Gateway routes and state machines a Terraform folder declares, and how its app uses each: a
 * bucket's access from the app's own policies, a route's target, a state machine's steps and who starts it.
 */
export function resourceUses(tf: string) {
  const buckets = blocks(tf, /(resource|data)\s+"aws_s3_bucket"\s+"([\w-]+)"\s*\{/g).map(({ match, body }) => ({
    address: `${match[1] === 'data' ? 'data.' : ''}aws_s3_bucket.${match[2] ?? ''}`,
    raw: assigned(body, 'bucket') ?? null,
    reads: false,
    writes: false,
  }));
  const machines = blocks(tf, resource('aws_sfn_state_machine')).flatMap(({ match, body }) => {
    const name = /"([\w-]+)"\s*\{$/.exec(match[0])?.[1];
    if (!name) return [];
    const steps = stepsOf(assigned(body, 'definition') ?? '').map(step => ({
      name: step.name,
      own: /aws_lambda_function\./.test(step.body),
    }));
    return [
      {
        address: `aws_sfn_state_machine.${name}`,
        raw: assigned(body, 'name') ?? null,
        steps,
        startedHere: false,
        scheduled: false,
      },
    ];
  });
  for (const { match, body } of blocks(tf, /(?:resource|data)\s+"([\w-]+)"\s+"[\w-]+"\s*\{/g)) {
    const type = match[1] ?? '';
    // A bucket's own settings and policy say what others may do, not what this app does.
    if (type.startsWith('aws_s3_bucket')) continue;
    for (const bucket of buckets)
      for (const use of body.matchAll(reference(bucket.address, 'arn|id|bucket'))) {
        // Written inside "${...}", the statement is around the interpolation, not inside it.
        const near = around(body, body.slice(0, use.index).endsWith('${') ? use.index - 2 : use.index);
        bucket.reads ||= READS_BUCKET.test(near);
        bucket.writes ||= WRITES_BUCKET.test(near);
      }
    for (const machine of machines)
      for (const use of body.matchAll(reference(machine.address, 'arn|id|name'))) {
        if (type === 'aws_scheduler_schedule' || type === 'aws_cloudwatch_event_target') machine.scheduled = true;
        else if (/states:StartExecution|states:StartSyncExecution|"states:\*"/.test(around(body, use.index)))
          machine.startedHere = true;
      }
  }
  // A bucket another repo declares, named in this app's policies by its ARN.
  // ponytail: a bucket handed in from a parent module (var.bucket.arn) is not followed across folders yet.
  const named = [...tf.matchAll(/"arn:aws:s3:::([^"/*]+)[^"]*"/g)].map(use => ({
    raw: `"${use[1] ?? ''}"`,
    reads: READS_BUCKET.test(around(tf, use.index)),
    writes: WRITES_BUCKET.test(around(tf, use.index)),
  }));
  const apis = new Map(
    blocks(tf, resource('aws_apigatewayv2_api')).map(({ match, body }) => [
      `aws_apigatewayv2_api.${/"([\w-]+)"\s*\{$/.exec(match[0])?.[1] ?? ''}`,
      assigned(body, 'name') ?? null,
    ]),
  );
  const integrations = new Map<string, RouteUse['to'] | null>(
    blocks(tf, resource('aws_apigatewayv2_integration')).map(({ match, body }): [string, RouteUse['to'] | null] => {
      const at = (pattern: RegExp) => pattern.exec(body)?.[0];
      const queue = at(/aws_sqs_queue\.[\w-]+/);
      const machine = at(/aws_sfn_state_machine\.[\w-]+/);
      const to: RouteUse['to'] | null = queue
        ? { queue }
        : machine
          ? { machine }
          : /aws_lambda_function\./.test(body)
            ? { own: true }
            : null;
      return [`aws_apigatewayv2_integration.${/"([\w-]+)"\s*\{$/.exec(match[0])?.[1] ?? ''}`, to];
    }),
  );
  // ponytail: API Gateway v2 only; a REST API (v1) is read once one hands to more than its own Lambda.
  const routes = blocks(tf, resource('aws_apigatewayv2_route')).flatMap(({ body }) => {
    const api = /aws_apigatewayv2_api\.[\w-]+/.exec(assigned(body, 'api_id') ?? '')?.[0];
    const to = integrations.get(/aws_apigatewayv2_integration\.[\w-]+/.exec(assigned(body, 'target') ?? '')?.[0] ?? '');
    const route = /^"([^"$]+|\$default)"$/.exec(assigned(body, 'route_key')?.trim() ?? '')?.[1];
    return api && to && route ? [{ api, apiRaw: apis.get(api) ?? null, route, to }] : [];
  });
  return { buckets, named, routes, machines };
}

/** Another account's bus a rule sends to, by the ARN written for it: `name:<bus>`; a map per environment gives its first. */
function busNamed(raw: string | undefined, tf: string): string | null {
  const local = /^local\.([\w-]+)/.exec(raw?.trim() ?? '')?.[1];
  const written = local
    ? blocks(tf, /(^|\n)\s*locals\s*\{/g)
        .flatMap(block => assignments(block.body))
        .find(([name]) => name === local)?.[1]
    : raw;
  const bus = /event-bus\/([\w.-]+)/.exec(written ?? '')?.[1];
  return bus ? `name:${bus}` : null;
}

/**
 * The names a list or map variable holds, a field of one too (`var.kafka.topics`): a list's items, a map's keys or
 * values. Written in a .tfvars file or a .tfvars.json one; commented-out items are left out.
 */
const namesIn = (raw: string | null | undefined, context: Context, pick: 'key' | 'value'): string[] => {
  const [, name = '', path = ''] = /^var\.([\w-]+)((?:\.[\w-]+)*)$/.exec(raw?.trim() ?? '') ?? [];
  const fields = path.split('.').filter(Boolean);
  const written = name ? context.vars[name] : raw;
  try {
    const value = fields.reduce<unknown>(
      (at, field) => (at && typeof at === 'object' ? (at as Record<string, unknown>)[field] : undefined),
      JSON.parse(written ?? ''),
    );
    const items = Array.isArray(value)
      ? value
      : value && typeof value === 'object'
        ? pick === 'key'
          ? Object.keys(value)
          : Object.values(value)
        : [];
    return items.filter((item): item is string => typeof item === 'string');
  } catch {
    // Written as Terraform, not JSON.
  }
  let text = (written ?? '').replace(/(\/\/|#)[^\n]*/g, '');
  for (const field of fields)
    text =
      assignments(text.slice(text.indexOf('{') + 1, text.lastIndexOf('}'))).find(([key]) => key === field)?.[1] ?? '';
  if (text.trim().startsWith('{'))
    return assignments(text.slice(text.indexOf('{') + 1, text.lastIndexOf('}')))
      .map(([key, value]) => (pick === 'key' ? key : value.replace(/^"|"$/g, '')))
      .filter(Boolean);
  return [...text.matchAll(/"([^"\n]+)"/g)].map(match => match[1] ?? '');
};

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
  const varsOf = (file: { name: string; text: string }): Record<string, string> => {
    if (!file.name.endsWith('.json')) return Object.fromEntries(assignments(file.text));
    try {
      return Object.fromEntries(
        Object.entries(JSON.parse(file.text) as Record<string, unknown>).map(([key, value]) => [
          key,
          JSON.stringify(value),
        ]),
      );
    } catch {
      return {};
    }
  };
  const varFiles = files
    .filter(file => /\.tfvars(\.json)?$/.test(file.name))
    .map(file => ({ token: tokenIn(file.name.replace(/\.json$/, '')), vars: varsOf(file) }));
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
  const resources = resourceUses(tf);
  // Only a variable that names the account, with a value that reads as an id or a name: never a key or a token.
  const accountOf = (context: Context) =>
    Object.entries(context.vars)
      .filter(([key]) => /^(aws_)?account(_?(id|name|alias))?$/i.test(key))
      .map(([, raw]) => named(raw, context))
      .find(value => value !== null && /^[\w.-]{1,64}$/.test(value)) ?? null;
  return contexts.map(context => ({
    token: context.token,
    queues: queues
      .flatMap(queue =>
        queue.list
          ? namesIn(queue.raw, context, queue.list).map(name => ({
              ...queue,
              address: `${queue.address}["${name}"]`,
              name,
            }))
          : [{ ...queue, name: named(queue.raw, context) }],
      )
      .filter(queue => !DEAD_LETTER.test(queue.name ?? '')),
    buckets: [
      ...resources.buckets.map(({ raw, ...bucket }) => ({ ...bucket, name: named(raw, context) })),
      ...resources.named.flatMap(({ raw, reads, writes }) => {
        const name = named(raw, context);
        return name ? [{ address: `name:${name}`, name, reads, writes }] : [];
      }),
    ]
      // The same bucket twice is one.
      .filter(bucket => bucket.reads || bucket.writes)
      .filter(
        (bucket, at, all) =>
          all.findIndex(other => (other.name ?? other.address) === (bucket.name ?? bucket.address)) === at,
      ),
    routes: resources.routes.map(({ apiRaw, ...route }) => ({ ...route, apiName: named(apiRaw, context) })),
    machines: resources.machines.map(({ raw, ...machine }) => ({ ...machine, name: named(raw, context) })),
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
