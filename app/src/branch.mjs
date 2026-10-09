// Switches an app's clone to the branch the board asks for, the way the user chose on the card for uncommitted changes:
// set aside (stashed under a Koppler label, back on Stop) or taken along. Every switch is logged, so --back can undo it.
// Usage: koppler switch <app> <branch> [--set-aside | --take-along]
//        koppler switch <app> --back
import fs from 'node:fs';
import path from 'node:path';
import { execFileSync } from 'node:child_process';

const git = (repo, ...args) => execFileSync('git', ['-C', repo, ...args], { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] }).trim();
const tryGit = (repo, ...args) => { try { return { ok: true, out: git(repo, ...args) }; } catch (e) { return { ok: false, out: String(e.stderr || e.message).trim() }; } };
const readLog = file => { try { return JSON.parse(fs.readFileSync(file, 'utf8')); } catch { return []; } };
const writeLog = (file, log) => fs.writeFileSync(file, JSON.stringify(log, null, 2) + '\n', { mode: 0o600 });
const changed = repo => git(repo, 'status', '--porcelain').split('\n').filter(Boolean).length;
const stashOf = (repo, label) => git(repo, 'stash', 'list', '--format=%gd%x09%s').split('\n').map(l => l.split('\t')).find(([, s]) => s?.endsWith(label))?.[0];

export function switchTo({ app, repo, to, how, logFile }) {
  const from = git(repo, 'rev-parse', '--abbrev-ref', 'HEAD');
  if (from === to) return { message: `${app} is already on ${to}` };
  const dirty = changed(repo);
  if (dirty && !how) return { error: `${app} has ${dirty} uncommitted ${dirty === 1 ? 'change' : 'changes'} on ${from}: choose --set-aside or --take-along (the canvas asks this on the card)` };
  const label = dirty && how === 'set-aside' ? `koppler: ${app} on ${from} while it runs ${to}` : null;
  if (label) git(repo, 'stash', 'push', '--include-untracked', '-m', label);
  const sw = tryGit(repo, 'switch', to);
  if (!sw.ok) {
    if (label) git(repo, 'stash', 'pop', stashOf(repo, label));
    return { error: how === 'take-along' && /overwritten|conflict/i.test(sw.out) ? `${app}'s changes clash with ${to}; set them aside instead (--set-aside)` : `${app} could not switch to ${to}: ${sw.out.split('\n')[0]}` };
  }
  writeLog(logFile, [...readLog(logFile), { kind: 'checkout', app, repo, from, to, ...(label && { stash: label }), ...(dirty && how === 'take-along' && { carried: true }) }]);
  return { message: `${app}: ${from} -> ${to}${label ? `, your ${dirty} uncommitted ${dirty === 1 ? 'change is' : 'changes are'} set aside until Stop` : dirty ? `, your ${dirty} uncommitted ${dirty === 1 ? 'change came' : 'changes came'} along` : ''}` };
}

export function switchBack({ app, logFile }) {
  const log = readLog(logFile), i = log.findLastIndex(a => a.kind === 'checkout' && a.app === app);
  if (i < 0) return { message: `${app}: no branch switch to undo` };
  const { repo, from, to, stash, carried } = log[i];
  const dirty = changed(repo);
  // Changes made while it ran stay the user's: switching over them is their call, unless they came along in the first place.
  if (dirty && !carried) return { error: `${app} has ${dirty} new uncommitted ${dirty === 1 ? 'change' : 'changes'} on ${to}; it stays there until they are committed or set aside` };
  const sw = tryGit(repo, 'switch', from);
  if (!sw.ok) return { error: `${app} could not switch back to ${from}: ${sw.out.split('\n')[0]}` };
  let note = '';
  if (stash) {
    const ref = stashOf(repo, stash);
    const pop = ref ? tryGit(repo, 'stash', 'pop', ref) : { ok: false, out: 'not found' };
    note = pop.ok ? ', your set-aside changes are back' : `; your set-aside changes are kept in the stash as "${stash}" (${pop.out.split('\n')[0]})`;
  }
  log.splice(i, 1); writeLog(logFile, log);
  return { message: `${app}: back on ${from}${note}` };
}

export function switchCommand(args, { load, fail, temp }) {
  const [app, to] = args.filter(a => !a.startsWith('--'));
  if (!app) fail('usage: koppler switch <app> <branch> [--set-aside | --take-along] | koppler switch <app> --back');
  const logFile = path.join(temp, 'actions.json');
  const r = args.includes('--back') ? switchBack({ app, logFile }) : (() => {
    const repo = load('local.js', 'LOCAL')?.apps?.[app]?.path ?? fail(`${app} has no clone on this Mac (koppler sync)`);
    if (!to) fail('usage: koppler switch <app> <branch> [--set-aside | --take-along]');
    return switchTo({ app, repo, to, how: args.includes('--set-aside') ? 'set-aside' : args.includes('--take-along') ? 'take-along' : null, logFile });
  })();
  if (r.error) fail(r.error);
  console.log(r.message);
}
