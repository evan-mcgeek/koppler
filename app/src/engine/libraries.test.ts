import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { packageOf, dependenciesOf, librariesFor, link, unlink } from './libraries.ts';
import { readActions } from './actions.ts';
import { test } from 'vitest';

test('local libraries are linked into an app and unlinked again', async () => {
  // An app that depends on a package you have cloned can use the clone; Stop puts everything back as it was.
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'koppler-libs-')),
    app = path.join(dir, 'app'),
    lib = path.join(dir, 'design'),
    other = path.join(dir, 'other');
  for (const d of [app, lib, other]) fs.mkdirSync(d);
  fs.writeFileSync(
    path.join(app, 'pubspec.yaml'),
    'name: mobile_app\ndependencies:\n  flutter:\n    sdk: flutter\n  acme_design:\n    git:\n      url: git@github.com:acme/acme_design.git\n      ref: v2.0.1\n  http: ^1.0.0\ndependency_overrides:\n  acme_design:\n    git:\n      url: git@github.com:acme/acme_design.git\n',
  );
  fs.writeFileSync(path.join(lib, 'pubspec.yaml'), 'name: acme_design\n');
  fs.writeFileSync(path.join(other, 'package.json'), '{"name":"@acme/ui"}');
  assert.deepEqual(packageOf(lib), { name: 'acme_design', ecosystem: 'dart' });
  assert.deepEqual(packageOf(other), { name: '@acme/ui', ecosystem: 'npm' });
  assert.deepEqual(dependenciesOf(app)!.names.sort(), ['acme_design', 'flutter', 'http']);
  const libs = librariesFor(app, [
    { path: lib, ...packageOf(lib) } as any,
    { path: other, ...packageOf(other) } as any,
    { path: app, ...packageOf(app) } as any,
  ]);
  assert.deepEqual(libs, [{ name: 'acme_design', path: lib, ecosystem: 'dart' }]);

  const logFile = path.join(dir, 'actions.json'),
    overrides = path.join(app, 'pubspec_overrides.yaml');
  const done = link('mobile-app', app, libs, logFile);
  assert.match(
    fs.readFileSync(overrides, 'utf8'),
    new RegExp(`dependency_overrides:\\n  acme_design:\\n    path: ${lib}`),
  );
  assert.equal((done[0] as any)!.before, null);
  assert.equal(unlink(done[0] as any), 'pubspec_overrides.yaml removed');
  assert.equal(fs.existsSync(overrides), false);
  // A file the developer already had keeps its own overrides and comes back exactly as it was.
  fs.writeFileSync(overrides, 'dependency_overrides:\n  http: ^1.1.0\n');
  const again = link('mobile-app', app, libs, path.join(dir, 'actions2.json'));
  assert.match(fs.readFileSync(overrides, 'utf8'), /acme_design:\n {4}path: .*\n {2}http: \^1\.1\.0/);
  unlink(again[0] as any);
  assert.equal(fs.readFileSync(overrides, 'utf8'), 'dependency_overrides:\n  http: ^1.1.0\n');
  fs.rmSync(dir, { recursive: true });
});

test.each([
  null,
  'dependency_overrides:\n  http: ^1.1.0\n',
  '# Written by Koppler for a local run; Stop removes it.\ndependency_overrides:\n  http: ^1.1.0\n',
])('relinking Dart libraries keeps one override and the first original file (%s)', before => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'koppler-relink-'));
  const file = path.join(dir, 'pubspec_overrides.yaml');
  const log = path.join(dir, 'actions.json');
  const library = { name: 'acme_design', path: '/libs/design', ecosystem: 'dart' as const };
  try {
    if (before !== null) fs.writeFileSync(file, before);
    link('app', dir, [library], log);
    const first = fs.readFileSync(file, 'utf8');
    if (before) assert.match(first, /http: \^1\.1\.0/);
    link('app', dir, [library], log);
    assert.equal(fs.readFileSync(file, 'utf8'), first);
    link('app', dir, [{ ...library, path: '/libs/other-design' }], log);
    assert.equal(fs.readFileSync(file, 'utf8').match(/acme_design:/g)?.length, 1);
    assert.match(fs.readFileSync(file, 'utf8'), /path: \/libs\/other-design/);
    const entries = readActions(log);
    assert.equal(entries.length, 1);
    const entry = entries[0];
    assert.ok(entry?.kind === 'file');
    assert.equal(entry.before, before);
    unlink(entry);
    assert.equal(fs.existsSync(file) ? fs.readFileSync(file, 'utf8') : null, before);
    // A file already restored by Stop can be linked again under the same log.
    link('app', dir, [library], log);
    assert.equal(fs.readFileSync(file, 'utf8'), first);
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test.each([null, 'dependency_overrides:\n  http: ^1.1.0\n'])(
  'relinking refuses edits to a Dart overrides file without changing it or the log (%s)',
  before => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'koppler-relink-edit-'));
    const file = path.join(dir, 'pubspec_overrides.yaml');
    const log = path.join(dir, 'actions.json');
    const libraries = [{ name: 'acme_design', path: '/libs/design', ecosystem: 'dart' as const }];
    try {
      if (before !== null) fs.writeFileSync(file, before);
      link('app', dir, libraries, log);
      fs.appendFileSync(file, '# My own changes\n');
      const changed = fs.readFileSync(file, 'utf8');
      const actions = fs.readFileSync(log, 'utf8');
      assert.throws(() => link('app', dir, libraries, log), /changed since Koppler wrote it/);
      assert.equal(fs.readFileSync(file, 'utf8'), changed);
      assert.equal(fs.readFileSync(log, 'utf8'), actions);
    } finally {
      fs.rmSync(dir, { recursive: true, force: true });
    }
  },
);

test.each([
  'dependency_overrides:\n  acme_design: ^1.0.0\n',
  'dependency_overrides:\n  "acme_design": ^1.0.0\n',
  "dependency_overrides:\n  'acme_design': ^1.0.0\n",
  'dependency_overrides: {http: ^1.1.0}\n',
  '# Written by Koppler for a local run; Stop removes it.\ndependency_overrides:\n  acme_design: ^1.0.0\n',
])('existing Dart overrides are never duplicated or discarded (%s)', before => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'koppler-override-conflict-'));
  const file = path.join(dir, 'pubspec_overrides.yaml');
  const log = path.join(dir, 'actions.json');
  try {
    fs.writeFileSync(file, before);
    assert.throws(() => link('app', dir, [{ name: 'acme_design', path: '/libs/design', ecosystem: 'dart' }], log));
    assert.equal(fs.readFileSync(file, 'utf8'), before);
    assert.deepEqual(readActions(log), []);
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test.each([
  'environment:\n  path: elsewhere\ndependency_overrides:\n  custom:\n    path: ../custom\nother:\n  path: elsewhere\n',
  'dependency_overrides:\n    custom:\n        path: ../custom\n',
  'environment:\n  path: elsewhere\n',
])('only direct keys of dependency_overrides conflict with a local Dart package (%s)', before => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'koppler-override-keys-'));
  const file = path.join(dir, 'pubspec_overrides.yaml');
  try {
    fs.writeFileSync(file, before);
    const [entry] = link(
      'app',
      dir,
      [{ name: 'path', path: '/libs/path', ecosystem: 'dart' }],
      path.join(dir, 'actions.json'),
    );
    const indent = before.includes('    custom:') ? '    ' : '  ';
    assert.ok(fs.readFileSync(file, 'utf8').includes(`${indent}path:\n${indent}  path: /libs/path\n`));
    assert.ok(entry?.kind === 'file');
    unlink(entry);
    assert.equal(fs.readFileSync(file, 'utf8'), before);
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});
