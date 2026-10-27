// The stacks on this Mac, and switching between them: each keeps its own boards, history and live state.
import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { readJson, writeJson } from '../json-files.ts';
import { stackProblems } from '../core/stack.ts';
import { writeData } from '../data.ts';
import { Failure } from '../failure.ts';
import { configDir, tempDir } from '../paths.ts';
import {
  type Config,
  type Index,
  loadConfig,
  readIndex,
  type Save,
  saveConfig,
  type StackFile,
  tilde,
} from './config.ts';
import { candidateRepos, findStacks } from './repos.ts';

/** A stack on this Mac. */
export interface KnownStack {
  dir: string;
  /** Where it is, for showing: its folder, or its link when it comes from GitHub. */
  path: string;
  name: string;
  apps: number;
  envs: string[];
  shared: boolean;
  linked?: string;
}

// Each stack keeps its own board, history, live state, action log and notes; switching puts them away and brings the other's back.
// The board in both its forms: one saved before boards were JSON moves along until it is saved again.
const PER_STACK = [
  'state.json',
  'local-databases.json',
  'state.js',
  'history.jsonl',
  'live.json',
  'actions.json',
  'status.json',
  'NOTES.md',
  'stack.suggestions.json',
  'stack.deployed.json',
];

/** Says which stack a `koppler sync` is loading, for as long as it runs. */
export const LOADING = path.join(tempDir(), 'loading.json');

export const stackKey = (dir: string): string =>
  crypto.createHash('sha1').update(path.resolve(dir)).digest('hex').slice(0, 12);

/** Moves each per-stack file that is in `from` to `to`. */
const moveFiles = (from: string, to: string, make = true) => {
  const there = PER_STACK.filter(file => fs.existsSync(path.join(from, file)));
  if (make && there.length) fs.mkdirSync(to, { recursive: true });
  for (const file of there) fs.renameSync(path.join(from, file), path.join(to, file));
};

/** Why the stack in use cannot be switched to `dir` now, or null when it can: asked before writing anything for it. */
export function switchRefused(config: Config, dir: string): string | null {
  const from = config.stack;
  if (from && path.resolve(from) === path.resolve(dir)) return null;
  // The undo log goes with its stack: switched away mid-run, a Stop would find nothing to revert.
  const logged = readJson<unknown[]>(path.join(tempDir(), 'actions.json'), []);
  return Array.isArray(logged) && logged.length
    ? 'the run on this stack still has changes to undo; stop and revert it first (canvas, or koppler down), then switch'
    : null;
}

export function setStack(config: Config, dir: string, save: Save = saveConfig): void {
  const from = config.stack;
  if (from && path.resolve(from) === path.resolve(dir)) return;
  const refused = switchRefused(config, dir);
  if (refused) throw new Failure(refused);
  const shelf = (stack: string) => path.join(tempDir(), 'stacks', stackKey(stack));
  if (from) {
    fs.mkdirSync(shelf(from), { recursive: true });
    moveFiles(tempDir(), shelf(from), false);
  }
  // With no stack in use before, what lies there is put aside too, never deleted: it may be a run's action log.
  else moveFiles(tempDir(), path.join(tempDir(), 'stacks', `unassigned-${String(Date.now())}`));
  moveFiles(shelf(dir), tempDir(), false);
  config.stack = dir;
  save(config);
}

export const currentStack = (): string | null => loadConfig().stack ?? null;

/** The stacks on this Mac for the switcher, looked up again at most every 10 seconds. */
export function stacksHere(): KnownStack[] {
  if (Date.now() - stacksCache.at > 10000) stacksCache = { at: Date.now(), list: knownStacks(readIndex()) };
  return stacksCache.list;
}

export function forgetStacks(): void {
  stacksCache.at = 0;
}

// Stacks the user created here live with their private config until they move one to a shared repo.
const PRIVATE_STACKS = path.join(configDir(), 'stacks');

let stacksCache: { at: number; list: KnownStack[] } = { at: 0, list: [] };
export const privateStacks = () => {
  try {
    return fs
      .readdirSync(PRIVATE_STACKS, { withFileTypes: true })
      .filter(dir => dir.isDirectory() && fs.existsSync(path.join(PRIVATE_STACKS, dir.name, 'stack.json')))
      .map(dir => path.join(PRIVATE_STACKS, dir.name));
  } catch {
    return [];
  }
};

/** A new, empty stack: a name and its deployed environments (first one is the default). It becomes the stack in use. */
export function createStack(
  input: unknown,
  {
    config = loadConfig(),
    dir = PRIVATE_STACKS,
    save = saveConfig,
  }: { config?: Config; dir?: string; save?: Save } = {},
): { stack: string; error?: undefined } | { error: string } {
  const given = (input ?? {}) as { name?: unknown; envs?: unknown };
  const name = typeof given.name === 'string' ? given.name.trim().slice(0, 60) : '';
  if (!name) return { error: 'Give the stack a name.' };
  const typed = typeof given.envs === 'string' ? given.envs.split(/[\s,]+/) : [];
  const listed = Array.isArray(given.envs) ? (given.envs as unknown[]) : typed;
  const envs = [...new Set(listed.map(env => String(env).trim().toLowerCase()).filter(Boolean))];
  if (!envs.length) return { error: 'Name at least one environment, e.g. qa.' };
  if (envs.length > 8 || !envs.every(env => /^[a-z0-9-]{1,16}$/.test(env)))
    return { error: 'Environment names are short and use lowercase letters, digits and dashes, e.g. qa, prod.' };
  const slug =
    name
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, '-')
      .replace(/^-+|-+$/g, '') || 'stack';
  const folder = path.join(dir, slug);
  if (fs.existsSync(path.join(folder, 'stack.json'))) return { error: `You already have a stack called ${name}.` };
  const refused = switchRefused(config, folder);
  if (refused) return { error: refused };
  writeJson(path.join(folder, 'stack.json'), { name, envs, apps: {} });
  setStack(config, folder, save);
  return { stack: folder };
}

/** Every stack on this Mac: in a cloned repo (shared) or in the private config, with enough to tell them apart. */
export function knownStacks(index: Pick<Index, 'repos'> | null | undefined): KnownStack[] {
  const dirs: [string, boolean][] = [
    ...findStacks(index?.repos ?? []).map((dir): [string, boolean] => [dir, true]),
    ...privateStacks().map((dir): [string, boolean] => [dir, false]),
  ];
  return dirs.flatMap(([dir, inRepo]): KnownStack[] => {
    const stack = readJson(path.join(dir, 'stack.json')) as StackFile | null;
    const linked = (readJson(path.join(dir, '.source.json')) as { url?: string } | null)?.url;
    if (!stack || stackProblems(stack).length) return [];
    return [
      {
        dir,
        path: linked ?? tilde(dir),
        name: stack.name ?? path.basename(dir),
        apps: Object.keys(stack.apps).length,
        envs: stack.envs ?? [],
        shared: inRepo || !!linked,
        ...(linked && { linked }),
      },
    ];
  });
}

/** Switches to one of those stacks; any other folder is refused. */
export function useStack(
  dir: string,
  {
    config = loadConfig(),
    index = readIndex(),
    save = saveConfig,
  }: { config?: Config; index?: Index | null; save?: Save } = {},
): { stack: string; error?: undefined } | { error: string } {
  const found = knownStacks(index).find(stack => stack.dir === dir);
  if (!found)
    return { error: 'That is not a stack Koppler found on this Mac. Clone its repo, then run koppler init again.' };
  setStack(config, found.dir, save);
  return { stack: found.dir };
}

/** With no stack yet, the canvas still opens: it asks for a name and environments, then for the apps. */
export function writeSetup(index: Index): void {
  fs.mkdirSync(tempDir(), { recursive: true });
  writeData('registry', { name: '', envs: ['dev'], apps: {}, setup: true, stacks: knownStacks(index) });
  writeData('local', { roots: index.roots, at: new Date().toISOString(), apps: {} });
  writeData('repos', { roots: index.roots.map(tilde), stack: null, repos: candidateRepos(index, { apps: {} }, null) });
}
