// The settings panels: how a field of the stack is shown, read from the stack's own schema, so every field is there.
import type { LucideProps } from '@lucide/svelte';
import ArrowLeftRight from '@lucide/svelte/icons/arrow-left-right';
import CircleQuestionMark from '@lucide/svelte/icons/circle-question-mark';
import Cloud from '@lucide/svelte/icons/cloud';
import KeyRound from '@lucide/svelte/icons/key-round';
import Laptop from '@lucide/svelte/icons/laptop';
import LogIn from '@lucide/svelte/icons/log-in';
import Package from '@lucide/svelte/icons/package';
import ShieldCheck from '@lucide/svelte/icons/shield-check';
import type { Component } from 'svelte';

/** A part of the stack's JSON schema, as the server hands it over. */
export interface Schema {
  type?: string | string[];
  description?: string;
  properties?: Record<string, Schema>;
  additionalProperties?: Schema | boolean;
  items?: Schema;
  anyOf?: Schema[];
  enum?: unknown[];
  required?: string[];
}
/** What a field asks of the panel it is in. */
export interface Ctx {
  /** Keeps the value at the path, or takes it out when undefined; gives why it was refused, or null. */
  save: (path: string, value: unknown) => Promise<string | null>;
  locked: (path: string) => boolean;
  lock: (path: string, on: boolean) => void;
  /** The keys a table can take, when they come from the stack (apps, environments, queues); null for any. */
  keys: (path: string) => string[] | null;
  /** What the last Save found wrong right here, if anything. */
  problem?: (path: string) => string | undefined;
  /** What a field is picked from, when Koppler knows: apps, sign-ins, AWS profiles, what the clone holds. */
  options: (path: string) => Choice | null;
  /** The stack as the panel has it now. */
  stack: () => unknown;
  /** Set where a new item is being filled in: nothing of it can be locked or taken out yet. */
  fresh?: true;
}
/** One thing to pick, by its value and its words. */
export interface Option {
  value: string;
  label: string;
  /** An app kind, shown by its icon. */
  kind?: string;
}
export interface Choice {
  options: Option[];
  /** Whether a value that is not listed can be typed. */
  other?: boolean;
}

export type Kind = 'text' | 'number' | 'switch' | 'choice' | 'group' | 'table' | 'list' | 'json';

const types = (schema: Schema) => [schema.type ?? []].flat();

/** How a field is edited: by its schema, and for a field that can be several things, by what it holds now. */
export function kindOf(schema: Schema, value: unknown): Kind {
  if (schema.enum) return 'choice';
  if (schema.anyOf)
    return (value === undefined || typeof value === 'string') && schema.anyOf.some(one => types(one).includes('string'))
      ? 'text'
      : 'json';
  const type = types(schema);
  if (type.includes('string')) return 'text';
  if (type.includes('integer') || type.includes('number')) return 'number';
  if (type.includes('boolean')) return 'switch';
  if (type.includes('array')) return schema.items ? 'list' : 'json';
  if (type.includes('object'))
    return schema.properties ? 'group' : typeof schema.additionalProperties === 'object' ? 'table' : 'json';
  return 'json';
}

/** A new, empty item for a list or a table. */
export function emptyFor(schema: Schema | boolean | undefined): unknown {
  if (typeof schema !== 'object') return {};
  const type = types(schema);
  if (type.includes('array')) return [];
  if (type.includes('string') || schema.anyOf) return '';
  if (type.includes('object') || !type.length) return {};
  return '';
}

/** Whether an item needs fields filled in before it can be kept. */
export const needsFields = (schema: Schema | undefined) => !!schema?.required?.length;

const PLAIN = /^[A-Za-z0-9_][\w-]*$/;
export const child = (path: string, key: string | number) =>
  typeof key === 'number'
    ? `${path}[${String(key)}]`
    : PLAIN.test(key)
      ? path
        ? `${path}.${key}`
        : key
      : `${path}["${key}"]`;

/** What the stack's fields are called on screen, where their key does not say it. */
const NAMES: Record<string, string> = {
  prereqs: 'Needs first',
  consumes: 'Calls',
  publishes: 'Sends to queues',
  reads: 'Reads from queues',
  envs: 'Per environment',
  localChanges: 'Code changes for local runs',
  signIns: 'Sign-ins',
  envAliases: 'Other names for environments',
  how: 'Finds it by',
  env: 'Setting',
  sso: 'AWS profile',
  signIn: 'Sign-in',
  hosts: 'Host name',
  tunnel: 'Host',
  connectsAs: 'Dials it as',
  cmd: 'Command',
  what: 'What it is',
  found: 'Seen in',
  deployed: 'Deployed address',
  fetch: 'How to get it',
  cli: 'Command',
  ui: 'By hand',
  devCerts: 'HTTPS certificate',
  nuget: 'Private package feed',
  defineFile: 'Dart define file',
};
/** A list item by what it holds (its tunnel, profile, setting or file), else by its place. */
export function itemName(item: unknown, fallback: string): string {
  if (typeof item === 'string' && item) return item;
  if (typeof item !== 'object' || item === null) return fallback;
  const fields = item as Record<string, unknown>;
  const found = ['what', 'name', 'tunnel', 'sso', 'signIn', 'hosts', 'env', 'file'].map(key => fields[key]);
  const named = found.find(one => typeof one === 'string' && one);
  return typeof named === 'string' ? named : fallback;
}

/** The stack's own fields, where the same key means something else on an app. */
const STACK_NAMES: Record<string, string> = {
  envs: 'Environments',
  protected: 'Protected',
  presets: 'Team boards',
  checks: 'Checks on this Mac',
};
/** A field's name in words: deployedUrl reads "Deployed URL". At the top of the stack, `top` is true. */
export function label(key: string, top = false): string {
  if (top && Object.hasOwn(STACK_NAMES, key)) return STACK_NAMES[key] ?? key;
  if (Object.hasOwn(NAMES, key)) return NAMES[key] ?? key;
  const words = key.replace(/([a-z0-9])([A-Z])/g, '$1 $2').toLowerCase();
  const said = words.replace(/\b(url|sso|id|ios|aws|cors|sam)\b/g, word =>
    word === 'ios' ? 'iOS' : word.toUpperCase(),
  );
  return said.charAt(0).toUpperCase() + said.slice(1);
}

/** Locked here, or inside a group that is. */
export const lockedBy = (locks: string[], path: string) =>
  locks.some(lock => path === lock || path.startsWith(`${lock}.`) || path.startsWith(`${lock}[`));

/** A tab of a settings panel: the fields it holds, by key, and how it is shown. */
export interface Tab {
  name: string;
  keys: string[];
  /** A view of its own: what each environment uses, or the stack's apps. */
  view?: 'envs' | 'apps';
}
/** An app's settings: what it is, above the tabs; then how it runs here, where it is deployed, and the rest. */
export const APP_HEAD = ['name', 'kind', 'slug'];
/** The fields for how one kind of app starts; an app is shown its own kind's, the others are a click away. */
export const BY_KIND: Record<string, string[]> = {
  dotnet: ['project', 'launchSettings', 'baseProfile'],
  node: ['script'],
  web: ['script'],
  flutter: ['flutter', 'mobile'],
  lambda: ['lambda', 'sam'],
};
export const KIND_FIELDS = [...new Set(Object.values(BY_KIND).flat())];
export const APP_TABS: Tab[] = [
  {
    name: 'Runs here',
    keys: [
      'start',
      'url',
      'ready',
      'project',
      'launchSettings',
      'baseProfile',
      'script',
      'flutter',
      'mobile',
      'lambda',
      'sam',
      'localChanges',
    ],
  },
  { name: 'Deployed', keys: ['deployedUrl', 'cors', 'outside'] },
  { name: 'Calls', keys: ['consumes', 'publishes', 'reads'] },
  { name: 'Needs first', keys: ['prereqs'] },
  { name: 'Secrets', keys: ['secrets'] },
  { name: 'Environments', keys: ['envs'], view: 'envs' },
];
/** An outside system never runs here: only where it is, what it calls, and per environment. */
export const OUTSIDE_TABS: Tab[] = [
  { name: 'Deployed', keys: ['outside', 'deployedUrl'] },
  { name: 'Calls', keys: ['consumes'] },
  { name: 'Environments', keys: ['envs'], view: 'envs' },
];
export const STACK_HEAD = ['name'];
export const STACK_TABS: Tab[] = [
  { name: 'Environments', keys: ['envs', 'protected', 'envAliases'] },
  { name: 'Apps', keys: ['apps'], view: 'apps' },
  { name: 'Queues', keys: ['queues'] },
  { name: 'Sign-ins', keys: ['signIns'] },
  { name: 'Checks', keys: ['checks'] },
  { name: 'Kinds', keys: ['kinds'] },
  { name: 'Team boards', keys: ['presets'] },
];
/** The fields an environment of an app most often uses its own value for; any other can be added. */
export const ENV_FIELDS = ['deployedUrl', 'start', 'prereqs', 'secrets'];

/** Problems the stack check found, by the place each is about: "apps.orders.kind: required". */
export function problemsByPath(problems: string[]): Map<string, string> {
  const found = new Map<string, string>();
  for (const problem of problems) {
    const at = problem.indexOf(': ');
    if (at > 0) found.set(problem.slice(0, at), problem.slice(at + 2));
  }
  return found;
}
/** Whether a place is this path or lies inside it. */
export const within = (place: string, path: string) =>
  !path || place === path || place.startsWith(`${path}.`) || place.startsWith(`${path}[`);

/** A value in a few words, for what an environment takes from the first one. */
export function summary(value: unknown): string {
  if (value === undefined) return 'not set';
  if (typeof value === 'string') return value;
  if (Array.isArray(value))
    return value.length ? value.map((item, at) => itemName(item, `#${String(at + 1)}`)).join(', ') : 'none';
  if (typeof value === 'object' && value !== null) return Object.keys(value).join(', ') || 'empty';
  return JSON.stringify(value);
}

/** How many fields differ between two stacks: each value that changed, was added or was taken out counts once. */
export function changes(a: unknown, b: unknown): number {
  const isTree = (one: unknown) => typeof one === 'object' && one !== null;
  if (!isTree(a) || !isTree(b) || Array.isArray(a) !== Array.isArray(b))
    return JSON.stringify(a) === JSON.stringify(b) ? 0 : 1;
  const left = a as Record<string, unknown>;
  const right = b as Record<string, unknown>;
  return [...new Set([...Object.keys(left), ...Object.keys(right)])].reduce(
    (sum, key) => sum + changes(left[key], right[key]),
    0,
  );
}

type Fields = Record<string, unknown>;
const fieldsOf = (value: unknown): Fields =>
  typeof value === 'object' && value !== null && !Array.isArray(value) ? (value as Fields) : {};
const said = (value: unknown) => (typeof value === 'string' || typeof value === 'number' ? String(value) : '');

const ICON = {
  tunnel: ArrowLeftRight,
  cloud: Cloud,
  laptop: Laptop,
  signIn: LogIn,
  shield: ShieldCheck,
  box: Package,
  key: KeyRound,
  other: CircleQuestionMark,
};
/** A drawn icon, from the icon library. */
export type IconOf = Component<LucideProps>;

/** A row of a list, said in a sentence: what it is, and only its own fields when it is opened. */
export interface Row {
  /** What it is: Tunnel, or the app it calls. */
  label: string;
  /** The rest of the sentence. */
  say: string;
  icon?: IconOf;
  /** An app kind, for its icon. */
  kind?: string;
  /** The fields shown when it is opened; any other it holds comes after them. */
  fields: string[];
  /** Fields the row itself stands for, so never shown as one. */
  own?: string[];
  /** Its fields sit on one line, each after its words. */
  inline?: Record<string, string>;
}

/** What an app can need before it runs, each with the fields of its own. */
export interface NeedType {
  id: string;
  label: string;
  about: string;
  icon: IconOf;
  fields: string[];
  /** What a new one starts with. */
  start: Fields;
  own?: string[];
  say: (need: Fields, stack: Fields) => string;
}
export const NEEDS: NeedType[] = [
  {
    id: 'tunnel',
    label: 'Tunnel',
    about: 'A database or service reached through a tunnel',
    icon: ICON.tunnel,
    fields: ['tunnel', 'port', 'env', 'what', 'connectsAs', 'cmd', 'note'],
    start: {},
    say: need => {
      const where = [said(need['tunnel']), said(need['port'])].filter(Boolean).join(':');
      const what = said(need['what']);
      const as = said(need['env']);
      return `${what && where ? `${what}, ` : what}${where}${as ? ` as ${as}` : ''}`;
    },
  },
  {
    id: 'sso',
    label: 'AWS sign-in',
    about: 'An AWS profile to be signed in with',
    icon: ICON.cloud,
    fields: ['sso', 'account', 'note'],
    start: {},
    say: need => `${said(need['sso'])}${need['account'] ? `, account ${said(need['account'])}` : ''}`,
  },
  {
    id: 'hosts',
    label: 'Hosts entry',
    about: 'A name that has to lead to this Mac',
    icon: ICON.laptop,
    fields: ['hosts', 'note'],
    start: {},
    say: need => (need['hosts'] ? `${said(need['hosts'])} leads to this Mac` : ''),
  },
  {
    id: 'signIn',
    label: 'Stack sign-in',
    about: 'A sign-in this stack defines',
    icon: ICON.signIn,
    fields: ['signIn', 'note'],
    start: {},
    say: (need, stack) => {
      const name = said(need['signIn']);
      const what = said(fieldsOf(fieldsOf(stack['signIns'])[name])['what']);
      return what && what !== name ? `${name}, ${what}` : name;
    },
  },
  {
    id: 'devCerts',
    label: 'HTTPS certificate',
    about: 'It serves https here, so its certificate must be trusted',
    icon: ICON.shield,
    fields: ['note'],
    own: ['devCerts'],
    start: { devCerts: true },
    say: need => said(need['note']) || 'The local certificate must be trusted',
  },
  {
    id: 'nuget',
    label: 'Private package feed',
    about: 'It downloads company packages while it builds',
    icon: ICON.box,
    fields: ['note'],
    own: ['nuget'],
    start: { nuget: true },
    say: need => said(need['note']) || 'Packages come from a private feed',
  },
];
const needTypeOf = (need: Fields, as?: string) =>
  NEEDS.find(type => (as ? type.id === as : need[type.id] !== undefined && need[type.id] !== false));

/** How an app finds the one it calls, in words. */
export const HOWS: Option[] = [
  { value: 'env', label: 'A setting' },
  { value: 'env-file', label: 'A line in a settings file' },
  { value: 'edit', label: 'An edit to its code' },
  { value: 'secret', label: 'A key in its Lambda secret' },
  { value: 'unknown', label: 'Not known yet' },
];
const CALL_FIELDS: Record<string, string[]> = {
  env: ['how', 'env', 'path', 'value', 'deployed', 'note'],
  'env-file': ['how', 'file', 'key', 'path', 'value', 'deployed', 'note'],
  edit: ['how', 'file', 'key', 'value', 'deployed', 'note'],
  secret: ['how', 'key', 'path', 'deployed', 'note'],
  unknown: ['how', 'found', 'deployed', 'note'],
};
const callSaid = (call: Fields) => {
  const names = [call['env'] ?? []].flat().map(said).filter(Boolean).join(', ');
  const file = said(call['file']);
  if (call['how'] === 'env') return names ? `found by the setting ${names}` : 'found by a setting, not named yet';
  if (call['how'] === 'env-file') return `found by ${said(call['key']) || 'a line'} in ${file || 'a settings file'}`;
  if (call['how'] === 'edit') return `found by an edit to ${file || 'its code'}`;
  if (call['how'] === 'secret') return `found by ${said(call['key']) || 'a key'} in its secret`;
  return 'how it finds it is not known yet';
};

const TAIL =
  /(?:^|\.)(prereqs|secrets|localChanges)\[\d+\]$|(?:^|\.)(consumes)(?:\.[\w-]+|\["[^"]+"\])$|(?:^|\.)(ready)$/;
/** The lists whose items are rows. */
export const ROW_LISTS = /(?:^|\.)(prereqs|secrets|localChanges|consumes)$/;
/** How the item at a path is shown as a row, when it is one. `as` names the type of a need that is still empty. */
export function rowOf(path: string, value: unknown, stack: unknown, as?: string): Row | undefined {
  const found = TAIL.exec(path);
  const what = found?.[1] ?? found?.[2] ?? found?.[3];
  if (!what) return undefined;
  const item = fieldsOf(value);
  const all = fieldsOf(stack);
  if (what === 'prereqs') {
    const type = needTypeOf(item, as);
    if (!type) return { label: 'Something else', say: summary(value), icon: ICON.other, fields: Object.keys(item) };
    const { label, icon, fields, own } = type;
    return { label, icon, fields, say: type.say(item, all), ...(own && { own }) };
  }
  if (what === 'secrets') {
    const type = said(item['type']);
    const when = said(item['when']);
    return {
      label: said(item['env']) || said(item['file']) || 'Secret',
      say: [type && label(type), when && `needed ${when}`].filter(Boolean).join(', '),
      icon: ICON.key,
      fields: ['env', 'type', 'file', 'when', 'fetch', 'note'],
    };
  }
  if (what === 'localChanges')
    return {
      label: said(item['file']) || 'Change',
      say: '',
      fields: ['file', 'find', 'replace'],
      inline: { file: 'In', find: 'find', replace: 'and put' },
    };
  if (what === 'ready')
    return {
      label: 'Ready',
      say: '',
      fields: ['path', 'status', 'timeout'],
      inline: { path: 'when GET', status: 'answers', timeout: 'within' },
    };
  const id = /(?:\.([\w-]+)|\["([^"]+)"\])$/.exec(path)?.slice(1).find(Boolean) ?? '';
  const callee = fieldsOf(fieldsOf(all['apps'])[id]);
  const how = said(item['how']);
  return {
    label: said(callee['name']) || id,
    say: callSaid(item),
    kind: said(callee['kind']) || 'other',
    fields: (Object.hasOwn(CALL_FIELDS, how) ? CALL_FIELDS[how] : undefined) ?? CALL_FIELDS['unknown'] ?? [],
  };
}

/** What to show in an inline field before anything is typed. */
export const EXAMPLES: Record<string, string> = {
  path: '/health',
  status: '200',
  timeout: '30 s',
  file: 'src/config.ts',
  find: 'the text as it is',
  replace: 'the text for local runs',
};

/** What an address is missing, or what it says about where the app answers. */
export function addressNote(value: unknown): { warn?: string; note?: string } {
  if (typeof value !== 'string' || !value) return {};
  if (!/^[a-z][a-z0-9+.-]*:\/\//i.test(value)) return { warn: 'Start it with http:// or https://' };
  try {
    const url = new URL(value);
    const local = ['localhost', '127.0.0.1', '[::1]'].includes(url.hostname);
    return local && url.port ? { note: `Answers on port ${url.port} of this Mac` } : {};
  } catch {
    return { warn: 'Not an address a browser could open' };
  }
}

/** A dedicated control for the field at a path, where its schema alone would give a plain box. */
export type Control = 'kind' | 'pick' | 'address' | 'chips' | 'ordered' | 'envs' | 'queues';
export function controlOf(path: string, schema: Schema, value: unknown, choice: Choice | null): Control | undefined {
  if (path === 'envs') return 'ordered';
  if (path === 'protected') return 'envs';
  if (/(?:^|\.)(publishes|reads)$/.test(path)) return 'queues';
  if (choice) return /(?:^|\.)kind$/.test(path) ? 'kind' : 'pick';
  if (/(?:^|\.)(url|deployedUrl|deployed)$/.test(path)) return 'address';
  const strings = (one: Schema) => types(one).includes('array') && types(one.items ?? {}).includes('string');
  if (strings(schema) || (Array.isArray(value) && schema.anyOf?.some(strings))) return 'chips';
  return undefined;
}

/** What a list of rows says while it holds none. */
export const EMPTY: Record<string, string> = {
  prereqs: 'Nothing has to be in place before it runs.',
  secrets: 'It needs no secrets.',
  localChanges: 'No code is changed for a local run.',
  consumes: 'No calls are recorded yet, which is not the same as calling nothing.',
};
