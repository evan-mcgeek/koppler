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
import { hostsByApp } from './calls.ts';
import { writeJson } from '../json-files.ts';
import { appOn } from '../core/stack.ts';
import {
  type Call,
  type Domain,
  ENV_TOKEN,
  type EnvStack,
  type FeedVia,
  hostOf,
  type Module,
  type NamedQueue,
  readModule,
  samDomains,
  type SecretName,
  type Setting,
  stackEnv,
  tokenIn,
} from '../core/terraform.ts';

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
  /** The queues, topics and buses it feeds, by their ids, and how. */
  feeds: Record<string, FeedVia>;
  /** Per app that reads it not by itself, how: a pipe or rule to a Lambda or an API destination. */
  via: Record<string, string>;
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
      const via = queue.via ?? had?.via;
      into.queues.set(key, {
        type: queue.type,
        name: queue.name,
        address: queue.address,
        reads: had?.reads || queue.reads,
        sends: had?.sends || queue.sends,
        env: union(had?.env, queue.env).sort(),
        fedBy: union(had?.fedBy, queue.fedBy),
        // What it feeds, by name: a queue of this module by its own name (`@<address>` when it has none), or another's bus.
        feeds: [
          ...(had?.feeds ?? []),
          ...queue.feeds.map(({ to, via }) => {
            const target = to.startsWith('name:') ? null : module.queues.find(other => other.address === to);
            return { to: to.startsWith('name:') ? to.slice(5) : (target?.name ?? `@${to}`), via };
          }),
        ],
        ...(via ? { via } : {}),
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
          // A queue read with its name and again from a context that could not name it is the one queue.
          queues: [...found.queues.values()].filter(
            (queue, _, all) => queue.name || !all.some(other => other.name && other.address === queue.address),
          ),
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
    /** Feeds by the key of what it feeds; that key is resolved to an entry once all are read. */
    feeds: Map<string, FeedVia>;
    via: Map<string, string>;
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
      feeds: new Map(),
      via: new Map(),
    };
    const user = entry.users.get(app) ?? { reads: false, sends: false, env: new Set<string>() };
    entry.users.set(app, {
      reads: user.reads || queue.reads,
      sends: user.sends || queue.sends,
      env: new Set([...user.env, ...queue.env]),
    });
    for (const feeder of queue.fedBy) entry.fedBy.add(feeder);
    for (const { to, via } of queue.feeds) entry.feeds.set(to.startsWith('@') ? `${app}:${to.slice(1)}` : to, via);
    if (queue.via) entry.via.set(app, queue.via);
    byName.set(key, entry);
  }
  // The same queue's name in the other environments, from the app that declares it.
  for (const { app, env, queue } of all) {
    if (env === first) continue;
    const name = drafts[app]?.[first]?.queues?.find(other => other.address === queue.address)?.name;
    const entry = name ? byName.get(name) : undefined;
    if (entry && queue.name && queue.name !== name) entry.envs[env] = queue.name;
  }
  // What a queue feeds is found by its name, or by the same name for another environment (`bus_dev` for `bus_qa`); a bus
  // only named, in another account, gets an entry of its own.
  const fed = new Set<Entry>();
  const target = new Map<Entry, Map<Entry, FeedVia>>();
  for (const entry of [...byName.values()]) {
    const out = new Map<Entry, FeedVia>();
    for (const [key, via] of entry.feeds) {
      // An unnamed one (its name built at deploy time) is matched by its Terraform resource name.
      const same = (other: Entry) => queueId(other.queue ?? other.address.split('.').pop() ?? '') === queueId(key);
      let to = byName.get(key) ?? [...byName.values()].find(same);
      if (!to) {
        to = {
          queue: key,
          address: key,
          type: 'eventbridge',
          users: new Map(),
          fedBy: new Set(),
          envs: {},
          feeds: new Map(),
          via: new Map(),
        };
        byName.set(key, to);
      }
      if (to === entry) continue;
      out.set(to, via);
      fed.add(to);
    }
    target.set(entry, out);
  }
  // A queue or topic no app sends to or reads, and nothing feeds (an alarm topic, a spare dead-letter queue), is not a link.
  const used = (user: User) => user.reads || user.sends || user.env.size > 0;
  const idOf = (entry: Entry) => {
    const owner = [...entry.users.keys()][0] ?? '';
    const resourceName = (entry.address.split('.').pop() ?? '').replace(/_/g, '-');
    return entry.queue ? queueId(entry.queue) : `${owner}-${resourceName}`;
  };
  return [...byName.values()]
    .filter(
      entry => entry.fedBy.size || fed.has(entry) || target.get(entry)?.size || [...entry.users.values()].some(used),
    )
    .map(entry => {
      const users = [...entry.users];
      const owner = users[0]?.[0] ?? '';
      const reads = users.filter(([, user]) => user.reads).map(([app]) => app);
      // An app that only carries the address and neither sends nor reads by itself is taken to send.
      const sends = users.filter(([, user]) => user.sends || (!user.reads && user.env.size)).map(([app]) => app);
      // Internal: one app both sends and reads, and nothing outside feeds it. One side unknown is a link still to find.
      const feeds = target.get(entry) ?? new Map<Entry, FeedVia>();
      const linked = feeds.size || fed.has(entry);
      const internal = users.length === 1 && !entry.fedBy.size && !linked && reads.length && sends.length;
      return {
        id: idOf(entry),
        feeds: Object.fromEntries([...feeds].map(([to, via]) => [idOf(to), via])),
        via: Object.fromEntries(entry.via),
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
    apps: Record<string, Partial<Record<'publishes' | 'reads', Record<string, { env?: string[]; via?: string }>>>>;
    /** What queues the stack has already feed, for `queues.<id>.feeds`. */
    feeds: Record<string, Record<string, { via: FeedVia }>>;
  } = { queues: {}, apps: {}, feeds: {} };
  const feedsOf = (queue: LinkedQueue) =>
    Object.fromEntries(Object.entries(queue.feeds).map(([to, via]) => [to, { via }]));
  for (const queue of queues) {
    if (queue.inside) continue;
    if (inStack(queue, stack)) {
      if (Object.keys(queue.feeds).length) out.feeds[queue.id] = feedsOf(queue);
      continue;
    }
    const perEnv = Object.entries(queue.envs).map(([env, name]) => [env, { queue: name }]);
    out.queues[queue.id] = {
      name: titled(queue.id),
      type: queue.type,
      ...(queue.queue && { queue: queue.queue }),
      ...(perEnv.length && { envs: Object.fromEntries(perEnv) as object }),
      ...(queue.fedBy.length && { note: `Fed by ${queue.fedBy.join(' and ')}` }),
      ...(Object.keys(queue.feeds).length && { feeds: feedsOf(queue) }),
    };
    for (const [key, apps] of [
      ['publishes', queue.sends],
      ['reads', queue.reads],
    ] as const)
      for (const app of apps) {
        const env = queue.env[app];
        const via = key === 'reads' ? queue.via[app] : undefined;
        ((out.apps[app] ??= {})[key] ??= {})[queue.id] = { ...(env?.length && { env }), ...(via && { via }) };
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
