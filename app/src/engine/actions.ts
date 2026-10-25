// The action log: every temporary change Koppler or the agent made, which Stop undoes. A lost entry is a change Stop
// can never undo, so the log is written whole (a temporary file, then a rename), under a lock, and a log that cannot
// be read is never taken as empty: Koppler keeps a copy and stops, so a person can repair it first.
import fs from 'node:fs';
import path from 'node:path';
import { writeJson } from '../json-files.ts';

/** A piece of text in a file was replaced by another. */
export interface EditAction {
  kind: 'edit';
  app?: string;
  file: string;
  before: string;
  after: string;
  /** Set when a remembered change of the stack made the edit. */
  recipe?: string;
}
/** A .NET launch profile was added, or its settings changed. */
export interface ProfileAction {
  kind: 'profile';
  app?: string;
  file: string;
  name: string;
  created?: boolean;
  /** The settings an existing profile had. */
  previous?: Record<string, string>;
}
/** Lines were added to a local env file. */
export interface EnvFileAction {
  kind: 'env-file';
  app?: string;
  file: string;
  lines?: string[] | string;
  /** Koppler made the file. */
  created?: boolean;
}
/** A file was written whole: a local library's overrides file, or a code change without a unique reverse edit. */
export interface FileAction {
  kind: 'file';
  app?: string;
  file: string;
  /** The file's text before the run; null when there was none. */
  before?: string | null;
  /** The text Koppler wrote last. */
  after?: string;
  /** Set when a remembered change of the stack made the edit. */
  recipe?: string;
}
/** Local libraries were installed over the published ones. */
export interface NpmLocalAction {
  kind: 'npm-local';
  app?: string;
  repo: string;
  packages: string[];
}
/** A clone was switched to another branch. */
export interface CheckoutAction {
  kind: 'checkout';
  app: string;
  repo: string;
  /** The branch it was on, or the commit when it was on none. */
  from: string;
  to: string;
  detached?: true;
  /** The label its uncommitted changes were set aside under. */
  stash?: string;
  /** Its uncommitted changes came along. */
  carried?: true;
}
/** Something started outside `koppler run`. */
export interface ProcessAction {
  kind: 'process';
  app?: string;
  label?: string;
  command?: string;
  pid?: number;
}
/** A secret was stored; only its name is ever logged. */
export interface SecretAction {
  kind: 'secret';
  app?: string;
  env?: string;
}
export type Action =
  | EditAction
  | ProfileAction
  | EnvFileAction
  | FileAction
  | NpmLocalAction
  | CheckoutAction
  | ProcessAction
  | SecretAction;

const pause = (ms: number) => Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, ms);
const missing = (error: unknown, code: string) => (error as NodeJS.ErrnoException).code === code;

/** The log as a list; empty when there is none yet. Throws, keeping a copy, when it cannot be read as one. */
export function readActions(file: string): Action[] {
  let text: string;
  try {
    text = fs.readFileSync(file, 'utf8');
  } catch (error) {
    if (missing(error, 'ENOENT')) return [];
    throw error;
  }
  if (!text.trim()) return [];
  let list: unknown = null;
  try {
    list = JSON.parse(text);
  } catch {
    // Reported below, with the copy.
  }
  if (Array.isArray(list)) return list as Action[];
  const copy = `${file}.damaged-${new Date().toISOString().replace(/[:.]/g, '-')}`;
  try {
    fs.copyFileSync(file, copy);
  } catch {
    // The log itself is still there.
  }
  throw new Error(
    `the action log ${file} is damaged, so Stop could not undo what it lists. A copy is kept at ${copy}. Repair the log (it is a JSON list) or move it away, then try again; nothing else was changed`,
  );
}

/**
 * Reads the log, lets `change` edit it, and writes it back, with no other writer in between. Returns what `change`
 * returned. A lock left by a process that died is taken over after 10 seconds.
 */
export function updateActions<T>(file: string, change: (list: Action[]) => T): T {
  const lock = `${file}.lock`;
  for (let waited = 0; ; waited += 50) {
    try {
      fs.mkdirSync(lock);
      break;
    } catch (error) {
      if (!missing(error, 'EEXIST')) throw error;
      const age = Date.now() - (fs.statSync(lock, { throwIfNoEntry: false })?.mtimeMs ?? Date.now());
      if (age > 10000) {
        fs.rmSync(lock, { recursive: true, force: true });
        continue;
      }
      if (waited > 10000)
        throw new Error(`the action log ${file} is busy (another Koppler command is writing it); try again`, {
          cause: error,
        });
      pause(50);
    }
  }
  try {
    const list = readActions(file);
    const result = change(list);
    writeJson(file, list);
    return result;
  } finally {
    fs.rmSync(lock, { recursive: true, force: true });
  }
}

/**
 * Writes a whole file Stop puts back: the text before the first write of the run is logged (null when there was no
 * file, which Stop then takes away), and the text written last, so Stop leaves alone a file changed since.
 */
export function writeLogged(logFile: string, app: string, file: string, text: string): void {
  let before: string | null = null;
  try {
    before = fs.readFileSync(file, 'utf8');
  } catch {
    // No file yet.
  }
  const logged = (action: Action): action is FileAction => action.kind === 'file' && action.file === file;
  updateActions(logFile, list => {
    const entry = list.find(logged);
    if (entry) entry.after = text;
    else list.push({ kind: 'file', app, file, before, after: text });
  });
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, text, { mode: 0o600 });
}
