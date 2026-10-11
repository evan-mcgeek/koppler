// Switches an app's clone to the branch the board asks for, the way the user chose on the card for uncommitted changes:
// set aside (stashed under a Koppler label, back on Stop) or taken along. Every switch is logged, so it can be undone.
// Usage: koppler switch <app> <branch> [--set-aside | --take-along]
//        koppler switch <app> --back
import fs from 'node:fs';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import { fail } from '../failure.ts';
import { readData } from '../data.ts';
import { updateActions, type Action, type CheckoutAction } from './actions.ts';

/** What a switch came to: what to tell the user, or why it did not happen. */
export type Outcome = { message: string; error?: undefined } | { error: string; message?: undefined };
/** What to do with uncommitted changes in the clone; null when the user has not said. */
export type Carry = 'set-aside' | 'take-along' | null;

interface GitFailure {
  status?: number;
  spawnargs?: string[];
  stderr?: string;
  message?: string;
}
const said = (failure: GitFailure) => (failure.stderr || failure.message || '').trim();
const git = (repo: string, ...args: string[]) =>
  execFileSync('git', ['-C', repo, ...args], { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] }).trim();
function tryGit(repo: string, ...args: string[]): { ok: boolean; out: string } {
  try {
    return { ok: true, out: git(repo, ...args) };
  } catch (error) {
    return { ok: false, out: said(error as GitFailure) };
  }
}
const firstLine = (text: string) => text.split('\n')[0] ?? '';
/** How many files the clone has changed and not committed, new ones included. */
const changed = (repo: string) => git(repo, 'status', '--porcelain').split('\n').filter(Boolean).length;
const changes = (count: number) => `${String(count)} uncommitted ${count === 1 ? 'change' : 'changes'}`;
const head = (repo: string) => git(repo, 'rev-parse', '--abbrev-ref', 'HEAD');
const named = (from: string, detached: boolean | undefined) => (detached ? `commit ${from.slice(0, 7)}` : from);
/** The stash entry Koppler made under this label, as git names it (stash@{n}). */
function stashOf(repo: string, label: string): string | undefined {
  const entries = git(repo, 'stash', 'list', '--format=%gd%x09%s').split('\n');
  return entries.map(line => line.split('\t')).find(([, subject]) => subject?.endsWith(label))?.[0];
}

/** A git failure nobody foresaw (the clone is gone, not a repository) is an answer, not a crash in the middle of a Stop. */
function safely(app: string, work: () => Outcome): Outcome {
  try {
    return work();
  } catch (error) {
    const failure = error as GitFailure;
    if (failure.status === undefined && failure.spawnargs === undefined) throw error;
    return { error: `${app}: ${said(failure).split('\n').pop() ?? ''}` };
  }
}

const isSwitch =
  (app: string, to?: string) =>
  (action: Action): action is CheckoutAction =>
    action.kind === 'checkout' && action.app === app && (to === undefined || action.to === to);
const forget = (logFile: string, app: string, to: string) => {
  updateActions(logFile, log => {
    const at = log.findLastIndex(isSwitch(app, to));
    if (at >= 0) log.splice(at, 1);
  });
};

export interface SwitchTo {
  app: string;
  repo: string;
  to: string;
  how: Carry;
  logFile: string;
}
export const switchTo = ({ app, repo, to, how, logFile }: SwitchTo): Outcome =>
  safely(app, () => {
    // A clone on a commit instead of a branch goes back to that commit.
    const detached = head(repo) === 'HEAD';
    const from = detached ? git(repo, 'rev-parse', 'HEAD') : head(repo);
    const was = named(from, detached);
    if (from === to) return { message: `${app} is already on ${to}` };
    const dirty = changed(repo);
    if (dirty && !how)
      return {
        error: `${app} has ${changes(dirty)} on ${was}: choose --set-aside or --take-along (the canvas asks this on the card)`,
      };
    const label = dirty && how === 'set-aside' ? `koppler: ${app} on ${was} while it runs ${to}` : null;
    // Logged before anything changes, so a crash part-way still leaves Stop an entry to undo.
    const entry: CheckoutAction = {
      kind: 'checkout',
      app,
      repo,
      from,
      to,
      ...(detached && { detached: true as const }),
      ...(label && { stash: label }),
      ...(dirty > 0 && how === 'take-along' && { carried: true as const }),
    };
    updateActions(logFile, log => void log.push(entry));
    if (label) {
      const aside = tryGit(repo, 'stash', 'push', '--include-untracked', '-m', label);
      if (!aside.ok) {
        forget(logFile, app, to);
        return { error: `${app}'s changes could not be set aside: ${firstLine(aside.out)}` };
      }
    }
    const switched = tryGit(repo, 'switch', to);
    if (!switched.ok) {
      // What was set aside comes straight back; the entry goes once it has.
      const ref = label ? stashOf(repo, label) : undefined;
      const back = ref ? tryGit(repo, 'stash', 'pop', ref).ok : true;
      if (back) forget(logFile, app, to);
      const clash = how === 'take-along' && /overwritten|conflict/i.test(switched.out);
      const why = clash
        ? `${app}'s changes clash with ${to}; set them aside instead (--set-aside)`
        : `${app} could not switch to ${to}: ${firstLine(switched.out)}`;
      return { error: why + (back ? '' : `; your set-aside changes stay in the stash as "${label ?? ''}"`) };
    }
    const carried = label
      ? `, your ${changes(dirty)} ${dirty === 1 ? 'is' : 'are'} set aside until Stop`
      : dirty
        ? `, your ${changes(dirty)} came along`
        : '';
    return { message: `${app}: ${was} -> ${to}${carried}` };
  });

/**
 * Brings back what was set aside under `stash`, onto a clean clone only, so a clash can be undone without touching
 * anything else. Gives the words to add to the message, or the reason it could not.
 */
function restoreStash(app: string, repo: string, stash: string, was: string): { note: string } | { error: string } {
  const ref = stashOf(repo, stash);
  if (!ref) return { note: ', your set-aside changes were taken back already' };
  if (changed(repo))
    return {
      error: `${app} is back on ${was} with new changes; the ones set aside wait in the stash as "${stash}" (git stash pop, once these are committed)`,
    };
  const untracked = tryGit(repo, 'ls-tree', '-r', '--name-only', '-z', `${ref}^3`);
  if (tryGit(repo, 'stash', 'pop', ref).ok) return { note: ', your set-aside changes are back' };
  // Git leaves a clashing change half applied and keeps the stash. The clone goes back to clean; the changes stay in
  // the stash.
  git(repo, 'reset', '--hard', '-q');
  for (const file of untracked.ok ? untracked.out.split('\0').filter(Boolean) : [])
    fs.rmSync(path.join(repo, file), { force: true });
  return {
    error: `${app} is back on ${was}, but your set-aside changes clash with what it holds now. They are safe in the stash as "${stash}": take them back with git stash pop and settle the clash there`,
  };
}

/**
 * Undoes the app's latest switch. The entry leaves the log only once the clone is where it was and the set-aside
 * changes are back, so Stop can be run again.
 */
export const switchBack = ({ app, logFile }: { app: string; logFile: string }): Outcome =>
  safely(app, () => {
    const entry = updateActions(logFile, log => log.findLast(isSwitch(app)));
    if (!entry) return { message: `${app}: no branch switch to undo` };
    const { repo, from, to, stash, carried, detached } = entry;
    const was = named(from, detached);
    if (!fs.existsSync(repo))
      return { error: `${app}'s clone is no longer at ${repo}, so it could not be switched back to ${was}` };
    const there = detached ? head(repo) === 'HEAD' && git(repo, 'rev-parse', 'HEAD') === from : head(repo) === from;
    const now = head(repo);
    if (!there && now !== to) {
      // The user moved the clone on since: it stays where they put it, and the switch is no longer Koppler's to undo.
      forget(logFile, app, to);
      const where = now === 'HEAD' ? 'the commit you checked out' : now;
      const aside = stash ? `; your set-aside changes wait in the stash as "${stash}"` : '';
      return { message: `${app}: left on ${where}, where you moved it; not switched back to ${was}${aside}` };
    }
    if (!there) {
      const dirty = changed(repo);
      // Changes made while it ran stay the user's: switching over them is their call, unless they came along in the
      // first place.
      if (dirty && !carried)
        return {
          error: `${app} has ${String(dirty)} new uncommitted ${dirty === 1 ? 'change' : 'changes'} on ${to}; it stays there until they are committed or set aside`,
        };
      const switched = tryGit(repo, 'switch', ...(detached ? ['--detach'] : []), from);
      if (!switched.ok) return { error: `${app} could not switch back to ${was}: ${firstLine(switched.out)}` };
    }
    const restored = stash ? restoreStash(app, repo, stash, was) : { note: '' };
    if ('error' in restored) return restored;
    forget(logFile, app, to);
    return { message: `${app}: back on ${was}${restored.note}` };
  });

/** The clone of an app on this machine, as the last sync found it. */
function cloneOf(app: string): string | undefined {
  const apps = readData('local')?.['apps'] as Record<string, { path?: string } | null> | undefined;
  return apps?.[app]?.path;
}

export function switchCommand(args: string[], { temp }: { temp: string }): void {
  const [app, to] = args.filter(arg => !arg.startsWith('--'));
  if (!app) fail('usage: koppler switch <app> <branch> [--set-aside | --take-along] | koppler switch <app> --back');
  const logFile = path.join(temp, 'actions.json');
  let outcome: Outcome;
  if (args.includes('--back')) outcome = switchBack({ app, logFile });
  else {
    const repo = cloneOf(app) ?? fail(`${app} has no clone on this Mac (koppler sync)`);
    if (!to) fail('usage: koppler switch <app> <branch> [--set-aside | --take-along]');
    const how: Carry = args.includes('--set-aside') ? 'set-aside' : args.includes('--take-along') ? 'take-along' : null;
    outcome = switchTo({ app, repo, to, how, logFile });
  }
  if (outcome.error !== undefined) fail(outcome.error);
  console.log(outcome.message);
}
