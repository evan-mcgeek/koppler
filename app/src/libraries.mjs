// Local libraries: an app uses your clone of a library it depends on instead of the published one, without a change to
// any tracked file, and back again on Stop.
//   Dart / Flutter: a pubspec_overrides.yaml in the app with a path override (Dart reads it on top of pubspec.yaml).
//   npm: `npm install --no-save <path>` (package.json and the lockfile stay as they are; Stop reinstalls from them).
import fs from 'node:fs';
import path from 'node:path';
import { spawnSync } from 'node:child_process';

const read = file => { try { return fs.readFileSync(file, 'utf8'); } catch { return null; } };
const json = file => { try { return JSON.parse(read(file)); } catch { return null; } };

// The package a clone publishes: its Dart package name or its npm name.
export function packageOf(dir) {
  const pubspec = read(path.join(dir, 'pubspec.yaml'));
  const dart = pubspec?.match(/^name:\s*([\w]+)\s*$/m)?.[1];
  if (dart) return { name: dart, ecosystem: 'dart' };
  const npm = json(path.join(dir, 'package.json'))?.name;
  return npm ? { name: npm, ecosystem: 'npm' } : null;
}
// The packages an app depends on, by name.
export function dependenciesOf(dir) {
  const pubspec = read(path.join(dir, 'pubspec.yaml'));
  if (pubspec) {
    const names = new Set();
    for (const section of ['dependencies', 'dev_dependencies', 'dependency_overrides']) {
      const block = pubspec.match(new RegExp(`^${section}:\\s*\\n((?:[ \\t]+.*\\n?|\\s*\\n)*)`, 'm'))?.[1] ?? '';
      for (const m of block.matchAll(/^ {2}([\w]+):/gm)) names.add(m[1]);
    }
    return { ecosystem: 'dart', names: [...names] };
  }
  const pkg = json(path.join(dir, 'package.json'));
  return pkg ? { ecosystem: 'npm', names: Object.keys({ ...pkg.dependencies, ...pkg.devDependencies }) } : null;
}
// The libraries an app can use locally: clones that publish a package it depends on (other than itself).
export function librariesFor(appDir, clones) {
  const deps = dependenciesOf(appDir);
  if (!deps) return [];
  return clones.filter(c => c.path !== appDir && c.ecosystem === deps.ecosystem && deps.names.includes(c.name)).map(c => ({ name: c.name, path: c.path, ecosystem: c.ecosystem }));
}

const OVERRIDES = 'pubspec_overrides.yaml', MARK = '# Written by Koppler for a local run; Stop removes it.';
// Points the app at the local libraries; returns the action-log entries to undo it.
export function link(appId, appDir, libs, logFile) {
  const log = (() => { try { return JSON.parse(fs.readFileSync(logFile, 'utf8')); } catch { return []; } })(), done = [];
  const dart = libs.filter(l => l.ecosystem === 'dart'), npm = libs.filter(l => l.ecosystem === 'npm');
  if (dart.length) {
    const file = path.join(appDir, OVERRIDES), before = read(file);
    // The file as it was before the first change of this run is what Stop puts back.
    if (!log.some(a => a.kind === 'file' && a.file === file)) done.push({ kind: 'file', app: appId, file, before });
    const lines = dart.map(l => `  ${l.name}:\n    path: ${l.path}`).join('\n');
    const base = before && !before.includes(MARK) ? before : null;
    const text = base
      ? (/^dependency_overrides:\s*$/m.test(base) ? base.replace(/^dependency_overrides:\s*$/m, () => `dependency_overrides:\n${lines}`) : `${base.trimEnd()}\n\ndependency_overrides:\n${lines}\n`)
      : `${MARK}\ndependency_overrides:\n${lines}\n`;
    fs.writeFileSync(file, text);
  }
  if (npm.length) {
    const r = spawnSync('npm', ['install', '--no-save', ...npm.map(l => l.path)], { cwd: appDir, encoding: 'utf8' });
    if (r.status !== 0) throw new Error(`npm could not install the local ${npm.map(l => l.name).join(', ')}: ${(r.stderr || '').trim().split('\n').pop()}`);
    done.push({ kind: 'npm-local', app: appId, repo: appDir, packages: npm.map(l => l.name) });
  }
  fs.writeFileSync(logFile, JSON.stringify([...log, ...done], null, 2));
  return done;
}
// Undoes one entry from link(); returns what happened, in words.
export function unlink(entry) {
  if (entry.kind === 'file') {
    if (entry.before === null || entry.before === undefined) fs.rmSync(entry.file, { force: true }); else fs.writeFileSync(entry.file, entry.before);
    return `${path.basename(entry.file)} ${entry.before == null ? 'removed' : 'restored'}`;
  }
  if (entry.kind === 'npm-local') {
    const r = spawnSync('npm', ['install'], { cwd: entry.repo, encoding: 'utf8' });
    if (r.status !== 0) throw new Error(`npm install failed in ${entry.repo}`);
    return `published ${entry.packages.join(', ')} back`;
  }
  return null;
}
