import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { packageOf, dependenciesOf, librariesFor, link, unlink } from './libraries.ts';
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
