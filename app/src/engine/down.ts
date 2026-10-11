// Stop and revert: stop what Koppler runs, undo the action log in reverse (code edits, env-file lines, launch profiles,
// then branches back with set-aside changes), and look for temporary edits nobody logged. What cannot be undone safely
// stays in the log and is listed for the agent.
import fs from 'node:fs';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import { isDeepStrictEqual } from 'node:util';
import { flagValue } from '../cli/output.ts';
import { fail, Failure } from '../failure.ts';
import { readData } from '../data.ts';
import { TEMP } from '../paths.ts';
import { appliedCommand } from './runs.ts';
import {
  readActions,
  updateActions,
  type Action,
  type CheckoutAction,
  type EditAction,
  type EnvFileAction,
  type NpmLocalAction,
  type ProfileAction,
} from './actions.ts';
import { switchBack } from './branch.ts';
import { unlink } from './libraries.ts';
import { records, stopOne } from './processes.ts';

/** What became of one logged change. */
type Undone =
  /** Undone, or needing nothing: the entry leaves the log. `said` is printed when there is something to say. */
  | { state: 'gone'; said?: string }
  /** Could not be undone safely: the entry stays, and the reason is listed. */
  | { state: 'left'; why: string }
  /** Handled after the others (a branch, an npm install): the entry stays for now. */
  | { state: 'later' };

const BOM = '﻿';
const reason = (error: unknown) => (error instanceof Error ? error.message : String(error));

/**
 * A changed JSON file as text, written the way the file was: its indent, line ends and byte order mark. When the
 * result holds what git has, it is git's own text, so the file is clean again.
 */
// ponytail: with the user's own uncommitted changes in the file, lists kept on one line are spread out; a text-level
// edit would keep those
function jsonTextLike(file: string, raw: string, json: unknown): string {
  try {
    const show = ['-C', path.dirname(file), 'show', `HEAD:./${path.basename(file)}`];
    const committed = execFileSync('git', show, { encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] });
    if (isDeepStrictEqual(JSON.parse(committed.replace(BOM, '')), json)) return committed;
  } catch {
    // Not in git, or not committed yet.
  }
  const indent = /\n([ \t]+)"/.exec(raw)?.[1] ?? '  ';
  const eol = raw.includes('\r\n') ? '\r\n' : '\n';
  const body = JSON.stringify(json, null, indent).replace(/\n/g, eol);
  return (raw.startsWith(BOM) ? BOM : '') + body + (raw.endsWith('\n') ? eol : '');
}

function undoEdit(action: EditAction): Undone {
  const body = fs.readFileSync(action.file, 'utf8');
  const times = body.split(action.after).length - 1;
  const name = path.basename(action.file);
  if (times === 1) {
    // As a function, so `$&` and the like in the text are put back as they are.
    fs.writeFileSync(
      action.file,
      body.replace(action.after, () => action.before),
    );
    return { state: 'gone', said: `reverted ${name}` };
  }
  if (times === 0 && body.includes(action.before)) return { state: 'gone', said: `${name} already as before` };
  const before = JSON.stringify(action.before).slice(0, 200);
  return { state: 'left', why: `${action.file} changed since Koppler edited it; put back by hand: ${before}` };
}

function undoEnvFile(action: EnvFileAction): Undone {
  // One line out per line added, the last one: a line of the user's own that reads the same stays.
  const rest = fs.readFileSync(action.file, 'utf8').split('\n');
  for (const line of [action.lines ?? []].flat()) {
    const at = rest.lastIndexOf(line);
    if (at >= 0) rest.splice(at, 1);
  }
  if (action.created && !rest.join('').trim()) fs.rmSync(action.file);
  else fs.writeFileSync(action.file, rest.join('\n'));
  return { state: 'gone', said: `removed Koppler's lines from ${path.basename(action.file)}` };
}

function undoProfile(action: ProfileAction): Undone {
  const raw = fs.readFileSync(action.file, 'utf8');
  const settings = JSON.parse(raw.replace(BOM, '')) as {
    profiles?: Record<string, { environmentVariables?: unknown }>;
  };
  const profile = settings.profiles?.[action.name];
  if (action.created) delete settings.profiles?.[action.name];
  else if (profile && action.previous) profile.environmentVariables = action.previous;
  fs.writeFileSync(action.file, jsonTextLike(action.file, raw, settings));
  return { state: 'gone', said: `${action.created ? 'removed' : 'restored'} launch profile ${action.name}` };
}

/** Undoes one logged change, or says why it could not or that it comes later. */
function undo(action: Action): Undone {
  switch (action.kind) {
    case 'edit':
      return undoEdit(action);
    case 'env-file':
      return undoEnvFile(action);
    case 'profile':
      return undoProfile(action);
    case 'file':
      try {
        return { state: 'gone', said: unlink(action) };
      } catch (error) {
        return { state: 'left', why: reason(error) };
      }
    // Branches go back last, once the edits on them are undone; packages are installed again after that, from the
    // lockfile that belongs to the branch.
    case 'checkout':
    case 'npm-local':
      return { state: 'later' };
    case 'process':
      if (!action.pid) return { state: 'gone' };
      try {
        process.kill(action.pid, 0);
      } catch {
        return { state: 'gone' };
      }
      return {
        state: 'left',
        why: `still running as pid ${String(action.pid)}; not started through koppler, so check it before stopping`,
      };
    case 'secret':
      return { state: 'gone' };
    default:
      return { state: 'left', why: `unknown change "${String((action as { kind?: unknown }).kind)}" in the log` };
  }
}

const same = (a: Action) => (b: Action) => JSON.stringify(a) === JSON.stringify(b);

/** Temporary edits nobody logged still carry their marker; one line per clone that has some. */
function unloggedEdits(): string[] {
  const clones = (readData('local')?.['apps'] ?? {}) as Record<string, { path?: string } | null>;
  // Written in two parts, so this file does not carry the marker itself.
  const marker = ['koppler:.*do not', 'commit'].join(' ');
  return Object.entries(clones).flatMap(([id, clone]) => {
    if (!clone?.path) return [];
    try {
      const found = execFileSync('git', ['-C', clone.path, 'grep', '-nE', marker], {
        encoding: 'utf8',
        stdio: ['ignore', 'pipe', 'ignore'],
      });
      const hits = found.trim().split('\n').filter(Boolean).slice(0, 10);
      return hits.length > 0 ? [`${id}: unlogged temporary edits:\n    ${hits.join('\n    ')}`] : [];
    } catch {
      // git grep exits 1 when it finds nothing.
      return [];
    }
  });
}

/**
 * `koppler down [--run <id>]`. Exits 3 when something is left for the agent; otherwise, with --run, the Stop is marked
 * done in the history.
 */
export async function down(args: string[]): Promise<void> {
  const logFile = path.join(TEMP, 'actions.json');
  for (const record of records().filter(r => r.name !== 'canvas')) console.log(await stopOne(record));
  fs.rmSync(path.join(TEMP, 'progress.json'), { force: true });
  let log: Action[];
  try {
    log = readActions(logFile);
  } catch (error) {
    fail(reason(error));
  }
  const apps = (readData('registry')?.['apps'] ?? {}) as Record<string, { name?: string } | undefined>;
  const name = (action: Action) => {
    const fallback =
      action.kind === 'process' ? (action.label ?? action.command) : 'repo' in action ? action.repo : undefined;
    return (action.app ? (apps[action.app]?.name ?? action.app) : fallback) ?? '';
  };
  const left: string[] = [];
  const keep: Action[] = [];
  for (const action of log.toReversed()) {
    let result: Undone;
    try {
      result = undo(action);
    } catch (error) {
      result = { state: 'left', why: `could not undo ${action.kind} (${reason(error)})` };
    }
    if (result.state === 'gone' && result.said) console.log(`${name(action)}: ${result.said}`);
    if (result.state === 'left') left.push(`${name(action)}: ${result.why}`);
    if (result.state !== 'gone') keep.push(action);
  }
  // What could not be undone stays; entries added meanwhile (another command, the agent) are kept too.
  const handled = new Set(log.map(action => JSON.stringify(action)));
  const kept = keep.toReversed();
  updateActions(logFile, list => {
    const added = list.filter(action => !handled.has(JSON.stringify(action)));
    list.splice(0, list.length, ...kept, ...added);
  });

  // switchBack takes each branch switch off the log as it succeeds.
  const stuck = new Set<string>();
  for (const action of keep.filter((a): a is CheckoutAction => a.kind === 'checkout')) {
    const outcome = switchBack({ app: action.app, logFile });
    if (outcome.error === undefined) console.log(outcome.message);
    else {
      left.push(outcome.error);
      stuck.add(action.app);
    }
  }
  for (const action of keep.filter((a): a is NpmLocalAction => a.kind === 'npm-local')) {
    if (action.app && stuck.has(action.app)) {
      left.push(
        `${name(action)}: run npm install once its branch is back, to get the published ${action.packages.join(', ')} again`,
      );
      continue;
    }
    try {
      console.log(`${name(action)}: ${unlink(action)}`);
      updateActions(logFile, list => {
        const at = list.findIndex(same(action));
        if (at >= 0) list.splice(at, 1);
      });
    } catch (error) {
      left.push(`${name(action)}: ${reason(error)}`);
    }
  }
  left.push(...unloggedEdits());
  if (left.length > 0) {
    console.log(`\nLeft for the agent:\n${left.map(line => `  - ${line}`).join('\n')}`);
    throw new Failure('', 3);
  }
  console.log('Stopped and reverted.');
  const run = flagValue(args, '--run');
  if (run) await appliedCommand([run]);
}
