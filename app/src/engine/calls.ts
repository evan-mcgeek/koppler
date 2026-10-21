// Which app calls which, found from the deployed addresses the stack knows and the text of each clone.
import { execFileSync } from 'node:child_process';
import { type AppFile, type StackFile } from './config.ts';

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
    // Apps built from the same repo share its code, so their addresses and calls are not this app's calls.
    const slug = app.slug?.toLowerCase();
    const repoApps = Object.entries(stack.apps).filter(
      ([id, other]) => id === caller || (slug && other.slug?.toLowerCase() === slug),
    );
    const hosts = [...unique].filter(([, owner]) => !repoApps.some(([id]) => id === owner)).map(([host]) => host);
    if (!hosts.length) continue;
    for (const line of grepRepo(caller, hosts)) {
      const host = hosts.find(one => line.toLowerCase().includes(one));
      const callee = host && unique.get(host);
      if (!callee || repoApps.some(([, other]) => other.consumes?.[callee]) || found[caller]?.[callee]) continue;
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

export const lines = (text: string) => text.split('\n').filter(Boolean);

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
