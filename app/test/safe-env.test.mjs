import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { appEnv, clientEnv, findClient, loadsCode, takeSecrets } from '../dist/safe-env.mjs';
import { validateStack } from '../dist/sync.mjs';
import { allowStack } from './allow.mjs';

// An app started with its secrets keeps the caller's environment, minus what makes its runtime load other code.
const caller = { PATH: '/usr/bin', HOME: '/h', AWS_PROFILE: 'qa', NODE_OPTIONS: '--require ./leak.js', DOTNET_STARTUP_HOOKS: '/x.dll', DYLD_INSERT_LIBRARIES: '/x.dylib', BASH_ENV: '/x.sh', PGHOSTADDR: '127.0.0.1' };
const app = appEnv(caller);
assert.deepEqual(Object.keys(app.env).sort(), ['AWS_PROFILE', 'HOME', 'PATH', 'PGHOSTADDR']);
assert.deepEqual(app.dropped.sort(), ['BASH_ENV', 'DOTNET_STARTUP_HOOKS', 'DYLD_INSERT_LIBRARIES', 'NODE_OPTIONS']);

// A database client also loses everything that could send it elsewhere; only Koppler's own settings steer it.
const client = clientEnv({ PGPASSWORD: 'p', PGCONNECT_TIMEOUT: '10' }, { ...caller, PGSERVICEFILE: '/x', PGPASSWORD: 'theirs', MYSQL_HOST: 'evil', MYSQL_PWD: 'theirs' });
assert.deepEqual(Object.keys(client).sort(), ['AWS_PROFILE', 'HOME', 'PATH', 'PGCONNECT_TIMEOUT', 'PGPASSWORD']);
assert.equal(client.PGPASSWORD, 'p');

// A runner takes the stored secrets out of its environment, so the tools it starts do not carry them.
{
  const env = { PATH: '/usr/bin', DB_URL: 'db-not-real', API_KEY: 'key-not-real', KOPPLER_SECRET_NAMES: 'DB_URL API_KEY MISSING' };
  assert.deepEqual(takeSecrets(env), { DB_URL: 'db-not-real', API_KEY: 'key-not-real', MISSING: undefined });
  assert.deepEqual(env, { PATH: '/usr/bin', KOPPLER_SECRET_NAMES: 'DB_URL API_KEY MISSING' });
  assert.deepEqual(takeSecrets({ PATH: '/usr/bin' }), {});
}

// Clients come from where they are installed, never from a folder the caller put first on the PATH.
{
  const fake = fs.mkdtempSync(path.join(os.tmpdir(), 'koppler-fakebin-'));
  fs.writeFileSync(path.join(fake, 'psql'), '#!/bin/sh\nenv > /tmp/leak\n', { mode: 0o755 });
  const was = process.env.PATH; process.env.PATH = `${fake}:${was}`;
  assert.notEqual(findClient('psql', 'libpq'), path.join(fake, 'psql'));
  process.env.PATH = was;
}

assert.deepEqual(['NODE_OPTIONS', 'DYLD_LIBRARY_PATH', 'LD_PRELOAD', 'JAVA_TOOL_OPTIONS', 'ConnectionStrings__Db', 'API_URL'].map(loadsCode), [true, true, true, true, false, false]);

// The stack cannot name a secret or a cable setting after one of them.
{
  const st = extra => ({ envs: ['qa'], apps: { a: { name: 'A', kind: 'node', slug: 'acme/a', ...extra }, b: { name: 'B', kind: 'node', slug: 'acme/b' } } });
  assert.deepEqual(validateStack(st({ secrets: [{ env: 'DB_URL' }], consumes: { b: { how: 'env', env: 'B_URL' } } })), []);
  assert.match(validateStack(st({ secrets: [{ env: 'NODE_OPTIONS' }] })).join(), /NODE_OPTIONS/);
  assert.match(validateStack(st({ consumes: { b: { how: 'env', env: ['B_URL', 'PATH'] } } })).join(), /"PATH"/);
}

// End to end: started through koppler run, the app does not see the caller's NODE_OPTIONS.
{
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'koppler-safeenv-')), seen = path.join(dir, 'seen.txt');
  const env = { ...process.env, KOPPLER_STATE: dir, KOPPLER_TEMP: dir, KOPPLER_CONFIG_DIR: dir, KOPPLER_SECRETS: path.join(dir, 'secrets'), NODE_OPTIONS: '--max-old-space-size=256' };
  const koppler = (...args) => spawnSync('node', [path.join(path.dirname(fileURLToPath(import.meta.url)), '..', 'dist', 'koppler.mjs'), ...args], { encoding: 'utf8', env });
  fs.mkdirSync(path.join(dir, 'secrets'));
  fs.writeFileSync(path.join(dir, 'secrets', 'api.env'), 'export DB_URL=db-not-real\nexport API_KEY=key-not-real\n');
  const stack = { envs: ['qa'], apps: { api: { name: 'API', kind: 'other', start: `printf '%s' "\${NODE_OPTIONS:-none}" > ${seen}; printf '%s' "$KOPPLER_SECRET_NAMES" > ${seen}.names; exec sleep 30` } } };
  fs.writeFileSync(path.join(dir, 'registry.js'), `window.REGISTRY = ${JSON.stringify(stack)};`);
  fs.writeFileSync(path.join(dir, 'local.js'), `window.LOCAL = ${JSON.stringify({ apps: { api: { path: dir } } })};`);
  allowStack(dir, stack);
  const r = koppler('run', 'api');
  try {
    assert.equal(r.status, 0, r.stdout + r.stderr);
    assert.match(r.stdout, /left out of api's environment[^\n]*NODE_OPTIONS/);
    assert.equal(fs.readFileSync(seen, 'utf8'), 'none');
    // The app is told which of its variables are stored secrets, by name.
    assert.equal(fs.readFileSync(`${seen}.names`, 'utf8'), 'DB_URL API_KEY');
  } finally { koppler('stop', '--all', '--yes'); }
}
console.log('safe-env tests ok');
