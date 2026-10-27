// Copies of the repos of apps not cloned on this Mac, taken from GitHub with the user's gh login: only read, to find
// the calls in their code. Kept in Koppler's own folder, never among the user's clones.
import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { stateDir } from '../paths.ts';

/** owner/repo, each part a plain name: never a path out of the copies' folder, never read as an option. */
const SLUG = /^[\w][\w.-]*\/[\w][\w.-]*$/;

/** Where a repo's copy is kept. */
export const copyOf = (slug: string): string | null =>
  SLUG.test(slug) && !slug.split('/').includes('..') ? path.join(stateDir(), 'github', ...slug.split('/')) : null;

/**
 * The copy of a repo: taken, or brought up to date, when `fetch` is set; else the one there is, if any. Only the
 * newest commit of its default branch is kept. Null when there is none, or GitHub would not give it.
 */
export function githubCopy(slug: string, fetch: boolean): string | null {
  const dir = copyOf(slug);
  if (!dir) return null;
  const there = fs.existsSync(path.join(dir, '.git'));
  if (!fetch) return there ? dir : null;
  const run = (command: string, args: string[]) =>
    execFileSync(command, args, {
      stdio: 'ignore',
      timeout: 120_000,
      env: { ...process.env, GIT_TERMINAL_PROMPT: '0' },
    });
  try {
    if (there) {
      run('git', ['-C', dir, 'fetch', '--depth', '1', '--quiet', 'origin', 'HEAD']);
      run('git', ['-C', dir, 'reset', '--hard', '--quiet', 'FETCH_HEAD']);
    } else {
      fs.mkdirSync(path.dirname(dir), { recursive: true });
      run('gh', ['repo', 'clone', slug, dir, '--', '--depth', '1', '--quiet']);
    }
    return dir;
  } catch {
    return there ? dir : null;
  }
}
