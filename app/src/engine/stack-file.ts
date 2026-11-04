// Changes to the stack file in use: adding and removing apps and outside systems, and setting any field.
import { upgradeStack } from '../core/migrations/files.ts';
import { readUpgraded } from '../upgraded.ts';
import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { readJson, writeJson } from '../json-files.ts';
import { kindsFor } from '../core/kinds.ts';
import { unknownFields, validateStack } from '../core/stack.ts';
import { withoutMissingApps } from '../core/missing-apps.ts';
import { getAt, parsePath, setAt } from '../core/stack-path.ts';
import { mergeStacks, type Merged, type Side } from '../core/stack-merge.ts';
import { brokenLock, LOCKED, lockedPaths, moveLocks } from './locks.ts';
import { readData, writeData } from '../data.ts';
import {
  type Config,
  expand,
  type Index,
  loadConfig,
  readIndex,
  type Save,
  saveConfig,
  type StackFile,
} from './config.ts';
import { sourceOf } from './linked.ts';
import { candidateRepos } from './repos.ts';
import { privateStacks } from './stacks.ts';

const NO_STACK = 'No stack is set up yet: koppler init';

/** The stack file in use, with where it is. */
function stackInUse(config: Config): { source: string; stack: StackFile; error?: undefined } | { error: string } {
  if (!config.stack) return { error: NO_STACK };
  const source = path.join(config.stack, 'stack.json');
  const read = readStackFile(source);
  if (read.error !== undefined) return read;
  return read.stack ? { source, stack: read.stack } : { error: `cannot read ${source}` };
}

/**
 * A stack file in this Koppler's format: brought up to it as it is read, and written back with its version, unless
 * that would give it a problem it did not have.
 */
export function readStackFile(source: string): { stack: StackFile | null; error?: undefined } | { error: string } {
  const read = readUpgraded(source, upgradeStack, (before, after) => {
    const had = new Set(validateStack(before));
    return validateStack(after).every(problem => had.has(problem));
  });
  return read.error === undefined ? { stack: read.value as StackFile | null } : { error: `${source}: ${read.error}` };
}

const NOT_SET_UP =
  'Run facts not collected yet: read the repo (launchSettings/README/infra) and fill run, url, prereqs before using.';

/** Adds picked clones to stack.json as apps that are not set up yet. Only clones from the index can be added. */
export function addApps(
  picks: unknown,
  { config = loadConfig(), index = readIndex() }: { config?: Config; index?: Index | null } = {},
): { added: string[]; error?: undefined } | { error: string } {
  if (!config.stack || !index) return { error: NO_STACK };
  const used = stackInUse(config);
  if (used.error !== undefined) return used;
  const { source, stack } = used;
  const known = new Map(candidateRepos(index, stack, config.stack).map(candidate => [candidate.slug, candidate]));
  const added: string[] = [];
  for (const picked of (Array.isArray(picks) ? (picks as unknown[]) : []).slice(0, 200)) {
    const pick = (picked ?? {}) as { slug?: string; kind?: string; name?: unknown };
    const candidate = known.get(pick.slug ?? '');
    if (!candidate || candidate.inStack) continue;
    const kind = Object.hasOwn(kindsFor(stack), pick.kind ?? '') ? pick.kind : candidate.kind;
    if (!kind) return { error: `Say what kind of app ${candidate.slug} is.` };
    const repo = candidate.slug.split('/').pop() ?? '';
    const base =
      repo
        .toLowerCase()
        .replace(/[^a-z0-9-]+/g, '-')
        .replace(/^-+|-+$/g, '') || 'app';
    let id = base;
    for (let n = 2; stack.apps[id]; n++) id = `${base}-${String(n)}`;
    const name = typeof pick.name === 'string' && pick.name.trim() ? pick.name.trim() : candidate.name;
    stack.apps[id] = { name: name.slice(0, 80), kind, slug: candidate.slug, pending: NOT_SET_UP };
    candidate.inStack = id;
    added.push(id);
  }
  // ponytail: picks are added to `stack` in place above; the copy taken here is what was there before.
  if (added.length) {
    const refused = saveStack(source, readJson(source), stack);
    if (refused) return refused;
  }
  return { added };
}

/** The stack file in use, as edits write it and locks are kept by; null with no stack. */
export const stackSource = (config: Config = loadConfig()): string | null =>
  config.stack ? path.join(config.stack, 'stack.json') : null;

/** Writes the stack file, unless the change alters a field the user locked: then it says which, and writes nothing. */
export function saveStack(source: string, before: unknown, next: unknown): { error: string } | null {
  const locked = brokenLock(source, before, next);
  if (locked) return { error: LOCKED(locked) };
  writeJson(source, next);
  return null;
}

/** Copies the stack file in use to the canvas's registry again, keeping what the last sync found: a quick reload after one field changed. */
export function refreshRegistry(): void {
  const source = stackSource();
  const registry = readData('registry');
  const stack = source ? (readJson(source) as StackFile | null) : null;
  if (source && registry && stack) writeData('registry', { ...stack, source, found: registry['found'] });
}

/** What a change breaks that the stack did not break before: a rule, or a field the format does not know. */
function newProblems(before: unknown, next: unknown): string[] {
  const broken = new Set(validateStack(before));
  const unknown = new Set(unknownFields(before));
  return [
    ...validateStack(next).filter(problem => !broken.has(problem)),
    ...unknownFields(next)
      .filter(where => !unknown.has(where))
      .map(where => `${where}: not a field Koppler knows (koppler stack schema lists them)`),
  ];
}

/**
 * Replaces the whole stack with an edited copy, as the settings panels save it: checked against every rule first and
 * against the locks, and written only when it passes. The problems are given as `where: what`, so each finds its field.
 */
export function replaceStack(
  next: unknown,
  { config = loadConfig() }: { config?: Config } = {},
): { problems: string[]; error?: undefined } | { error: string; problems?: string[] } {
  const used = stackInUse(config);
  if (used.error !== undefined) return used;
  const problems = newProblems(used.stack, next);
  if (problems.length) return { error: problems.slice(0, 5).join('; '), problems };
  return saveStack(used.source, used.stack, next) ?? { problems: [] };
}

/** What the stack in use holds at a path (the whole stack without one). */
export function readStackAt(
  pathText = '',
  { config = loadConfig() }: { config?: Config } = {},
): { value: unknown; error?: undefined } | { error: string } {
  const used = stackInUse(config);
  if (used.error !== undefined) return used;
  if (!pathText) return { value: used.stack };
  const parsed = parsePath(pathText);
  if ('error' in parsed) return parsed;
  return { value: getAt(used.stack, parsed) };
}

/**
 * Changes one field of the stack in use, or takes it out when no value is given. The first of the values that keeps
 * the stack valid is written (a value typed in a terminal may be meant as text or as JSON); a change that breaks one of
 * the stack's rules is refused with what it breaks, and nothing is written.
 */
export function editStack(
  pathText: string,
  values?: unknown[],
  { config = loadConfig() }: { config?: Config } = {},
): { path: string; value: unknown; error?: undefined } | { error: string } {
  const used = stackInUse(config);
  if (used.error !== undefined) return used;
  const parsed = parsePath(pathText);
  if ('error' in parsed) return parsed;
  let first = '';
  for (const value of values ?? [undefined]) {
    let next: unknown;
    try {
      next = setAt(used.stack, parsed, value);
    } catch (error) {
      return { error: `${pathText}: ${(error as Error).message}` };
    }
    const broken = newProblems(used.stack, next);
    if (!broken.length) return saveStack(used.source, used.stack, next) ?? { path: pathText, value };
    first ||= broken.slice(0, 5).join('; ');
  }
  return { error: first };
}

/**
 * Adds a system the apps call that never runs here (a SaaS API, a managed service), with the apps that call it, so it
 * shows on their boards as an outside card.
 */
export function addOutside(
  given: { name?: unknown; url?: unknown; why?: unknown; calledBy?: unknown; sendsTo?: unknown },
  { config = loadConfig() }: { config?: Config } = {},
): { added: string; error?: undefined } | { error: string } {
  const used = stackInUse(config);
  if (used.error !== undefined) return used;
  const { source, stack } = used;
  const text = (value: unknown, max: number) => (typeof value === 'string' ? value.trim().slice(0, max) : '');
  const name = text(given.name, 80);
  if (!name) return { error: 'Give the outside system a name.' };
  const url = text(given.url, 500);
  if (url && !/^https?:\/\//.test(url)) return { error: `${url} is not a web address (https://...).` };
  if (url && !URL.canParse(url)) return { error: `${url} is not a web address.` };
  const apps = stack.apps;
  if (Object.values(apps).some(app => app.name?.toLowerCase() === name.toLowerCase()))
    return { error: `The stack already has ${name}.` };
  const ids = (list: unknown) =>
    [...new Set(Array.isArray(list) ? (list as unknown[]) : [])].filter((id): id is string => typeof id === 'string');
  const callers = ids(given.calledBy);
  const called = ids(given.sendsTo);
  const unknown = [...callers, ...called].filter(id => !apps[id] || apps[id].outside);
  if (unknown.length) return { error: `Not apps of the stack that run here: ${[...new Set(unknown)].join(', ')}.` };
  if (!callers.length && !called.length)
    return { error: `Say which apps call ${name}, or which it sends to: its card shows next to them.` };
  const base =
    name
      .toLowerCase()
      .replace(/[^a-z0-9-]+/g, '-')
      .replace(/^-+|-+$/g, '') || 'outside';
  let id = base;
  for (let n = 2; apps[id]; n++) id = `${base}-${String(n)}`;
  apps[id] = {
    name,
    kind: 'other',
    outside: text(given.why, 200) || 'An outside system: it never runs here.',
    ...(url && { deployedUrl: url }),
    ...(called.length && { consumes: Object.fromEntries(called.map(to => [to, {}])) }),
  };
  for (const caller of callers) {
    const app = apps[caller];
    if (app) app.consumes = { ...app.consumes, [id]: {} };
  }
  return saveStack(source, readJson(source), stack) ?? { added: id };
}

/**
 * Takes an app out of the stack, and every mention of it: other apps' calls to it and order after it, and its cards on
 * the team boards. The clone stays where it is; the user's own boards skip it when they open.
 */
export function removeApp(
  id: string,
  { config = loadConfig() }: { config?: Config } = {},
): { removed: string; name: string; error?: undefined } | { error: string } {
  const used = stackInUse(config);
  if (used.error !== undefined) return used;
  const { source, stack } = used;
  const app = (stack.apps as StackFile['apps'] | undefined)?.[id];
  if (!app) return { error: `${id} is not in the stack` };
  const name = app.name ?? id;
  const { [id]: removed, ...apps } = stack.apps;
  const next = withoutMissingApps({ ...stack, apps });
  const before = new Set(validateStack(stack));
  const broken = validateStack(next).filter(problem => !before.has(problem));
  if (broken.length) return { error: broken.slice(0, 5).join('; ') };
  return saveStack(source, readJson(source), next) ?? { removed: id, name };
}

/**
 * Another stack folded into the one in use (see mergeStacks). With `apply` it is kept only when every conflict is
 * settled and the whole result passes the stack's checks and locks; otherwise nothing is written.
 */
export function mergeStack(
  dir: string,
  { keep = {}, prefer, apply = false }: { keep?: Record<string, Side>; prefer?: Side | undefined; apply?: boolean },
  { config = loadConfig() }: { config?: Config } = {},
): { merged: Merged; error?: undefined } | { error: string } {
  const used = stackInUse(config);
  if (used.error !== undefined) return used;
  const read = readStackFile(path.join(dir, 'stack.json'));
  if (read.error !== undefined) return read;
  if (!read.stack) return { error: `cannot read ${path.join(dir, 'stack.json')}` };
  const ours = used.stack as unknown as Record<string, unknown>;
  const theirs = read.stack as unknown as Record<string, unknown>;
  const merged = mergeStacks(ours, theirs, { keep, prefer, locked: lockedPaths(used.source) });
  const stray = Object.keys(keep).filter(at => !merged.conflicts.some(one => one.path === at));
  if (stray.length) return { error: `${stray.join(', ')} is not a conflict of this merge` };
  if (!apply) return { merged };
  const open = merged.conflicts.filter(one => !one.kept).map(one => one.path);
  if (open.length)
    return {
      error: `${String(open.length)} ${open.length === 1 ? 'conflict is' : 'conflicts are'} not settled: ${open.join(', ')}`,
    };
  if (JSON.stringify(merged.stack) === JSON.stringify(ours)) return { merged };
  const problems = newProblems(ours, merged.stack);
  if (problems.length) return { error: problems.slice(0, 5).join('; ') };
  return saveStack(used.source, ours, merged.stack) ?? { merged };
}

const gitTop = (dir: string) => {
  try {
    return execFileSync('git', ['-C', dir, 'rev-parse', '--show-toplevel'], {
      encoding: 'utf8',
      stdio: ['ignore', 'pipe', 'ignore'],
    }).trim();
  } catch {
    return '';
  }
};

/**
 * The private stack in use moved into a folder of a git clone, where Koppler finds shared stacks, and used from there
 * with its locks. Nothing is committed: the user does that.
 */
export function publishStack(
  folder: string,
  { config = loadConfig(), save = saveConfig }: { config?: Config; save?: Save } = {},
): { dir: string; top: string; file: string; name: string; error?: undefined } | { error: string } {
  const used = stackInUse(config);
  if (used.error !== undefined) return used;
  const from = path.dirname(used.source);
  if (!privateStacks().some(dir => path.resolve(dir) === path.resolve(from)) || sourceOf(from))
    return { error: 'the stack in use is not a private stack: it is in a repo already (koppler stack propose)' };
  const dir = path.resolve(expand(folder));
  let there = dir;
  while (!fs.existsSync(there)) there = path.dirname(there);
  const top = gitTop(there);
  if (!top) return { error: `${folder} is not inside a git clone` };
  const file = path
    .relative(top, path.join(fs.realpathSync(there), path.relative(there, dir), 'stack.json'))
    .split(path.sep)
    .join('/');
  if (!/^(?:\.koppler|stacks\/[^/]+)\/stack\.json$/.test(file))
    return { error: `Koppler finds a shared stack in <clone>/stacks/<name> or <clone>/.koppler; ${folder} is neither` };
  const target = path.join(dir, 'stack.json');
  if (fs.existsSync(target)) return { error: `${folder} already holds a stack.json` };
  fs.mkdirSync(dir, { recursive: true });
  fs.copyFileSync(used.source, target, fs.constants.COPYFILE_EXCL);
  moveLocks(used.source, target);
  config.stack = dir;
  save(config);
  fs.rmSync(used.source);
  // Anything else kept beside it stays where it was.
  if (!fs.readdirSync(from).length) fs.rmdirSync(from);
  return { dir, top, file, name: used.stack.name ?? path.basename(dir) };
}
