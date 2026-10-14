import assert from 'node:assert/strict';
import { execFileSync, spawnSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { test } from 'node:test';
import { fileURLToPath } from 'node:url';

const entry = path.join(path.dirname(fileURLToPath(import.meta.url)), '..', 'dist', 'koppler.mjs');

test('koppler init with no stack anywhere says how to start one, and reports no apps it does not have', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'koppler-init-'));
  const repo = path.join(dir, 'code', 'acme-web');
  fs.mkdirSync(repo, { recursive: true });
  execFileSync('git', ['init', '-q', repo]);
  execFileSync('git', ['-C', repo, 'remote', 'add', 'origin', 'git@github.com:acme/acme-web.git']);
  const env = {
    ...process.env,
    HOME: dir,
    KOPPLER_STATE: path.join(dir, 'state'),
    KOPPLER_CONFIG_DIR: path.join(dir, 'config'),
  };
  const run = spawnSync('node', [entry, 'init', '--root', path.join(dir, 'code'), '--no-fetch'], { encoding: 'utf8', env });
  assert.equal(run.status, 0, run.stderr);
  assert.match(run.stdout, /koppler init --new "<name>" --envs/);
  assert.match(run.stdout, /koppler link /);
  assert.doesNotMatch(run.stdout, /APP\s+KIND/);
  assert.doesNotMatch(run.stdout, /suggestions/);
  fs.rmSync(dir, { recursive: true, force: true });
});
