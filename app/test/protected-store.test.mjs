import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { test } from 'node:test';

test('How the store creates a Keychain item decides who may read it: `-T ""` means every read asks the user, `-T /usr/bin/security` means anything running as the user reads it silently. A stand-in for the `security` program records what the store asks for; no real Keychain is touched.', async () => {
  const store = path.join(path.dirname(fileURLToPath(import.meta.url)), '..', 'bin', ['secret', 'store'].join('-'));
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'koppler-protected-')), asked = path.join(dir, 'asked.txt');
  fs.writeFileSync(path.join(dir, 'security'), `#!/bin/sh\nif [ "$1" = "-i" ]; then cat >> "${asked}"; fi\nexit 0\n`, { mode: 0o755 });
  const hasXxd = spawnSync('sh', ['-c', 'command -v xxd']).status === 0;

  const trustFor = (name, mark) => {
    fs.rmSync(asked, { force: true });
    const env = { ...process.env, PATH: `${dir}:${process.env.PATH}`, KOPPLER_SECRET_BACKEND: 'keychain', ...(mark !== undefined && { KOPPLER_SECRET_PROTECTED: mark }) };
    const r = spawnSync(store, ['set', name, 'DB_URL'], { input: 'value', env, encoding: 'utf8' });
    assert.equal(r.status, 0, r.stderr);
    return fs.readFileSync(asked, 'utf8').includes('-T ""') ? 'asks every read' : 'readable silently';
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
