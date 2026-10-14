// Finds your local repos (any git host) and the shared stack config, then copies the stack into the run folder as registry.json and
// each app's clone into local.json, for the canvas and the commands.
// Usage: koppler init [--root <dir>]... [--depth <n>] [--stack <dir>]   first-time scan of every repo, remembered
//        koppler sync [--stack <dir>] [--rescan]                        before each run
import { execFile, execFileSync } from 'node:child_process';
import crypto from 'node:crypto';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { writeJson } from '../json-files.ts';
import { KINDS, of as kindOf, register } from '../core/kinds.ts';
import { validateStack } from '../core/stack.ts';
import { getAt, parsePath, setAt } from '../core/stack-path.ts';
import { brokenLock, LOCKED } from './locks.ts';
import { readData, writeData, type Clone } from '../data.ts';
import { Failure } from '../failure.ts';
import { TEMP } from '../paths.ts';
import { checkStack as checkLoadedStack } from './checks.ts';
import { detectKind } from './investigate.ts';
import { librariesFor, packageOf, type Library } from './libraries.ts';

/** A clone on this Mac, with one key per remote. */
interface Repo {
  path: string;
  keys: string[];
}
/** Every clone the last scan found. */
interface Index {
  at?: string;
  roots: string[];
  depth?: number;
  repos: Repo[];
}
interface Config {
  stack?: string;
  roots?: string[];
  depth?: number;
  root?: string;
}
interface Called {
  deployed?: string | undefined;
}
interface AppFile {
  name?: string | undefined;
  kind?: string | undefined;
  slug?: string | undefined;
  outside?: unknown;
  deployedUrl?: string | undefined;
  consumes?: Record<string, Called> | undefined;
  /** What differs per environment; read as it comes. */
  envs?: Record<string, Record<string, unknown>> | undefined;
  pending?: string | boolean | undefined;
}
/** A stack file as far as this module reads it. */
interface StackFile {
  name?: string | undefined;
  envs?: string[];
  apps: Record<string, AppFile>;
  kinds?: unknown;
}
/** A clone that could join the stack, for the picker on the canvas. */
export interface Candidate {
  slug: string;
  name: string;
  kind: string | null;
  path: string;
  folder: string;
  inStack?: string;
}
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
type Save = (config: Config) => void;

const CONFIG_DIR = process.env['KOPPLER_CONFIG_DIR'] || path.join(os.homedir(), '.config', 'koppler');
const CONFIG = path.join(CONFIG_DIR, 'config.json');
const INDEX = path.join(CONFIG_DIR, 'repos.json');
const SKIP = new Set([
  'node_modules',
  'Library',
  'Applications',
  'Pictures',
  'Music',
  'Movies',
  '.worktrees',
  'bin',
  'obj',
  'build',
  'dist',
  '.dart_tool',
  'Pods',
  'vendor',
  'target',
]);
const DEFAULT_ROOTS = [
  '~/development',
  '~/dev',
  '~/src',
  '~/code',
  '~/projects',
  '~/workspace',
  '~/repos',
  '~/git',
  '~/github',
];
const DEFAULT_DEPTH = 4;
const expand = (given: string) => path.resolve(given.replace(/^~/, os.homedir()));
const tilde = (full: string) => (full.startsWith(os.homedir()) ? '~' + full.slice(os.homedir().length) : full);
// Every failure here exits 1, a usage line too.
function fail(message: string): never {
  throw new Failure(message, 1);
}

/** One key per remote, `host/path`, for any git host: git@github.com:a/b.git and https://github.com/a/b give the same key. */
export function remoteKey(given: string | null | undefined): string | null {
  const url = given?.trim();
  if (!url || /^file:/i.test(url)) return null;
  let host: string;
  let repoPath: string;
  const scp = /^(?:[^@/]+@)?([^:/]+):(?!\/)(.+)$/.exec(url);
  if (/^[a-z][a-z0-9+.-]*:\/\//i.test(url)) {
    let parsed: URL;
    try {
      parsed = new URL(url);
    } catch {
      return null;
    }
    host = parsed.hostname;
    // A stray % (not an escape) is kept as written.
    try {
      repoPath = decodeURIComponent(parsed.pathname);
    } catch {
      repoPath = parsed.pathname;
    }
  } else if (scp) [, host = '', repoPath = ''] = scp;
  else return null;
  host = host.toLowerCase();
  repoPath = repoPath
    .replace(/^\/+|\/+$/g, '')
    .replace(/\.git$/i, '')
    .toLowerCase();
  // Azure DevOps spells the same repo three ways.
  if (host === 'ssh.dev.azure.com') {
    host = 'dev.azure.com';
    repoPath = repoPath.replace(/^v3\//, '');
  }
  const account = /^([^.]+)\.visualstudio\.com$/.exec(host)?.[1];
  if (account) {
    host = 'dev.azure.com';
    repoPath = `${account}/${repoPath}`;
  }
  if (host === 'dev.azure.com') repoPath = repoPath.replace('/_git/', '/');
  return repoPath.includes('/') ? `${host}/${repoPath}` : null;
}

/** A stack slug without a host (`owner/repo`) matches that path on any host; with a host it must match exactly. */
export function slugMatches(slug: string | null | undefined, key: string): boolean {
  if (!slug) return false;
  const wanted = slug.toLowerCase().replace(/\.git$/, '');
  const parts = wanted.split('/');
  return parts[0]?.includes('.')
    ? key === wanted
    : key.endsWith('/' + wanted) && key.split('/').length === parts.length + 1;
}

function remotesOf(gitDir: string): string[] {
  let config: string;
  try {
    config = fs.readFileSync(path.join(gitDir, 'config'), 'utf8');
  } catch {
    return [];
  }
  return [...config.matchAll(/^\s*url\s*=\s*(\S+)/gm)].flatMap(match => remoteKey(match[1]) ?? []);
}

export function findRepos(dir: string, maxDepth = DEFAULT_DEPTH, depth = 0, found: Repo[] = []): Repo[] {
  let entries: fs.Dirent[];
  try {
    entries = fs.readdirSync(dir, { withFileTypes: true });
  } catch {
    return found;
  }
  // Only real clones (.git directory); worktrees have a .git file and are skipped on purpose.
  if (entries.some(entry => entry.name === '.git' && entry.isDirectory())) {
    const keys = [...new Set(remotesOf(path.join(dir, '.git')))];
    if (keys.length) found.push({ path: dir, keys });
  }
  if (depth < maxDepth)
    for (const entry of entries)
      if (entry.isDirectory() && !entry.name.startsWith('.') && !SKIP.has(entry.name))
        findRepos(path.join(dir, entry.name), maxDepth, depth + 1, found);
  return found;
}

export function findStacks(repos: Pick<Repo, 'path'>[]): string[] {
  const stacks: string[] = [];
  for (const { path: repo } of repos) {
    if (fs.existsSync(path.join(repo, '.koppler', 'stack.json'))) stacks.push(path.join(repo, '.koppler'));
    let dirs: fs.Dirent[] = [];
    try {
      dirs = fs.readdirSync(path.join(repo, 'stacks'), { withFileTypes: true });
    } catch {
      // No stacks folder in this repo.
    }
    for (const dir of dirs)
      if (dir.isDirectory() && fs.existsSync(path.join(repo, 'stacks', dir.name, 'stack.json')))
        stacks.push(path.join(repo, 'stacks', dir.name));
  }
  return stacks;
}

/** Every deployed host each app is known by, from its own deployedUrl and from how other apps call it. */
export function hostsByApp(stack: Pick<StackFile, 'apps'>): Record<string, Set<string>> {
  const hosts: Record<string, Set<string>> = {};
  const add = (id: string, url: string | undefined) => {
    try {
      (hosts[id] ??= new Set()).add(new URL(url ?? '').hostname.toLowerCase());
    } catch {
      // No address, or not one.
    }
  };
  for (const [id, app] of Object.entries(stack.apps)) {
    const envs = Object.values(app.envs ?? {});
    add(id, app.deployedUrl);
    for (const env of envs) add(id, env['deployedUrl'] as string | undefined);
    for (const [callee, call] of Object.entries(app.consumes ?? {})) {
      add(callee, call.deployed);
      for (const env of envs) add(callee, (env['consumes'] as AppFile['consumes'])?.[callee]?.deployed);
    }
  }
  return hosts;
}

/** A host that two apps share (one app's QA address pointing at another) cannot say which app is called, so it is left out. */
export function hostOwners(stack: Pick<StackFile, 'apps'>): {
  unique: Map<string, string>;
  shared: [string, string[]][];
} {
  const owners = new Map<string, string[]>();
  for (const [id, hosts] of Object.entries(hostsByApp(stack)))
    for (const host of hosts) owners.set(host, [...(owners.get(host) ?? []), id]);
  const unique = new Map<string, string>();
  for (const [host, ids] of owners) if (ids.length === 1 && ids[0]) unique.set(host, ids[0]);
  return { unique, shared: [...owners].filter(([, ids]) => ids.length > 1) };
}

/** Calls found in the caller's repo (a line naming another app's deployed host) that the stack does not list yet. */
export function missingCalls(
  stack: Pick<StackFile, 'apps'>,
  grepRepo: (caller: string, hosts: string[]) => string[],
): Record<string, Record<string, string>> {
  const { unique } = hostOwners(stack);
  const found: Record<string, Record<string, string>> = {};
  for (const [caller, app] of Object.entries(stack.apps)) {
    const hosts = [...unique].filter(([, owner]) => owner !== caller).map(([host]) => host);
    if (!hosts.length) continue;
    for (const line of grepRepo(caller, hosts)) {
      const host = hosts.find(one => line.toLowerCase().includes(one));
      const callee = host && unique.get(host);
      if (!callee || app.consumes?.[callee] || found[caller]?.[callee]) continue;
      (found[caller] ??= {})[callee] = line.slice(0, 200);
    }
  }
  return found;
}

// Tests, docs, lock files and one-off migration tools mention hosts without being the app's own calls.
const NOT_CODE = [
  '*.lock',
  'package-lock.json',
  '*.md',
  '**/test/**',
  '**/tests/**',
  '**/*Test*/**',
  '**/docs/**',
  '**/*Migration*/**',
].map(glob => `:(exclude,glob)${glob.includes('/') ? glob : '**/' + glob}`);
const MAX_GREP = 16 * 1024 * 1024;
const lines = (text: string) => text.split('\n').filter(Boolean);
export function grepClone(repo: string, hosts: string[]): string[] {
  const patterns = hosts.flatMap(host => ['-e', host]);
  try {
    return lines(
      execFileSync('git', ['-C', repo, 'grep', '-n', '-I', '-F', '-i', ...patterns, '--', ...NOT_CODE], {
        encoding: 'utf8',
        maxBuffer: MAX_GREP,
      }),
    );
  } catch {
    return [];
  }
}
/** Every http(s) address written in a clone's code, as "file:line:url". */
export function urlsInClone(repo: string): string[] {
  const find = ['grep', '-n', '-I', '-o', '-i', '-E', 'https?://[a-z0-9.-]+', '--', ...NOT_CODE];
  try {
    return lines(
      execFileSync('git', ['-C', repo, ...find], {
        encoding: 'utf8',
        stdio: ['ignore', 'pipe', 'ignore'],
        maxBuffer: MAX_GREP,
      }),
    );
  } catch {
    return [];
  }
}

function readJson<T>(file: string, fallback: T | null = null): T | null {
  try {
    return JSON.parse(fs.readFileSync(file, 'utf8')) as T | null;
  } catch {
    return fallback;
  }
}
const readIndex = () => readJson<Index>(INDEX);
const saveConfig: Save = config => {
  writeJson(CONFIG, config);
};
const git = (cwd: string, ...args: string[]) => execFileSync('git', args, { cwd, encoding: 'utf8' }).trim();
const MAX_BRANCHES = 300;

/** Local and remote-tracking branches, most recently committed first, without remote prefixes or duplicates. */
export function branchList(refs: string): string[] {
  const seen = new Set<string>();
  for (const ref of refs.split('\n')) {
    const name = ref
      .trim()
      .replace(/^refs\/heads\//, '')
      .replace(/^refs\/remotes\/[^/]+\//, '');
    if (name && name !== 'HEAD') seen.add(name);
  }
  return [...seen].slice(0, MAX_BRANCHES);
}
const branchesOf = (repo: string) => {
  try {
    return branchList(
      git(repo, 'for-each-ref', '--sort=-committerdate', '--format=%(refname)', 'refs/heads', 'refs/remotes'),
    );
  } catch {
    return [];
  }
};

interface Flags {
  roots: string[];
  stack?: string;
  depth?: number;
  rescan?: true;
}
function parseFlags(args: string[]): Flags {
  const flags: Flags = { roots: [] };
  for (let at = 0; at < args.length; at++) {
    const arg = args[at];
    if (arg === '--root') flags.roots.push(expand(args[++at] ?? fail('--root needs a folder')));
    else if (arg === '--stack') flags.stack = expand(args[++at] ?? fail('--stack needs a folder'));
    else if (arg === '--depth') flags.depth = Number(args[++at]);
    else if (arg === '--rescan') flags.rescan = true;
    else fail(`unknown option ${String(arg)}`);
  }
  if (flags.depth !== undefined && !(flags.depth >= 1 && flags.depth <= 8)) fail('--depth must be 1 to 8');
  return flags;
}

function loadConfig(): Config {
  const config = readJson<Config>(CONFIG) ?? {};
  if (config.root && !config.roots) config.roots = [config.root];
  delete config.root;
  return config;
}

function scan(roots: string[], depth: number): Index {
  const started = Date.now();
  const repos = roots.flatMap(root => findRepos(root, depth));
  const index = { at: new Date().toISOString(), roots, depth, repos };
  writeJson(INDEX, index);
  const hosts: Record<string, number> = {};
  for (const repo of repos)
    for (const host of new Set(repo.keys.map(key => key.split('/')[0] ?? ''))) hosts[host] = (hosts[host] ?? 0) + 1;
  const byHost = Object.entries(hosts)
    .sort((a, b) => b[1] - a[1])
    .map(([host, count]) => `${host} ${String(count)}`);
  const took = ((Date.now() - started) / 1000).toFixed(1);
  console.log(
    `REPOS ${String(repos.length)} in ${roots.map(tilde).join(', ')} (${byHost.join(', ') || 'no remotes'}) in ${took}s`,
  );
  return index;
}

const slugOfKey = (key: string) => (key.startsWith('github.com/') ? key.slice('github.com/'.length) : key);
const WORDS: Record<string, string> = { api: 'API', ui: 'UI', sdk: 'SDK', db: 'DB', cdr: 'CDR', id: 'ID' };
export const nameFromRepo = (repo: string): string =>
  repo
    .split(/[-_.]+/)
    .filter(Boolean)
    .map(word => WORDS[word.toLowerCase()] ?? word.charAt(0).toUpperCase() + word.slice(1))
    .join(' ');
/** Clones that could join the stack, for the picker on the canvas: where each is, what kind it looks like, and whether it is in already. */
export function candidateRepos(
  index: Pick<Index, 'repos'>,
  stack: Partial<StackFile>,
  stackDir: string | null | undefined,
): Candidate[] {
  register(stack.kinds);
  const seen = new Set<string>();
  const stackPath = path.resolve(stackDir ?? '/nowhere');
  return index.repos
    .filter(repo => fs.existsSync(repo.path) && !stackPath.startsWith(path.resolve(repo.path) + path.sep))
    .flatMap((repo): Candidate[] => {
      const slug = slugOfKey(repo.keys[0] ?? '');
      if (seen.has(slug)) return [];
      seen.add(slug);
      const inStack = Object.entries(stack.apps ?? {}).find(([, app]) =>
        repo.keys.some(key => slugMatches(app.slug, key)),
      )?.[0];
      return [
        {
          slug,
          name: nameFromRepo(slug.split('/').pop() ?? ''),
          kind: detectKind(repo.path),
          path: tilde(repo.path),
          folder: tilde(path.dirname(repo.path)),
          ...(inStack && { inStack }),
        },
      ];
    })
    .sort((a, b) => a.folder.localeCompare(b.folder) || a.name.localeCompare(b.name));
}

const NO_STACK = 'No stack is set up yet: koppler init';
/** The stack file in use, with where it is. */
function stackInUse(config: Config): { source: string; stack: StackFile; error?: undefined } | { error: string } {
  if (!config.stack) return { error: NO_STACK };
  const source = path.join(config.stack, 'stack.json');
  const stack = readJson<StackFile>(source);
  return stack ? { source, stack } : { error: `cannot read ${source}` };
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
    const kind = Object.hasOwn(KINDS, pick.kind ?? '') ? pick.kind : candidate.kind;
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
  const stack = source ? readJson<StackFile>(source) : null;
  if (source && registry && stack) writeData('registry', { ...stack, source, found: registry['found'] });
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
  const before = new Set(validateStack(used.stack));
  const problems = validateStack(next).filter(problem => !before.has(problem));
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
  const before = new Set(validateStack(used.stack));
  let first = '';
  for (const value of values ?? [undefined]) {
    let next: unknown;
    try {
      next = setAt(used.stack, parsed, value);
    } catch (error) {
      return { error: `${pathText}: ${(error as Error).message}` };
    }
    const broken = validateStack(next).filter(problem => !before.has(problem));
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
 * Takes an app out of the stack. Other apps' calls to it go too, since a call to a missing app makes the stack invalid.
 * The clone stays where it is; boards that list the app skip it when they open.
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
  for (const other of Object.values(apps)) if (other.consumes) other.consumes = dropKey(other.consumes, id);
  return saveStack(source, readJson(source), { ...stack, apps }) ?? { removed: id, name };
}
function dropKey<T>(from: Record<string, T>, key: string): Record<string, T> {
  const { [key]: dropped, ...rest } = from;
  return rest;
}

// Each stack keeps its own board, history, live state, action log and notes; switching puts them away and brings the other's back.
// The board in both its forms: one saved before boards were JSON moves along until it is saved again.
const PER_STACK = [
  'state.json',
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
export const LOADING = path.join(TEMP, 'loading.json');
export const stackKey = (dir: string): string =>
  crypto.createHash('sha1').update(path.resolve(dir)).digest('hex').slice(0, 12);
/** Moves each per-stack file that is in `from` to `to`. */
const moveFiles = (from: string, to: string, make = true) => {
  const there = PER_STACK.filter(file => fs.existsSync(path.join(from, file)));
  if (make && there.length) fs.mkdirSync(to, { recursive: true });
  for (const file of there) fs.renameSync(path.join(from, file), path.join(to, file));
};
export function setStack(config: Config, dir: string, save: Save = saveConfig): void {
  const from = config.stack;
  if (from && path.resolve(from) === path.resolve(dir)) return;
  // The undo log goes with its stack: switched away mid-run, a Stop would find nothing to revert.
  const logged = readJson<unknown[]>(path.join(TEMP, 'actions.json'), []);
  if (Array.isArray(logged) && logged.length)
    throw new Failure(
      'the run on this stack still has changes to undo; stop and revert it first (canvas, or koppler down), then switch',
    );
  const shelf = (stack: string) => path.join(TEMP, 'stacks', stackKey(stack));
  if (from) {
    fs.mkdirSync(shelf(from), { recursive: true });
    moveFiles(TEMP, shelf(from), false);
  }
  // With no stack in use before, what lies there is put aside too, never deleted: it may be a run's action log.
  else moveFiles(TEMP, path.join(TEMP, 'stacks', `unassigned-${String(Date.now())}`));
  moveFiles(shelf(dir), TEMP, false);
  config.stack = dir;
  save(config);
}
export const currentStack = (): string | null => loadConfig().stack ?? null;
let stacksCache: { at: number; list: KnownStack[] } = { at: 0, list: [] };
/** The stacks on this Mac for the switcher, looked up again at most every 10 seconds. */
export function stacksHere(): KnownStack[] {
  if (Date.now() - stacksCache.at > 10000) stacksCache = { at: Date.now(), list: knownStacks(readIndex()) };
  return stacksCache.list;
}
export function forgetStacks(): void {
  stacksCache.at = 0;
}

// Stacks the user created here live with their private config until they move one to a shared repo.
const PRIVATE_STACKS = path.join(CONFIG_DIR, 'stacks');
const privateStacks = () => {
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
    const stack = readJson<StackFile>(path.join(dir, 'stack.json'));
    const linked = readJson<{ url?: string }>(path.join(dir, '.source.json'))?.url;
    if (!stack || validateStack(stack).length) return [];
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
function writeSetup(index: Index): void {
  fs.mkdirSync(TEMP, { recursive: true });
  writeData('registry', { name: '', envs: ['dev'], apps: {}, setup: true, stacks: knownStacks(index) });
  writeData('local', { roots: index.roots, at: new Date().toISOString(), apps: {} });
  writeData('repos', { roots: index.roots.map(tilde), stack: null, repos: candidateRepos(index, { apps: {} }, null) });
}

/** Copies the stack and resolves each app to a clone from the index; branch and changes are read fresh every time. */
function syncStack(stackDir: string, index: Index): void {
  const source = path.join(stackDir, 'stack.json');
  const stack = readJson<StackFile>(source) ?? fail(`cannot read ${source}`);
  const errors = validateStack(stack);
  if (errors.length) fail(`${source} is invalid:\n  ${errors.join('\n  ')}`);
  fs.mkdirSync(TEMP, { recursive: true });
  // A copy of the stack file; `source` says which, and that is the one to edit.
  writeData('registry', { ...stack, source });
  const count = String(Object.keys(stack.apps).length);
  console.log(`STACK ${stack.name ?? tilde(stackDir)}: ${count} apps from ${tilde(source)}`);

  const local: Record<string, Clone | null> = {};
  const here = index.repos.filter(repo => fs.existsSync(repo.path));
  // Every clone that publishes a package (Dart or npm), so an app can use the local copy of a library it depends on.
  const packages = here.flatMap((repo): Library[] => {
    const published = packageOf(repo.path);
    return published ? [{ path: repo.path, ...published }] : [];
  });
  for (const [id, app] of Object.entries(stack.apps)) {
    local[id] = null;
    // An outside system has nothing to clone.
    if (app.outside) continue;
    const slug = app.slug ?? '';
    const paths = here.filter(repo => repo.keys.some(key => slugMatches(slug, key))).map(repo => repo.path);
    const [clone, ...others] = paths.sort((a, b) => a.length - b.length);
    if (!clone) {
      const host = slug.split('/')[0]?.includes('.') ? '' : 'github.com/';
      console.log(`MISSING ${id}: git clone https://${host}${slug}.git (then koppler sync --rescan)`);
      continue;
    }
    const dirty = lines(git(clone, 'status', '--porcelain')).length;
    const libraries = librariesFor(clone, packages);
    const branch = git(clone, 'branch', '--show-current') || null;
    local[id] = { path: clone, branch, dirty, branches: branchesOf(clone), ...(libraries.length && { libraries }) };
    const also = others.length ? ` (also: ${others.map(tilde).join(', ')})` : '';
    console.log(`OK ${id}: ${tilde(clone)} [${branch ?? 'detached'}]${dirty ? ` dirty=${String(dirty)}` : ''}${also}`);
  }
  writeData('repos', {
    roots: index.roots.map(tilde),
    stack: tilde(stackDir),
    repos: candidateRepos(index, stack, stackDir),
  });
  writeData('local', { roots: index.roots, at: new Date().toISOString(), apps: local });

  // An empty `consumes` means nobody has mapped that app yet, not that it calls nothing: look in every clone.
  const found = missingCalls(stack, (id, hosts) => {
    const clone = local[id];
    return clone ? grepClone(clone.path, hosts) : [];
  });
  for (const [caller, calls] of Object.entries(found))
    for (const [callee, where] of Object.entries(calls))
      console.log(`FOUND ${caller} -> ${callee}, not in stack.json: ${where}`);
  const known = hostsByApp(stack);
  for (const [id, app] of Object.entries(stack.apps))
    if (!app.outside && !known[id]?.size && kindOf(app).serves)
      console.log(`UNKNOWN ${id}: no deployed address in stack.json, so calls to it cannot be found`);
  for (const [host, ids] of hostOwners(stack).shared)
    console.log(`SHARED ${host} is used by ${ids.join(' and ')}, so calls to it are not attributed`);
  writeData('registry', { ...stack, source, found });
}

/** What to do with a clone after fetching: fast-forward only a clean branch that is simply behind its upstream. */
export function updateAction({
  upstream,
  dirty,
  ahead,
  behind,
}: {
  upstream?: string | null;
  dirty?: number;
  ahead?: number;
  behind?: number;
}): 'no-upstream' | 'current' | 'diverged' | 'dirty' | 'fast-forward' {
  if (!upstream) return 'no-upstream';
  if (!behind) return 'current';
  if (ahead) return 'diverged';
  return dirty ? 'dirty' : 'fast-forward';
}

interface Ran {
  ok: boolean;
  out: string;
  err: string | undefined;
}
// No password prompts from a background fetch; a slow remote gives up after a minute.
const gitQuietly = (cwd: string, ...args: string[]) =>
  new Promise<Ran>(resolve => {
    const options = {
      cwd,
      encoding: 'utf8' as const,
      timeout: 60000,
      env: { ...process.env, GIT_TERMINAL_PROMPT: '0' },
    };
    execFile('git', args, options, (error, out, errOut) => {
      resolve({ ok: !error, out: out.trim(), err: (errOut || error?.message || '').trim().split('\n').pop() });
    });
  });

/**
 * Fetches every clone of the stack (all at once) and fast-forwards the checked-out branch where that loses nothing.
 * Never commits, stashes, discards or switches branches; uncommitted or diverged work is only reported.
 */
export async function updateClones(): Promise<void> {
  const local = readData('local');
  const all = (local?.['apps'] ?? {}) as Record<string, Clone | null>;
  const apps = Object.entries(all).flatMap(([id, clone]): [string, Clone][] => (clone?.path ? [[id, clone]] : []));
  if (!apps.length) return;
  console.log(`FETCH ${String(apps.length)} clones`);
  await Promise.all(
    apps.map(async ([id, clone]) => {
      const run = (...args: string[]) => gitQuietly(clone.path, ...args);
      const fetched = await run('fetch', '--prune', '--quiet');
      if (!fetched.ok) {
        console.log(`NOFETCH ${id}: ${fetched.err || 'git fetch failed'} (working from what is already on this Mac)`);
        return;
      }
      const upstream = (await run('rev-parse', '--abbrev-ref', '@{u}')).out || null;
      const counted = upstream ? (await run('rev-list', '--left-right', '--count', 'HEAD...@{u}')).out : '0 0';
      const [ahead = 0, behind = 0] = counted.split(/\s+/).map(Number);
      const dirty = lines((await run('status', '--porcelain')).out).length;
      const action = updateAction({ upstream, dirty, ahead, behind });
      const lag = `${String(clone.branch)} is ${String(behind)} behind`;
      if (action === 'fast-forward') {
        const merged = await run('merge', '--ff-only', '--quiet', '@{u}');
        console.log(
          merged.ok
            ? `UPDATED ${id}: ${String(clone.branch)} +${String(behind)} from ${String(upstream)}`
            : `BEHIND ${id}: ${lag} ${String(upstream)}, fast-forward failed: ${String(merged.err)}`,
        );
      } else if (action === 'dirty')
        console.log(`BEHIND ${id}: ${lag} ${String(upstream)}; not updated because of uncommitted changes`);
      else if (action === 'diverged')
        console.log(`BEHIND ${id}: ${lag} and ${String(ahead)} ahead of ${String(upstream)}; not updated (diverged)`);
      clone.branches = branchesOf(clone.path);
      clone.dirty = dirty;
    }),
  );
  writeData('local', { ...local, at: new Date().toISOString() });
}

const checkStack = (dir: string) => {
  if (!fs.existsSync(path.join(dir, 'stack.json'))) fail(`no stack.json in ${tilde(dir)}`);
};
const keepConfig: Save = () => undefined;
const SEVERAL =
  'Several stacks found. Pick one on the canvas (koppler init --pick), or: koppler init --stack <one of the folders above>';
const NONE =
  'No stack yet. Create one on the canvas (koppler init --pick), or point at an existing one: koppler init --stack <folder with stack.json>';

export function init(args: string[]): void {
  const flags = parseFlags(args);
  if (flags.stack) checkStack(flags.stack);
  const config = loadConfig();
  const usual = () => DEFAULT_ROOTS.map(expand).filter(dir => fs.existsSync(dir));
  const roots = flags.roots.length ? flags.roots : config.roots?.length ? config.roots : usual();
  if (!roots.length) fail('no folder to scan: koppler init --root <folder with your repos>');
  const depth = flags.depth ?? config.depth ?? DEFAULT_DEPTH;
  Object.assign(config, { roots, depth });
  const index = scan(roots, depth);

  const stacks = [...findStacks(index.repos), ...privateStacks()];
  for (const stack of stacks) console.log(`FOUND stack ${tilde(stack)}`);
  const [only] = stacks;
  if (flags.stack) setStack(config, flags.stack, keepConfig);
  else if (!config.stack && stacks.length === 1 && only) setStack(config, only, keepConfig);
  writeJson(CONFIG, config);

  if (!config.stack) {
    console.log(stacks.length ? SEVERAL : NONE);
    writeSetup(index);
    return;
  }
  checkStack(config.stack);
  console.log(`USING stack ${tilde(config.stack)} (change with --stack)`);
  syncStack(config.stack, index);
}

export function sync(args: string[]): void {
  const flags = parseFlags(args);
  const config = loadConfig();
  if (flags.stack) {
    checkStack(flags.stack);
    setStack(config, flags.stack, keepConfig);
  }
  if (flags.roots.length) config.roots = flags.roots;
  if (!config.stack) fail('no stack set yet: koppler init');
  fs.mkdirSync(TEMP, { recursive: true });
  writeJson(LOADING, { stack: config.stack, pid: process.pid });
  try {
    let index = readIndex();
    if (!index || flags.rescan || flags.roots.length) {
      if (!config.roots?.length) fail('no repos scanned yet: koppler init');
      index = scan(config.roots, config.depth ?? DEFAULT_DEPTH);
    }
    writeJson(CONFIG, config);
    syncStack(config.stack, index);
  } finally {
    fs.rmSync(LOADING, { force: true });
  }
  // A stack says what it needs when it loads: missing programs, and its own checks once they were approved.
  console.log('');
  checkLoadedStack();
}

/** `koppler use`: every stack on this Mac. */
export function stacksCommand(args: string[] = []): void {
  const here = currentStack();
  const list = knownStacks(readIndex());
  if (args.includes('--json')) {
    const shown = list.map(stack => ({
      name: stack.name,
      inUse: stack.dir === here,
      path: stack.path,
      apps: stack.apps,
      envs: stack.envs,
      shared: stack.shared,
      linked: !!stack.linked,
    }));
    console.log(JSON.stringify(shown, null, 2));
    return;
  }
  if (!list.length) console.log('No stack found on this Mac. Create one: koppler init --new "<name>" --envs qa,prod');
  for (const stack of list) {
    const kind = stack.linked ? 'linked from GitHub' : stack.shared ? 'shared' : 'private';
    const about = `${kind}, ${String(stack.apps)} apps, ${stack.envs.join('/')}`;
    console.log(`${stack.dir === here ? '*' : ' '} ${stack.name}  (${about})  ${stack.path}`);
  }
}
/** `koppler use <name or folder>`: switch to one (it must not have anything running). */
export function useCommand(args: string[]): void {
  const want = args.join(' ').trim();
  const list = knownStacks(readIndex());
  if (!want) fail('usage: koppler use <stack name or folder>');
  const folder = path.resolve(expand(want));
  const matches = list.filter(stack => stack.dir === folder || stack.name.toLowerCase() === want.toLowerCase());
  const [match] = matches;
  if (!match || matches.length !== 1)
    fail(
      matches.length
        ? `several stacks are called ${want}; use its folder: koppler use`
        : `no stack called ${want}; see: koppler use`,
    );
  const result = useStack(match.dir);
  if (result.error !== undefined) fail(result.error);
  console.log(`USING ${match.name} (${match.path})`);
  sync([]);
}
