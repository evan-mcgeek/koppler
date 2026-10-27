import './sandbox.mjs';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { test } from 'node:test';
import { fileURLToPath } from 'node:url';

const script = path.join(path.dirname(fileURLToPath(import.meta.url)), '..', 'scripts', 'release.mjs');

test('npm run release bumps app/ on a release branch from main and opens its pull request; it pushes nothing to main and refuses anything else', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'koppler-release-'));
  const origin = path.join(dir, 'origin.git'), repo = path.join(dir, 'repo'), app = path.join(repo, 'app');
  const bin = path.join(dir, 'bin'), asked = path.join(dir, 'gh-asked');
  const git = (cwd, ...args) => spawnSync('git', args, { cwd, encoding: 'utf8' });
  git(dir, 'init', '--quiet', '--bare', '-b', 'main', origin);
  git(dir, 'clone', '--quiet', origin, repo);
  fs.mkdirSync(path.join(app, 'scripts'), { recursive: true });
  fs.copyFileSync(script, path.join(app, 'scripts', 'release.mjs'));
  fs.writeFileSync(path.join(app, 'package.json'), JSON.stringify({ name: 'koppler', version: '0.0.1' }, null, 2));
  fs.writeFileSync(path.join(app, 'package-lock.json'), JSON.stringify({ name: 'koppler', version: '0.0.1', lockfileVersion: 3, packages: { '': { name: 'koppler', version: '0.0.1' } } }, null, 2));
  for (const args of [['config', 'user.email', 't@acme.example'], ['config', 'user.name', 'T'], ['config', 'commit.gpgsign', 'false'], ['add', '-A'], ['commit', '--quiet', '-m', 'first'], ['push', '--quiet', 'origin', 'main']]) git(repo, ...args);
  // A stand-in for the GitHub CLI: it records the pull request it is asked for and answers with its address.
  fs.mkdirSync(bin);
  fs.writeFileSync(path.join(bin, 'gh'), `#!/bin/sh\nprintf '%s\\n' "$@" > "${asked}"\necho https://github.com/acme/koppler/pull/7\n`, { mode: 0o755 });
  const env = { ...process.env, PATH: `${bin}:${process.env.PATH}` };
  const release = (...args) => spawnSync(process.execPath, ['scripts/release.mjs', ...args], { cwd: app, env, encoding: 'utf8' });
  const main = git(origin, 'rev-parse', 'main').stdout.trim();

  assert.match(release('sideways').stderr, /usage/);
  fs.writeFileSync(path.join(app, 'notes.txt'), 'draft');
  git(repo, 'add', 'app/notes.txt');
  assert.match(release('patch').stderr, /not committed/);
  git(repo, 'rm', '--quiet', '--cached', 'app/notes.txt');
  fs.rmSync(path.join(app, 'notes.txt'));

  // From any branch: the bump starts from main as it is on GitHub.
  git(repo, 'switch', '--quiet', '-c', 'side');
  const done = release('patch');
  assert.equal(done.status, 0, done.stderr);
  assert.match(done.stdout, /pull\/7\nMerge it to release 0\.0\.2\./);
  assert.equal(git(origin, 'rev-parse', 'main').stdout.trim(), main);
  assert.equal(git(origin, 'tag').stdout, '');
  assert.equal(git(origin, 'log', '-1', '--format=%s', 'release/0.0.2').stdout.trim(), 'Koppler 0.0.2');
  assert.equal(git(origin, 'rev-parse', 'release/0.0.2^').stdout.trim(), main);
  assert.equal(JSON.parse(git(origin, 'show', 'release/0.0.2:app/package.json').stdout).version, '0.0.2');
  assert.deepEqual(fs.readFileSync(asked, 'utf8').split('\n').slice(0, 8), ['pr', 'create', '--base', 'main', '--head', 'release/0.0.2', '--title', 'Koppler 0.0.2']);
  assert.equal(git(repo, 'branch', '--show-current').stdout.trim(), 'side');
  assert.equal(git(repo, 'status', '--porcelain').stdout, '');
});
