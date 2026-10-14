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

test('koppler add takes a clone into the stack in use, by its name or its folder', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'koppler-add-'));
  const code = path.join(dir, 'code');
  for (const name of ['acme-web', 'acme-orders']) {
    const repo = path.join(code, name);
    fs.mkdirSync(repo, { recursive: true });
    execFileSync('git', ['init', '-q', repo]);
    execFileSync('git', ['-C', repo, 'remote', 'add', 'origin', `git@github.com:acme/${name}.git`]);
    fs.writeFileSync(path.join(repo, 'package.json'), '{}');
  }
  const stack = path.join(dir, 'stack');
  fs.mkdirSync(stack);
  fs.writeFileSync(path.join(stack, 'stack.json'), JSON.stringify({ name: 'Acme', envs: ['qa'], apps: {} }));
  const env = { ...process.env, HOME: dir, KOPPLER_STATE: path.join(dir, 'state'), KOPPLER_CONFIG_DIR: path.join(dir, 'config') };
  const koppler = (...args) => spawnSync('node', [entry, ...args], { encoding: 'utf8', env });
  assert.equal(koppler('init', '--root', code, '--stack', stack, '--no-fetch').status, 0);
  const byName = koppler('add', 'acme-web');
  assert.equal(byName.status, 0, byName.stderr);
  assert.match(byName.stdout, /Added acme-web/);
  const byFolder = koppler('add', path.join(code, 'acme-orders'));
  assert.equal(byFolder.status, 0, byFolder.stderr);
  const apps = JSON.parse(fs.readFileSync(path.join(stack, 'stack.json'), 'utf8')).apps;
  assert.deepEqual(Object.keys(apps).sort(), ['acme-orders', 'acme-web']);
  fs.rmSync(dir, { recursive: true, force: true });
});
