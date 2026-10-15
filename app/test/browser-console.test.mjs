import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { test } from 'node:test';
import { fileURLToPath } from 'node:url';
import { allowStack } from './allow.mjs';

const entry = path.join(path.dirname(fileURLToPath(import.meta.url)), '..', 'dist', 'koppler.mjs');

test("a web app set to show its browser console gets the script line in its page while it runs, and Stop takes it out", () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'koppler-console-'));
  const repo = path.join(dir, 'web');
  fs.mkdirSync(repo);
  const page = '<!doctype html>\n<html>\n  <head>\n    <title>Shop</title>\n  </head>\n  <body></body>\n</html>\n';
  fs.writeFileSync(path.join(repo, 'index.html'), page);
  const env = { ...process.env, KOPPLER_STATE: dir, KOPPLER_TEMP: dir, KOPPLER_CONFIG_DIR: dir };
  const koppler = (...args) => spawnSync('node', [entry, ...args], { encoding: 'utf8', env });
  process.on('exit', () => koppler('stop', '--all', '--yes'));
  const stack = { envs: ['qa'], apps: { web: { name: 'Web', kind: 'other', start: 'exec sleep 60', browserConsole: { file: 'index.html' } } } };
  fs.writeFileSync(path.join(dir, 'registry.json'), JSON.stringify(stack));
  allowStack(dir, stack);
  fs.writeFileSync(path.join(dir, 'local.json'), JSON.stringify({ apps: { web: { path: repo } } }));
  fs.writeFileSync(path.join(dir, 'canvas-url'), 'http://127.0.0.1:4799/s/token/\n');

  const ran = koppler('run', 'web');
  assert.equal(ran.status, 0, ran.stdout + ran.stderr);
  assert.match(ran.stdout, /web: shows its browser console on its card/);
  const key = JSON.parse(fs.readFileSync(path.join(dir, 'console-keys.json'), 'utf8')).web;
  assert.match(key, /^[0-9a-f]{32}$/);
  const changed = fs.readFileSync(path.join(repo, 'index.html'), 'utf8');
  assert.ok(changed.includes(`<script src="http://127.0.0.1:4799/console.js?app=web&key=${key}"></script></head>`), changed);
  // Started again, it is not added twice.
  koppler('stop', 'web');
  koppler('run', 'web');
  assert.equal(fs.readFileSync(path.join(repo, 'index.html'), 'utf8').split('/console.js').length, 2);

  koppler('down');
  assert.equal(fs.readFileSync(path.join(repo, 'index.html'), 'utf8'), page);
});
