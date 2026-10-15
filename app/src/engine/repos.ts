// Finds the git clones on this Mac (any host) and the stacks among them, and which clones could join a stack.
import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { writeJson } from '../json-files.ts';
import { detectKind } from './investigate.ts';
import { type Index, INDEX, type Repo, type StackFile, tilde } from './config.ts';

/** A clone that could join the stack, for the picker on the canvas. */
export interface Candidate {
  slug: string;
  name: string;
  kind: string | null;
  path: string;
  folder: string;
  inStack?: string;
}

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

export const DEFAULT_ROOTS = [
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

export const DEFAULT_DEPTH = 4;

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

export const git = (cwd: string, ...args: string[]) => execFileSync('git', args, { cwd, encoding: 'utf8' }).trim();

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

export const branchesOf = (repo: string) => {
  try {
    return branchList(
      git(repo, 'for-each-ref', '--sort=-committerdate', '--format=%(refname)', 'refs/heads', 'refs/remotes'),
    );
  } catch {
    return [];
  }
};

export function scan(roots: string[], depth: number): Index {
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
          kind: detectKind(repo.path, stack),
          path: tilde(repo.path),
          folder: tilde(path.dirname(repo.path)),
          ...(inStack && { inStack }),
        },
      ];
    })
    .sort((a, b) => a.folder.localeCompare(b.folder) || a.name.localeCompare(b.name));
}
