import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { test } from 'node:test';
import { fileURLToPath } from 'node:url';

const entry = path.join(path.dirname(fileURLToPath(import.meta.url)), '..', 'dist', 'koppler.mjs');

test("a shell opens in the app's clone with the settings its run gave it, and without a database there is no query", () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'koppler-shell-'));
  const repo = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'koppler-shell-repo-')));
  // A shell that only says where it is and what it was given.
  const shell = path.join(dir, 'fake-shell');
  fs.writeFileSync(shell, '#!/bin/sh\necho "in $(pwd) as $KOPPLER_APP on $KOPPLER_ENV, orders at $ORDERS_URL"\n', { mode: 0o755 });
  fs.writeFileSync(path.join(dir, 'registry.json'), JSON.stringify({ envs: ['qa', 'prod'], apps: { web: { name: 'Web', kind: 'node' } } }));
  fs.writeFileSync(path.join(dir, 'local.json'), JSON.stringify({ apps: { web: { path: repo } } }));
  fs.mkdirSync(path.join(dir, 'procs'));
  fs.writeFileSync(path.join(dir, 'procs', 'web.json'), JSON.stringify({ name: 'web', pid: 1, start: { setEnv: { ORDERS_URL: 'http://localhost:5001' } } }));
  const env = { ...process.env, KOPPLER_STATE: dir, KOPPLER_TEMP: dir, KOPPLER_CONFIG_DIR: dir, SHELL: shell };
  const koppler = (...args) => spawnSync('node', [entry, ...args], { encoding: 'utf8', env });
  const opened = koppler('shell', 'web');
  assert.equal(opened.status, 0, opened.stderr);
  assert.match(opened.stdout, /Web, in .+, with ORDERS_URL as its run sets them\. Its secrets are not here\./);
  assert.match(opened.stdout, new RegExp(`in ${repo} as web on qa, orders at http://localhost:5001`));
  assert.match(koppler('shell', 'web', '--env', 'prod', '--query').stderr, /Web has no Postgres connection among its secrets on PROD; for one query: koppler query web --env prod/);
  assert.match(koppler('shell', 'nope').stderr, /usage: koppler shell/);
});
