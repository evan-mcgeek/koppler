// Local libraries: an app uses your clone of a library it depends on instead of the published one, without a change to
// any tracked file, and back again on Stop.
//   Dart / Flutter: a pubspec_overrides.yaml in the app with a path override (Dart reads it on top of pubspec.yaml).
//   npm: `npm install --no-save <path>` (package.json and the lockfile stay as they are; Stop reinstalls from them).
//   NuGet: a targets file in Koppler's own folder, given to `dotnet run`, swaps the package for the clone's project.
import fs from 'node:fs';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { readJson } from '../json-files.ts';
import { tempDir } from '../paths.ts';
import { readActions, updateActions, type Action, type FileAction, type NpmLocalAction } from './actions.ts';

export type Ecosystem = 'dart' | 'npm' | 'nuget';
/** A clone that publishes a package. */
export interface Library {
  name: string;
  path: string;
  ecosystem: Ecosystem;
  /** NuGet: the project inside the clone that makes the package. */
  project?: string;
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

const SKIP = new Set(['bin', 'obj', 'node_modules', '.git']);
/** The .NET projects in a folder, a few levels down. */
function projectsIn(dir: string, depth = 3): string[] {
  let entries: fs.Dirent[];
  try {
    entries = fs.readdirSync(dir, { withFileTypes: true });
  } catch {
    return [];
  }
  return entries.flatMap(entry => {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) return depth > 0 && !SKIP.has(entry.name) ? projectsIn(full, depth - 1) : [];
    return entry.name.endsWith('.csproj') ? [full] : [];
  });
}
const references = (text: string) =>
  [...text.matchAll(/<PackageReference\s[^>]*?\bInclude\s*=\s*"([^"]+)"/gi)].map(match => match[1] ?? '');

/** The NuGet packages a clone makes: each project but its tests and the ones marked not packable. */
export function nugetPackagesOf(dir: string): (Omit<Library, 'path'> & { project: string })[] {
  return projectsIn(dir).flatMap(project => {
    const text = read(project) ?? '';
    if (/<IsPackable>\s*false\s*</i.test(text) || references(text).includes('Microsoft.NET.Test.Sdk')) return [];
    const name = /<PackageId>\s*([^<\s]+)\s*<\/PackageId>/.exec(text)?.[1] ?? path.basename(project, '.csproj');
    return [{ name, ecosystem: 'nuget' as const, project }];
  });
}

/** The libraries an app can use locally: clones that publish a package it depends on (other than itself). */
export function librariesFor(appDir: string, clones: Library[]): Library[] {
  const deps = dependenciesOf(appDir);
  const picked: Library[] = deps
    ? clones
        .filter(clone => clone.path !== appDir && clone.ecosystem === deps.ecosystem && deps.names.includes(clone.name))
        .map(({ name, path: clonePath, ecosystem }) => ({ name, path: clonePath, ecosystem }))
    : [];
  // NuGet names ignore case; the app's own spelling is the one MSBuild removes.
  const nuget = projectsIn(appDir).flatMap(project => references(read(project) ?? ''));
  for (const clone of clones) {
    const used = nuget.find(name => name.toLowerCase() === clone.name.toLowerCase());
    if (clone.ecosystem === 'nuget' && clone.path !== appDir && used && clone.project)
      picked.push({ name: used, path: clone.path, ecosystem: 'nuget', project: clone.project });
  }
  return picked;
}

/** Where the targets file that swaps an app's NuGet packages for local projects is kept. */
export const libraryTargets = (appId: string): string => path.join(tempDir(), 'libraries', `${appId}.targets`);

const loggedTargets = (appId: string) => (action: Action) =>
  action.kind === 'file' && action.file === libraryTargets(appId);

/** The targets file this run linked for the app; one left without its log entry is stale, and removed. */
export function targetsFor(appId: string, logFile: string): string | undefined {
  const file = libraryTargets(appId);
  if (!fs.existsSync(file)) return undefined;
  if (readActions(logFile).some(loggedTargets(appId))) return file;
  fs.rmSync(file, { force: true });
  return undefined;
}

/** Takes away the app's targets file and its log entry: the board no longer asks for a local NuGet library. */
export function dropTargets(appId: string, logFile: string): void {
  if (!fs.existsSync(libraryTargets(appId)) && !readActions(logFile).some(loggedTargets(appId))) return;
  fs.rmSync(libraryTargets(appId), { force: true });
  updateActions(logFile, list => {
    const at = list.findIndex(loggedTargets(appId));
    if (at >= 0) list.splice(at, 1);
  });
}

const xml = (text: string) =>
  text.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
/** The targets file: in each project that references the package, the package goes and the clone's project comes. */
export function nugetTargets(libraries: Library[]): string {
  const swaps = libraries.map((library, at) => {
    const all = `_KopplerAll${String(at)}`;
    const others = `_KopplerOthers${String(at)}`;
    return [
      '  <ItemGroup>',
      `    <${all} Include="@(PackageReference)" />`,
      `    <${others} Include="@(PackageReference)" Exclude="${xml(library.name)}" />`,
      '  </ItemGroup>',
      `  <ItemGroup Condition="'@(${all})' != '@(${others})'">`,
      `    <PackageReference Remove="${xml(library.name)}" />`,
      `    <ProjectReference Include="${xml(library.project ?? '')}" />`,
      '  </ItemGroup>',
    ].join('\n');
  });
  return `<!-- Written by Koppler for a local run; Stop removes it. -->\n<Project>\n${swaps.join('\n')}\n</Project>\n`;
}

const OVERRIDES = 'pubspec_overrides.yaml';
const MARK = '# Written by Koppler for a local run; Stop removes it.';
const SECTION = /^dependency_overrides:[ \t]*\r?$/m;

/** The overrides file with the local libraries in it, keeping what the user had there. */
function withOverrides(before: string | null, libraries: Library[]): string {
  const block = before?.split(SECTION)[1]?.split(/^[^\s#]/m)[0] ?? '';
  const keys = [...block.matchAll(/^([ \t]+)["']?(\w+)["']?[ \t]*:/gm)];
  const indent = keys.length ? Math.min(...keys.map(match => match[1]?.length ?? 2)) : 2;
  const pad = ' '.repeat(indent);
  const lines = libraries.map(library => `${pad}${library.name}:\n${pad}  path: ${library.path}`).join('\n');
  if (!before) return `${MARK}\ndependency_overrides:\n${lines}\n`;
  if (/^["']?dependency_overrides["']?[ \t]*:/m.test(before) && !SECTION.test(before))
    throw new Error(`${OVERRIDES} needs a block-form dependency_overrides section to add local libraries`);
  const names = new Set(keys.filter(match => match[1]?.length === indent).map(match => match[2]));
  const conflict = libraries.find(library => names.has(library.name));
  if (conflict) throw new Error(`${OVERRIDES} already overrides ${conflict.name}; remove that override first`);
  return SECTION.test(before)
    ? before.replace(SECTION, () => `dependency_overrides:\n${lines}`)
    : `${before.trimEnd()}\n\ndependency_overrides:\n${lines}\n`;
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
  const nuget = libraries.filter(library => library.ecosystem === 'nuget');
  if (nuget.length > 0) {
    const file = libraryTargets(appId);
    const text = nugetTargets(nuget);
    const logged = log.find((action): action is FileAction => action.kind === 'file' && action.file === file);
    if (!logged) record({ kind: 'file', app: appId, file, before: null, after: text });
    else
      updateActions(logFile, list => {
        const entry = list.find(action => action.kind === 'file' && action.file === file);
        if (entry?.kind === 'file') entry.after = text;
      });
    fs.mkdirSync(path.dirname(file), { recursive: true, mode: 0o700 });
    fs.writeFileSync(file, text, { mode: 0o600 });
  }
  if (dart.length > 0) {
    const file = path.join(appDir, OVERRIDES);
    const logged = (action: Action): action is FileAction => action.kind === 'file' && action.file === file;
    const entry = log.find(logged);
    const now = read(file);
    if (entry && now !== entry.after && now !== (entry.before ?? null))
      throw new Error(`${OVERRIDES} changed since Koppler wrote it; take Koppler's lines out by hand`);
    const before = entry ? (entry.before ?? null) : now;
    const text = withOverrides(before, dart);
    // Stop puts back the file as it was before the first change of this run, if it still holds what Koppler wrote
    // last.
    if (!entry) record({ kind: 'file', app: appId, file, before, after: text });
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
