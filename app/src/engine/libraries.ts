// Local libraries: an app uses your clone of a library it depends on instead of the published one, without a change to
// any tracked file, and back again on Stop.
//   Dart / Flutter: a pubspec_overrides.yaml in the app with a path override (Dart reads it on top of pubspec.yaml).
//   npm: `npm install --no-save <path>` (package.json and the lockfile stay as they are; Stop reinstalls from them).
import fs from 'node:fs';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { readJson } from '../json-files.ts';
import { readActions, updateActions, type Action, type FileAction, type NpmLocalAction } from './actions.ts';

export type Ecosystem = 'dart' | 'npm';
/** A clone that publishes a package. */
export interface Library {
  name: string;
  path: string;
  ecosystem: Ecosystem;
}

const read = (file: string) => {
  try {
    return fs.readFileSync(file, 'utf8');
  } catch {
    return null;
  }
};
interface PackageJson {
  name?: string;
  dependencies?: Record<string, string>;
  devDependencies?: Record<string, string>;
}
const packageJson = (dir: string) => readJson(path.join(dir, 'package.json')) as PackageJson | null;

/** The package a clone publishes: its Dart package name or its npm name. */
export function packageOf(dir: string): { name: string; ecosystem: Ecosystem } | null {
  const dart = /^name:\s*([\w]+)\s*$/m.exec(read(path.join(dir, 'pubspec.yaml')) ?? '')?.[1];
  if (dart) return { name: dart, ecosystem: 'dart' };
  const npm = packageJson(dir)?.name;
  return npm ? { name: npm, ecosystem: 'npm' } : null;
}

/** The packages an app depends on, by name. */
export function dependenciesOf(dir: string): { ecosystem: Ecosystem; names: string[] } | null {
  const pubspec = read(path.join(dir, 'pubspec.yaml'));
  if (pubspec) {
    const names = new Set<string>();
    for (const section of ['dependencies', 'dev_dependencies', 'dependency_overrides']) {
      const block = new RegExp(`^${section}:\\s*\\n((?:[ \\t]+.*\\n?|\\s*\\n)*)`, 'm').exec(pubspec)?.[1] ?? '';
      for (const entry of block.matchAll(/^ {2}([\w]+):/gm)) if (entry[1]) names.add(entry[1]);
    }
    return { ecosystem: 'dart', names: [...names] };
  }
  const pkg = packageJson(dir);
  return pkg ? { ecosystem: 'npm', names: Object.keys({ ...pkg.dependencies, ...pkg.devDependencies }) } : null;
}

/** The libraries an app can use locally: clones that publish a package it depends on (other than itself). */
export function librariesFor(appDir: string, clones: Library[]): Library[] {
  const deps = dependenciesOf(appDir);
  if (!deps) return [];
  return clones
    .filter(clone => clone.path !== appDir && clone.ecosystem === deps.ecosystem && deps.names.includes(clone.name))
    .map(({ name, path: clonePath, ecosystem }) => ({ name, path: clonePath, ecosystem }));
}

const OVERRIDES = 'pubspec_overrides.yaml';
const MARK = '# Written by Koppler for a local run; Stop removes it.';
const SECTION = /^dependency_overrides:\s*$/m;

/** The overrides file with the local libraries in it, keeping what the user had there. */
function withOverrides(before: string | null, libraries: Library[]): string {
  const lines = libraries.map(library => `  ${library.name}:\n    path: ${library.path}`).join('\n');
  // A file Koppler wrote on an earlier run is replaced; the user's own is added to.
  const own = before && !before.includes(MARK) ? before : null;
  if (!own) return `${MARK}\ndependency_overrides:\n${lines}\n`;
  return SECTION.test(own)
    ? own.replace(SECTION, () => `dependency_overrides:\n${lines}`)
    : `${own.trimEnd()}\n\ndependency_overrides:\n${lines}\n`;
}

/** Points the app at the local libraries; returns the action-log entries that undo it. */
export function link(appId: string, appDir: string, libraries: Library[], logFile: string): Action[] {
  const log = readActions(logFile);
  const done: Action[] = [];
  // Each change is logged before it is made, so a crash part-way still leaves Stop an entry to undo.
  const record = (entry: Action) => {
    updateActions(logFile, list => void list.push(entry));
    done.push(entry);
  };
  const dart = libraries.filter(library => library.ecosystem === 'dart');
  const npm = libraries.filter(library => library.ecosystem === 'npm');
  if (dart.length > 0) {
    const file = path.join(appDir, OVERRIDES);
    const before = read(file);
    const text = withOverrides(before, dart);
    const logged = (action: Action): action is FileAction => action.kind === 'file' && action.file === file;
    // Stop puts back the file as it was before the first change of this run, if it still holds what Koppler wrote
    // last.
    if (!log.some(logged)) record({ kind: 'file', app: appId, file, before, after: text });
    else
      updateActions(logFile, list => {
        const entry = list.find(logged);
        if (entry) entry.after = text;
      });
    fs.writeFileSync(file, text);
  }
  if (npm.length > 0) {
    const names = npm.map(library => library.name);
    record({ kind: 'npm-local', app: appId, repo: appDir, packages: names });
    const installed = spawnSync('npm', ['install', '--no-save', ...npm.map(library => library.path)], {
      cwd: appDir,
      encoding: 'utf8',
    });
    if (installed.status !== 0) {
      const why = installed.stderr.trim().split('\n').pop() ?? '';
      throw new Error(`npm could not install the local ${names.join(', ')}: ${why}`);
    }
  }
  return done;
}

/** Undoes one entry from link(); returns what happened, in words. Throws when it would overwrite the user's edits. */
export function unlink(entry: FileAction | NpmLocalAction): string {
  if (entry.kind === 'npm-local') {
    const installed = spawnSync('npm', ['install'], { cwd: entry.repo, encoding: 'utf8' });
    if (installed.status !== 0) throw new Error(`npm install failed in ${entry.repo}`);
    return `published ${entry.packages.join(', ')} back`;
  }
  const name = path.basename(entry.file);
  const before = entry.before ?? null;
  const now = read(entry.file);
  if (now === before) return `${name} already as before`;
  if (entry.after !== undefined && now !== entry.after)
    throw new Error(`${name} changed since Koppler wrote it; take Koppler's lines out by hand`);
  if (before === null) fs.rmSync(entry.file, { force: true });
  else fs.writeFileSync(entry.file, before);
  return `${name} ${before === null ? 'removed' : 'restored'}`;
}
