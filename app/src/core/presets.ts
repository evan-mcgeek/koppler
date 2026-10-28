// Presets (saved boards): bringing one saved in an older format up to date, and checking it against the stack before
// it opens.
import { editFeature, featureOf, type FeatureEdit } from './feature.ts';
import { BOARD_FORMAT, migrateBoard } from './migrations/board/index.ts';
import type { Edge } from './plan.ts';

/** The numbered preset format Koppler 0.1.0 and older read; a board's format is now its `koppler` version. */
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
export type Migrated =
  | { preset: StoredPreset; migratedFrom: string | null; error?: undefined }
  | { error: string; preset?: undefined; migratedFrom?: undefined };

/** A preset as stored, brought up to this Koppler's board format; the reason when it cannot be read. */
export function migrate(input: unknown): Migrated {
  if (!isObject(input)) return { error: 'It is not a preset.' };
  const { name, nodes, edges, version } = input;
  if (typeof name !== 'string' || !name.trim()) return { error: 'It has no name.' };
  // A feature board can hold no app that runs here: it is read in Discover.
  if (!isObject(nodes) || (Object.keys(nodes).length === 0 && !featureOf(input['feature'])))
    return { error: 'It has no apps.' };
  if (typeof version === 'number' && version > VERSION)
    return { error: `It was saved by a newer Koppler (preset format ${String(version)}). Update Koppler.` };
  // Whatever wrote it: every app is an object and the cables are a list.
  const preset: StoredPreset = {
    ...input,
    name,
    nodes: Object.fromEntries(Object.entries(nodes).map(([id, node]) => [id, isObject(node) ? node : {}])),
    edges: Array.isArray(edges) ? edges : [],
  };
  const done = migrateBoard(preset);
  if (done.error !== undefined) return { error: `It was saved by a newer Koppler: ${done.error}.` };
  // The numbered format Koppler 0.1.0 and older read is still written, so they keep opening it.
  return {
    preset: { ...(done.value as StoredPreset), version: VERSION },
    migratedFrom: done.applied.length ? done.from : null,
  };
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
  /** The clone's current branch and how many files it has changed, or null when not known. */
  checkedOut: (id: string) => { branch: string; dirty: number } | null;
  name?: (id: string) => string;
}

export interface OpenedNode {
  run: string;
  platform?: string;
  branch?: string;
  /** The card follows the clone, which has uncommitted work on another branch, until a branch is picked on it. */
  followsClone?: true;
  note?: string;
  tunnels?: false;
  queues?: true;
  watch?: true;
}
export interface OpenedPreset {
  name: string;
  version: number;
  /** The Koppler board format it is in. */
  koppler: string;
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
  const clone = stack.checkedOut(id);
  if (branch) node.branch = branch;
  if (branch && clone?.branch && clone.branch !== branch && clone.dirty > 0) {
    node.followsClone = true;
    const files = clone.dirty === 1 ? 'file' : 'files';
    notes.push(
      `${name} stays on ${clone.branch}: ${String(clone.dirty)} uncommitted ${files}. The board asks for ${branch}; pick it on the card to switch`,
    );
  } else if (branch) {
    const branches = stack.branches(id);
    if (branches && !branches.includes(branch))
      notes.push(`${name} has no branch ${branch} in your clone (fetch it first)`);
  }
  if (typeof stored['note'] === 'string' && stored['note'].trim()) node.note = stored['note'];
  if (stored['tunnels'] === false) node.tunnels = false;
  if (stored['queues'] === true) node.queues = true;
  if (stored['watch'] === true) node.watch = true;
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
  if (!isObject(input) || (!Number.isInteger(input['version']) && input['koppler'] === undefined))
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
  if (migrated.migratedFrom !== null && migrated.migratedFrom !== '0.0.0')
    notes.push(`updated from the Koppler ${migrated.migratedFrom} format`);
  const opened: OpenedPreset = {
    name: preset.name.trim().slice(0, 80),
    version: VERSION,
    koppler: BOARD_FORMAT.version,
    nodes,
    edges,
  };
  if (preset['source']) opened.source = preset['source'];
  return { preset: opened, notes };
}

/** A change made to a board from the terminal: apps on and off it, cables, and an app's branch or note. */
export interface BoardEdit {
  add?: string[];
  remove?: string[];
  cable?: Edge[];
  uncable?: Edge[];
  branch?: Record<string, string>;
  /** An empty note takes the note off. */
  note?: Record<string, string>;
  /** Laid out afresh, as Arrange does: the saved places go. */
  arrange?: boolean;
  /** Its request, phases and steps: a board with them is a feature board. */
  feature?: FeatureEdit;
}

const isPoint = (value: unknown): value is { x: number; y: number } =>
  isObject(value) && typeof value['x'] === 'number' && typeof value['y'] === 'number';
const same = (a: Edge) => (b: Edge) => a.from === b.from && a.to === b.to;

/** The board with the edit made. What it does not touch stays as it was, card places too; new cards go in a column to the right. */
export function editPreset(given: StoredPreset, edit: BoardEdit): StoredPreset {
  const preset = edit.feature ? { ...given, feature: editFeature(featureOf(given['feature']), edit.feature) } : given;
  const gone = new Set(edit.remove ?? []);
  const kept = <T>(all: Record<string, T>) => Object.fromEntries(Object.entries(all).filter(([id]) => !gone.has(id)));
  const nodes = kept(preset.nodes);
  const layout = isObject(preset['layout']) ? preset['layout'] : undefined;
  const at = kept(isObject(layout?.['nodes']) ? layout['nodes'] : {});
  const placed = Object.values(at).filter(isPoint);
  let y = Math.min(...placed.map(point => point.y));
  for (const id of edit.add ?? []) {
    if (nodes[id]) continue;
    nodes[id] = { run: 'cli' };
    if (!placed.length) continue;
    at[id] = { x: Math.max(...placed.map(point => point.x)) + 340, y };
    y += 240;
  }
  for (const [id, branch] of Object.entries(edit.branch ?? {})) if (nodes[id]) nodes[id] = { ...nodes[id], branch };
  for (const [id, note] of Object.entries(edit.note ?? {})) {
    const { note: _, ...rest } = nodes[id] ?? {};
    if (nodes[id]) nodes[id] = note.trim() ? { ...rest, note } : rest;
  }
  const edges = preset.edges
    .filter(isEdge)
    .filter(edge => !gone.has(edge.from) && !gone.has(edge.to) && !(edit.uncable ?? []).some(same(edge)));
  for (const edge of edit.cable ?? []) if (!edges.some(same(edge))) edges.push({ from: edge.from, to: edge.to });
  if (!layout || edit.arrange) {
    const { layout: _, ...rest } = preset;
    return { ...rest, nodes, edges };
  }
  const wired = new Set(edges.map(edge => `${edge.from}>${edge.to}`));
  const sides = Object.fromEntries(
    Object.entries(isObject(layout['sides']) ? layout['sides'] : {}).filter(([key]) => wired.has(key)),
  );
  return { ...preset, nodes, edges, layout: { ...layout, nodes: at, sides } };
}

/** The edit in words, e.g. "added Orders; cabled Web to Orders". */
export function describeEdit(
  edit: BoardEdit,
  name: (id: string) => string = id => id,
  /** Said of a change not made yet: "add", not "added". */
  proposed = false,
): string {
  const list = (ids: string[] = []) => ids.map(name).join(', ');
  const cables = (edges: Edge[] = []) => edges.map(edge => `${name(edge.from)} to ${name(edge.to)}`).join(', ');
  return [
    edit.add?.length && `${proposed ? 'add' : 'added'} ${list(edit.add)}`,
    edit.remove?.length && `${proposed ? 'remove' : 'removed'} ${list(edit.remove)}`,
    edit.cable?.length && `${proposed ? 'cable' : 'cabled'} ${cables(edit.cable)}`,
    edit.uncable?.length && `${proposed ? 'take the cable off' : 'took the cable off'} ${cables(edit.uncable)}`,
    ...Object.entries(edit.branch ?? {}).map(([id, branch]) => `${proposed ? 'put ' : ''}${name(id)} on ${branch}`),
    ...Object.entries(edit.note ?? {}).map(([id, note]) =>
      note.trim()
        ? `${proposed ? 'add ' : ''}a note on ${name(id)}`
        : `${proposed ? 'take the ' : 'no '}note${proposed ? ' off ' : ' on '}${name(id)}`,
    ),
    edit.arrange && (proposed ? 'lay it out afresh' : 'arranged'),
    edit.feature?.request !== undefined && 'set the request',
    ...(edit.feature?.phase ?? []).map(phase => `${proposed ? 'add' : 'added'} the phase ${phase}`),
    edit.feature?.step?.length &&
      `${proposed ? 'add' : 'added'} the step${edit.feature.step.length > 1 ? 's' : ''} ${cables(edit.feature.step)}`,
    edit.feature?.unstep?.length && `${proposed ? 'take off' : 'took off'} the step ${cables(edit.feature.unstep)}`,
  ]
    .filter(Boolean)
    .join('; ');
}
