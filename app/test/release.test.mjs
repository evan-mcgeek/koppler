import './sandbox.mjs';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { test } from 'node:test';
import { fileURLToPath } from 'node:url';

const script = path.join(path.dirname(fileURLToPath(import.meta.url)), '..', 'scripts', 'release.mjs');

test('npm run release bumps app/, commits and tags it on main, and pushes both; it refuses anything else', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'koppler-release-'));
  const origin = path.join(dir, 'origin.git'), repo = path.join(dir, 'repo'), app = path.join(repo, 'app');
  const git = (cwd, ...args) => spawnSync('git', args, { cwd, encoding: 'utf8' });
  git(dir, 'init', '--quiet', '--bare', '-b', 'main', origin);
  git(dir, 'clone', '--quiet', origin, repo);
  fs.mkdirSync(path.join(app, 'scripts'), { recursive: true });
  fs.copyFileSync(script, path.join(app, 'scripts', 'release.mjs'));
  fs.writeFileSync(path.join(app, 'package.json'), JSON.stringify({ name: 'koppler', version: '0.0.1' }, null, 2));
  fs.writeFileSync(path.join(app, 'package-lock.json'), JSON.stringify({ name: 'koppler', version: '0.0.1', lockfileVersion: 3, packages: { '': { name: 'koppler', version: '0.0.1' } } }, null, 2));
  for (const args of [['config', 'user.email', 't@acme.example'], ['config', 'user.name', 'T'], ['config', 'commit.gpgsign', 'false'], ['config', 'tag.gpgsign', 'false'], ['add', '-A'], ['commit', '--quiet', '-m', 'first'], ['push', '--quiet', 'origin', 'main']]) git(repo, ...args);
  const release = (...args) => spawnSync(process.execPath, ['scripts/release.mjs', ...args], { cwd: app, encoding: 'utf8' });

  assert.match(release('sideways').stderr, /usage/);
  fs.writeFileSync(path.join(app, 'notes.txt'), 'draft');
  git(repo, 'add', 'app/notes.txt');
  assert.match(release('patch').stderr, /not committed/);
  git(repo, 'rm', '--quiet', '--cached', 'app/notes.txt');
  fs.rmSync(path.join(app, 'notes.txt'));
  git(repo, 'switch', '--quiet', '-c', 'side');
  assert.match(release('patch').stderr, /made from main/);
  git(repo, 'switch', '--quiet', 'main');

  const done = release('patch');
  assert.equal(done.status, 0, done.stderr);
  assert.match(done.stdout, /v0\.0\.2 pushed/);
  assert.equal(JSON.parse(fs.readFileSync(path.join(app, 'package.json'), 'utf8')).version, '0.0.2');
  assert.equal(git(origin, 'log', '-1', '--format=%s', 'main').stdout.trim(), 'Koppler 0.0.2');
  assert.equal(git(origin, 'rev-parse', 'v0.0.2^{commit}').stdout.trim(), git(origin, 'rev-parse', 'main').stdout.trim());
  assert.equal(git(repo, 'status', '--porcelain').stdout, '');
});
