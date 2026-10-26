import './sandbox.mjs';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { test } from 'node:test';

const hasXxd = spawnSync('sh', ['-c', 'command -v xxd']).status === 0;

test('How the store creates a Keychain item decides who may read it: `-T ""` means every read asks the user, `-T /usr/bin/security` means anything running as the user reads it silently. A stand-in for the `security` program records what the store asks for; no real Keychain is touched.', async () => {
  const store = path.join(path.dirname(fileURLToPath(import.meta.url)), '..', 'bin', ['secret', 'store'].join('-'));
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'koppler-protected-')), asked = path.join(dir, 'asked.txt');
  fs.writeFileSync(path.join(dir, 'security'), `#!/bin/sh\nif [ "$1" = "-i" ]; then cat >> "${asked}"; fi\nexit 0\n`, { mode: 0o755 });

  const trustFor = (name, mark) => {
    fs.rmSync(asked, { force: true });
    const env = { ...process.env, PATH: `${dir}:${process.env.PATH}`, KOPPLER_SECRET_BACKEND: 'keychain', ...(mark !== undefined && { KOPPLER_SECRET_PROTECTED: mark }) };
    const r = spawnSync(store, ['set', name, 'DB_URL'], { input: 'value', env, encoding: 'utf8' });
    assert.equal(r.status, 0, r.stderr);
    const command = fs.readFileSync(asked, 'utf8');
    assert.match(command, /^add-generic-password -s /);
    return command.includes('-T ""') ? 'asks every read' : 'readable silently';
  };

  if (hasXxd) {
    // Koppler says which stores are protected, from the stack: the name of the environment plays no part.
    assert.equal(trustFor('orders-api@staging', '1'), 'asks every read');
    assert.equal(trustFor('orders-api', '1'), 'asks every read');
    assert.equal(trustFor('orders-api@prod', '0'), 'readable silently');
    // Called on its own, every store of a named environment is protected; the first environment's is not.
    assert.equal(trustFor('orders-api@live-eu'), 'asks every read');
    assert.equal(trustFor('orders-api@prd'), 'asks every read');
    assert.equal(trustFor('orders-api'), 'readable silently');
  }
  console.log(hasXxd ? 'protected store tests ok' : 'protected store tests skipped: no xxd here');
});

test('a failed Keychain save says so, and a failed migration keeps its source even when an older target exists', { skip: !hasXxd }, () => {
  const store = path.join(path.dirname(fileURLToPath(import.meta.url)), '..', 'bin', 'secret-store');
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'koppler-keychain-failure-'));
  const kept = path.join(dir, 'kept'), asked = path.join(dir, 'asked');
  fs.writeFileSync(path.join(dir, 'security'), `#!/bin/sh
case "$1" in
  delete-generic-password)
    echo delete >> "$KOPPLER_FAKE_ASKED"
    [ "$KOPPLER_FAKE_DELETE_FAIL" = 1 ] && exit 1
    rm -f "$KOPPLER_FAKE_KEPT" ;;
  -i) cat >> "$KOPPLER_FAKE_ASKED"; exit 1 ;;
  find-generic-password) test -f "$KOPPLER_FAKE_KEPT" ;;
esac
`, { mode: 0o755 });
  const env = {
    ...process.env, PATH: `${dir}:${process.env.PATH}`, KOPPLER_SECRET_BACKEND: 'keychain',
    KOPPLER_SECRETS: dir, KOPPLER_FAKE_KEPT: kept, KOPPLER_FAKE_ASKED: asked,
  };
  try {
    fs.writeFileSync(kept, 'old-synthetic-value');
    const updated = spawnSync(store, ['set', 'orders-api', 'DB_URL'], { input: 'new-synthetic-value', env, encoding: 'utf8' });
    assert.notEqual(updated.status, 0);
    // The item is made afresh: the old one goes first, so a new access rule always applies.
    assert.match(fs.readFileSync(asked, 'utf8'), /^delete\nadd-generic-password -s /);
    fs.writeFileSync(kept, 'old-synthetic-value');

    const source = path.join(dir, 'orders-api.env');
    const value = 'export DB_URL=new-synthetic-value\n';
    fs.writeFileSync(source, value);
    const migrated = spawnSync(store, ['migrate'], { env: { ...env, KOPPLER_FAKE_DELETE_FAIL: '1' }, encoding: 'utf8' });
    assert.notEqual(migrated.status, 0);
    assert.equal(fs.readFileSync(source, 'utf8'), value);
    assert.equal(fs.readFileSync(kept, 'utf8'), 'old-synthetic-value');
    assert.match(migrated.stderr, /could not be moved; its file is kept/);
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});
