// Finding the repos behind the names in a description ("the wallet API", "push notification service"): the stack first,
// then the clones on this Mac (koppler init's index), then GitHub in the user's own organisations through their gh login.
// Several candidates or none is a question for the user, never a guess; nothing is cloned here.
// Usage: koppler discover --find "<name> [<name>...]" [--json] [--no-github]
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { readStack } from '../data.ts';
import { Failure } from '../failure.ts';
import { gh } from '../github.ts';
import { configDir } from '../paths.ts';

/** A repo that may be the one meant, and where it was found. */
interface Candidate {
  slug: string;
  where: 'stack' | 'clone' | 'github';
  score: number;
  app?: string;
  name?: string | undefined;
  path?: string;
  description?: string;
  pushed?: string | undefined;
  archived?: boolean | undefined;
}
interface Found {
  name: string;
  candidates: Candidate[];
}
/** The clones on this Mac, as `koppler init` indexed them. */
interface Index {
  repos?: { path: string; keys?: string[] }[];
}
interface SearchStack {
  apps?: Record<string, { name?: string; slug?: string | undefined }>;
}
interface GithubRepo {
  name: string;
  full_name: string;
  description?: string | null;
  pushed_at?: string;
  archived?: boolean;
}

const readIndex = (): Index | null => {
  try {
    return JSON.parse(fs.readFileSync(path.join(configDir(), 'repos.json'), 'utf8')) as Index | null;
  } catch {
    return null;
  }
};
const FILLER = ['the', 'a', 'an', 'api', 'app', 'service', 'svc'];
/**
 * "PushNotification-Service" and "push notification service" both become push / notification / service.
 * Plurals count as the word ("notifications" finds "notification").
 */
export const words = (text: string): string[] =>
  text
    .replace(/([a-z])([A-Z])/g, '$1 $2')
    .toLowerCase()
    .split(/[^a-z0-9]+/)
    .filter(word => word && !FILLER.includes(word))
    .map(word => (word.length > 3 ? word.replace(/(?<!s)s$/, '') : word));
/**
 * How well a repo name or app name matches: the share of the asked words it contains ("pushnotifications" has both
 * push and notification), with a small bonus for words standing on their own.
 */
export function score(asked: string, candidate: string): number {
  const want = words(asked);
  const have = words(candidate);
  const joined = have.join('');
  if (!want.length) return 0;
  const hits = want.filter(word => have.includes(word) || joined.includes(word)).length;
  const whole = want.filter(word => have.includes(word)).length;
  return Math.min(1, hits / want.length + (0.1 * whole) / want.length);
}
const slugOf = (key: string) =>
  key
    .replace(/^[^/]+\//, '')
    .replace(/\.git$/, '')
    .toLowerCase();

export async function find(
  names: string[],
  {
    registry: stack,
    index = readIndex(),
    github = true,
  }: { registry?: SearchStack | null; index?: Index | null; github?: boolean } = {},
): Promise<Found[] & { githubError?: string }> {
  const apps = Object.entries(stack?.apps ?? {});
  const clones = (index?.repos ?? []).flatMap(repo => {
    const [key] = repo.keys ?? [];
    return key && fs.existsSync(repo.path) ? [{ path: repo.path, slug: slugOf(key) }] : [];
  });
  const orgs = [...new Set(clones.map(clone => clone.slug.split('/')[0] ?? ''))].slice(0, 5);
  const out: Found[] & { githubError?: string } = [];
  for (const name of names) {
    // One entry per repo, whatever the case of its owner's name; the stack and a clone win over the same repo on GitHub.
    const found = new Map<string, Candidate>();
    const add = (slug: string, candidate: Omit<Candidate, 'slug'>) => {
      const key = slug.toLowerCase();
      const known = found.get(key);
      if (!known || candidate.score > known.score) found.set(key, { slug, ...known, ...candidate });
    };
    for (const [id, app] of apps) {
      const match = Math.max(score(name, app.name ?? id), score(name, app.slug ?? ''));
      if (match >= 0.5) add(app.slug ?? id, { where: 'stack', app: id, name: app.name, score: match + 0.01 });
    }
    for (const clone of clones) {
      const match = score(name, clone.slug.split('/').pop() ?? '');
      if (match >= 0.5 && !found.has(clone.slug)) add(clone.slug, { where: 'clone', path: clone.path, score: match });
    }
    if (github && orgs.length) {
      // Any of the words, in the name: the scoring above keeps only the repos that really match.
      const inOrgs = orgs.map(org => `org:${org}`).join(' ');
      const query = encodeURIComponent(`${words(name).join(' OR ')} in:name ${inOrgs} fork:true`);
      const searched = await gh([`search/repositories?q=${query}&per_page=8`]);
      if (!searched.ok) out.githubError = searched.err.split('\n')[0] ?? '';
      else
        for (const repo of (JSON.parse(searched.out) as { items?: GithubRepo[] }).items ?? []) {
          const match = score(name, repo.name);
          if (match < 0.5 || found.has(repo.full_name.toLowerCase())) continue;
          add(repo.full_name, {
            where: 'github',
            description: (repo.description ?? '').slice(0, 140),
            pushed: repo.pushed_at?.slice(0, 10),
            archived: repo.archived,
            score: match,
          });
        }
    }
    // Best match first; an archived repo is rarely the one meant, and of equals the more recently changed wins.
    const rank = (candidate: Candidate) => candidate.score - (candidate.archived ? 0.3 : 0);
    const best = [...found.values()].sort(
      (a, b) => rank(b) - rank(a) || (b.pushed ?? '').localeCompare(a.pushed ?? ''),
    );
    out.push({ name, candidates: best.slice(0, 6) });
  }
  return out;
}

const whereOf = (candidate: Candidate) => {
  if (candidate.where === 'stack') return `in the stack as ${String(candidate.app)}`;
  if (candidate.where === 'clone') return `cloned at ${(candidate.path ?? '').replace(os.homedir(), '~')}`;
  const changed = candidate.pushed ? `, last change ${candidate.pushed}` : '';
  const about = candidate.description ? `: ${candidate.description}` : '';
  return `on GitHub${changed}${candidate.archived ? ', archived' : ''}${about}; clone it only after the user says yes`;
};

export async function findCommand(args: string[]): Promise<void> {
  const names = args.filter(arg => !arg.startsWith('--'));
  if (!names.length) {
    console.error('usage: koppler discover --find "<name> [<name>...]" [--json] [--no-github]');
    throw new Failure('', 1);
  }
  const found = await find(names, { registry: readStack(), github: !args.includes('--no-github') });
  if (args.includes('--json')) {
    console.log(JSON.stringify(found, null, 2));
    return;
  }
  for (const { name, candidates } of found) {
    const count = candidates.length;
    const said =
      count === 1 ? 'one match' : count ? `${String(count)} candidates, ask which` : 'nothing found, ask the user';
    console.log(`\n${name}: ${said}`);
    for (const candidate of candidates) console.log(`  ${candidate.slug}  ${whereOf(candidate)}`);
  }
  if (found.githubError) console.log(`\n(GitHub was not searched: ${found.githubError})`);
}
