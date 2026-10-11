// Presets (saved boards): bringing one saved in an older format up to date, and checking it against the stack before
// it opens.
import type { Edge } from './plan.ts';

export const VERSION = 1;

type Loose = Record<string, unknown>;
const isObject = (value: unknown): value is Loose =>
  typeof value === 'object' && value !== null && !Array.isArray(value);

/** A preset as it is stored: read from a file, a link or the stack, so only its outline is certain. */
export interface StoredPreset extends Loose {
  name: string;
  version?: number;
  nodes: Record<string, Loose>;
  edges: unknown[];
}
/** One step per format version: MIGRATIONS[n] turns a version n preset into version n + 1. */
export const MIGRATIONS: Record<number, (preset: StoredPreset) => StoredPreset> = {
  // Version 0 had no version field; cables and how an app runs could be left out.
  0: preset => ({
    ...preset,
    nodes: Object.fromEntries(Object.entries(preset.nodes).map(([id, node]) => [id, { run: 'cli', ...node }])),
  }),
};

export type Migrated =
  | { preset: StoredPreset; migratedFrom: number | null; error?: undefined }
  | { error: string; preset?: undefined; migratedFrom?: undefined };

/** The preset in the current format, or the reason it cannot be read. */
export function migrate(input: unknown): Migrated {
  if (!isObject(input)) return { error: 'It is not a preset.' };
  const { name, nodes, edges, version } = input;
  if (typeof name !== 'string' || !name.trim()) return { error: 'It has no name.' };
  if (!isObject(nodes) || Object.keys(nodes).length === 0) return { error: 'It has no apps.' };
  const from = typeof version === 'number' && Number.isInteger(version) && version >= 0 ? version : 0;
  if (from > VERSION) {
    const formats = `preset format ${String(from)}, this one reads up to ${String(VERSION)}`;
    return { error: `It was saved by a newer Koppler (${formats}). Update Koppler.` };
  }
  // Whatever wrote it: every app is an object and the cables are a list.
  let preset: StoredPreset = {
    ...input,
    name,
    nodes: Object.fromEntries(Object.entries(nodes).map(([id, node]) => [id, isObject(node) ? node : {}])),
    edges: Array.isArray(edges) ? edges : [],
  };
  for (let v = from; v < VERSION; v++) preset = { ...(MIGRATIONS[v]?.(preset) ?? preset), version: v + 1 };
  return { preset, migratedFrom: from < VERSION ? from : null };
}

/** What a preset is checked against: this stack's apps, the clones on this machine and their branches. */
export interface StackFacts {
  known: (id: string) => boolean;
  cloned: (id: string) => boolean;
  /** Where the app can be started, the preferred way first. */
  runIn: (id: string) => string[];
  /** The devices a mobile app can run on; empty for everything else. */
  platforms: (id: string) => string[];
  canCall: (from: string, to: string) => boolean;
  /** The clone's branches, or null when they are not known. */
  branches: (id: string) => string[] | null;
  name?: (id: string) => string;
}

export interface OpenedNode {
  run: string;
  platform?: string;
  branch?: string;
  note?: string;
  tunnels?: false;
  queues?: false;
}
export interface OpenedPreset {
  name: string;
  version: number;
  nodes: Record<string, OpenedNode>;
  edges: Edge[];
  source?: unknown;
}
export type Checked =
  | { preset: OpenedPreset; notes: string[]; error?: undefined }
  | { error: string; preset?: undefined; notes?: undefined };

/** One app of a preset as this stack can run it, with a note for each thing that had to change. */
function openNode(id: string, stored: Loose, stack: StackFacts, name: string, notes: string[]): OpenedNode {
  const runs = stack.runIn(id);
  const platforms = stack.platforms(id);
  const asked = typeof stored['run'] === 'string' ? stored['run'] : '';
  const run = runs.includes(asked) ? asked : runs.includes('cli') ? 'cli' : (runs[0] ?? 'cli');
  if (asked && run !== asked) notes.push(`${name} cannot run in "${asked}", using ${run}`);
  const node: OpenedNode = { run };
  const platform = typeof stored['platform'] === 'string' ? stored['platform'] : '';
  const first = platforms[0];
  if (first !== undefined && run === 'cli') {
    node.platform = platforms.includes(platform) ? platform : first;
    if (platform && node.platform !== platform)
      notes.push(`${name} has no "${platform}" platform, using ${node.platform}`);
  }
  const branch = typeof stored['branch'] === 'string' ? stored['branch'].trim() : '';
  if (branch) {
    node.branch = branch;
    const branches = stack.branches(id);
    if (branches && !branches.includes(branch))
      notes.push(`${name} has no branch ${branch} in your clone (fetch it first)`);
  }
  if (typeof stored['note'] === 'string' && stored['note'].trim()) node.note = stored['note'];
  if (stored['tunnels'] === false) node.tunnels = false;
  if (stored['queues'] === false) node.queues = false;
  return node;
}

const isEdge = (value: unknown): value is Edge =>
  isObject(value) && typeof value['from'] === 'string' && typeof value['to'] === 'string';

/**
 * Checks a preset against the stack. Gives the preset as it will open, with only what the stack can run and a note on
 * everything that changed, or the reason it cannot open.
 */
export function check(input: unknown, stack: StackFacts): Checked {
  const migrated = migrate(input);
  if (migrated.error !== undefined) return { error: migrated.error };
  const preset = migrated.preset;
  const notes: string[] = [];
  const name = (id: string) => stack.name?.(id) ?? id;
  if (!isObject(input) || !Number.isInteger(input['version']))
    notes.push('it had no version, read as the oldest format');

  const all = Object.keys(preset.nodes);
  const unknown = all.filter(id => !stack.known(id));
  const uncloned = all.filter(id => stack.known(id) && !stack.cloned(id));
  const ids = all.filter(id => stack.known(id) && stack.cloned(id));
  if (ids.length === 0)
    return {
      error:
        unknown.length === all.length
          ? `None of its apps are in this stack (${unknown.join(', ')}).`
          : `None of its apps are cloned here (${uncloned.join(', ')}).`,
    };
  if (unknown.length > 0) notes.push(`not in this stack: ${unknown.join(', ')}`);
  if (uncloned.length > 0) notes.push(`not cloned: ${uncloned.map(name).join(', ')}`);

  const nodes = Object.fromEntries(ids.map(id => [id, openNode(id, preset.nodes[id] ?? {}, stack, name(id), notes)]));
  const edges: Edge[] = [];
  let dropped = 0;
  for (const edge of preset.edges.filter(isEdge)) {
    const { from, to } = edge;
    if (!Object.hasOwn(nodes, from) || !Object.hasOwn(nodes, to)) {
      if (stack.known(from) && stack.known(to)) dropped++;
    } else if (edges.some(e => e.from === from && e.to === to)) {
      // The same cable twice is one cable.
    } else if (!stack.canCall(from, to)) notes.push(`${name(from)} does not call ${name(to)}, cable left out`);
    else edges.push({ from, to });
  }
  if (dropped > 0) notes.push(`${String(dropped)} ${dropped === 1 ? 'cable' : 'cables'} left out with their apps`);
  // A preset without a version already has its note above.
  if (migrated.migratedFrom !== null && migrated.migratedFrom > 0)
    notes.push(`updated from preset format ${String(migrated.migratedFrom)}`);
  const opened: OpenedPreset = { name: preset.name.trim().slice(0, 80), version: VERSION, nodes, edges };
  if (preset['source']) opened.source = preset['source'];
  return { preset: opened, notes };
}
