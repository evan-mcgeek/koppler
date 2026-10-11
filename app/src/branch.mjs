// Switches an app's clone to the branch the board asks for, the way the user chose on the card for uncommitted changes:
// set aside (stashed under a Koppler label, back on Stop) or taken along. Every switch is logged, so --back can undo it.
// Usage: koppler switch <app> <branch> [--set-aside | --take-along]
//        koppler switch <app> --back
import fs from 'node:fs';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import { updateActions } from './actions.mjs';
import { readData } from './data.ts';

const git = (repo, ...args) => execFileSync('git', ['-C', repo, ...args], { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] }).trim();
const tryGit = (repo, ...args) => { try { return { ok: true, out: git(repo, ...args) }; } catch (e) { return { ok: false, out: String(e.stderr || e.message).trim() }; } };
const changed = repo => git(repo, 'status', '--porcelain').split('\n').filter(Boolean).length;
const stashOf = (repo, label) => git(repo, 'stash', 'list', '--format=%gd%x09%s').split('\n').map(l => l.split('\t')).find(([, s]) => s?.endsWith(label))?.[0];

// A git failure nobody foresaw (the clone is gone, not a repository) is an answer, not a crash in the middle of a Stop.
const safely = (app, work) => { try { return work(); } catch (e) { if (e.status === undefined && e.spawnargs === undefined) throw e; return { error: `${app}: ${String(e.stderr || e.message).trim().split('\n').pop()}` }; } };
const head = repo => git(repo, 'rev-parse', '--abbrev-ref', 'HEAD');
const named = (from, detached) => detached ? `commit ${from.slice(0, 7)}` : from;

export const switchTo = ({ app, repo, to, how, logFile }) => safely(app, () => {
  // A clone on a commit instead of a branch goes back to that commit.
  const detached = head(repo) === 'HEAD', from = detached ? git(repo, 'rev-parse', 'HEAD') : head(repo), was = named(from, detached);
  if (from === to) return { message: `${app} is already on ${to}` };
  const dirty = changed(repo);
  if (dirty && !how) return { error: `${app} has ${dirty} uncommitted ${dirty === 1 ? 'change' : 'changes'} on ${was}: choose --set-aside or --take-along (the canvas asks this on the card)` };
  const label = dirty && how === 'set-aside' ? `koppler: ${app} on ${was} while it runs ${to}` : null;
  // Logged before anything changes, so a crash part-way still leaves Stop an entry to undo.
  const entry = { kind: 'checkout', app, repo, from, to, ...(detached && { detached: true }), ...(label && { stash: label }), ...(dirty && how === 'take-along' && { carried: true }) };
  updateActions(logFile, log => { log.push(entry); });
  const undo = () => updateActions(logFile, log => { const i = log.findLastIndex(a => a.kind === 'checkout' && a.app === app && a.to === to); if (i >= 0) log.splice(i, 1); });
  if (label) { const st = tryGit(repo, 'stash', 'push', '--include-untracked', '-m', label); if (!st.ok) { undo(); return { error: `${app}'s changes could not be set aside: ${st.out.split('\n')[0]}` }; } }
  const sw = tryGit(repo, 'switch', to);
  if (!sw.ok) {
    const ref = label && stashOf(repo, label), back = ref ? tryGit(repo, 'stash', 'pop', ref) : { ok: true };
    if (back.ok) undo();
    return { error: (how === 'take-along' && /overwritten|conflict/i.test(sw.out) ? `${app}'s changes clash with ${to}; set them aside instead (--set-aside)` : `${app} could not switch to ${to}: ${sw.out.split('\n')[0]}`) + (back.ok ? '' : `; your set-aside changes stay in the stash as "${label}"`) };
  }
  return { message: `${app}: ${was} -> ${to}${label ? `, your ${dirty} uncommitted ${dirty === 1 ? 'change is' : 'changes are'} set aside until Stop` : dirty ? `, your ${dirty} uncommitted ${dirty === 1 ? 'change came' : 'changes came'} along` : ''}` };
});

// The entry leaves the log only once the clone is where it was and the set-aside changes are back, so Stop can be run again.
export const switchBack = ({ app, logFile }) => safely(app, () => {
  const entry = updateActions(logFile, log => log.findLast(a => a.kind === 'checkout' && a.app === app));
  if (!entry) return { message: `${app}: no branch switch to undo` };
  const { repo, from, to, stash, carried, detached } = entry, was = named(from, detached);
  if (!fs.existsSync(repo)) return { error: `${app}'s clone is no longer at ${repo}, so it could not be switched back to ${was}` };
  const there = detached ? head(repo) === 'HEAD' && git(repo, 'rev-parse', 'HEAD') === from : head(repo) === from;
  if (!there) {
    const dirty = changed(repo);
    // Changes made while it ran stay the user's: switching over them is their call, unless they came along in the first place.
    if (dirty && !carried) return { error: `${app} has ${dirty} new uncommitted ${dirty === 1 ? 'change' : 'changes'} on ${to}; it stays there until they are committed or set aside` };
    const sw = tryGit(repo, 'switch', ...(detached ? ['--detach'] : []), from);
    if (!sw.ok) return { error: `${app} could not switch back to ${was}: ${sw.out.split('\n')[0]}` };
  }
  let note = '';
  const ref = stash && stashOf(repo, stash);
  if (stash && !ref) note = ', your set-aside changes were taken back already';
  else if (ref) {
    // Only onto a clean clone, so a clash can be undone without touching anything else.
    if (changed(repo)) return { error: `${app} is back on ${was} with new changes; the ones set aside wait in the stash as "${stash}" (git stash pop, once these are committed)` };
    const untracked = tryGit(repo, 'ls-tree', '-r', '--name-only', '-z', `${ref}^3`);
    if (!tryGit(repo, 'stash', 'pop', ref).ok) {
      // Git leaves a clashing change half applied and keeps the stash. The clone goes back to clean; the changes stay in the stash.
      git(repo, 'reset', '--hard', '-q');
      for (const file of untracked.ok ? untracked.out.split('\0').filter(Boolean) : []) fs.rmSync(path.join(repo, file), { force: true });
      return { error: `${app} is back on ${was}, but your set-aside changes clash with what it holds now. They are safe in the stash as "${stash}": take them back with git stash pop and settle the clash there` };
    }
    note = ', your set-aside changes are back';
  }
  updateActions(logFile, log => { const i = log.findLastIndex(a => a.kind === 'checkout' && a.app === app && a.to === to); if (i >= 0) log.splice(i, 1); });
  return { message: `${app}: back on ${was}${note}` };
});

export function switchCommand(args, { fail, temp }) {
  const [app, to] = args.filter(a => !a.startsWith('--'));
  if (!app) fail('usage: koppler switch <app> <branch> [--set-aside | --take-along] | koppler switch <app> --back');
  const logFile = path.join(temp, 'actions.json');
  const r = args.includes('--back') ? switchBack({ app, logFile }) : (() => {
    const repo = readData('local')?.apps?.[app]?.path ?? fail(`${app} has no clone on this Mac (koppler sync)`);
    if (!to) fail('usage: koppler switch <app> <branch> [--set-aside | --take-along]');
    return switchTo({ app, repo, to, how: args.includes('--set-aside') ? 'set-aside' : args.includes('--take-along') ? 'take-along' : null, logFile });
  })();
  if (r.error) fail(r.error);
  console.log(r.message);
}
