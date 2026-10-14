// Brings each clone up to date: fetches, and fast-forwards a clean branch that is only behind.
import { execFile } from 'node:child_process';
import { readData, writeData, type Clone } from '../data.ts';
import { lines } from './calls.ts';
import { branchesOf } from './repos.ts';

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
