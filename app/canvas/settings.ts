// The settings panels: how a field of the stack is shown, read from the stack's own schema, so every field is there.

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
  protected: 'Protected environments',
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
