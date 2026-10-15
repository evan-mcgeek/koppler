import assert from 'node:assert/strict';
import { spawn, spawnSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { test } from 'node:test';
import { fileURLToPath } from 'node:url';

const app = path.join(path.dirname(fileURLToPath(import.meta.url)), '..');
const build = () =>
  new Promise(resolve => {
    const child = spawn(process.execPath, [path.join(app, 'scripts', 'build.mjs')], { stdio: 'ignore' });
    child.on('exit', resolve);
  });

test('two builds at once both finish, one after the other, and leave a Koppler that runs', async () => {
  assert.deepEqual(await Promise.all([build(), build()]), [0, 0]);
  assert.equal(fs.existsSync(path.join(app, 'dist.lock')), false);
  assert.equal(fs.existsSync(path.join(app, 'dist.next')), false);
  const ran = spawnSync(process.execPath, [path.join(app, 'dist', 'koppler.mjs'), '--version'], { encoding: 'utf8' });
  assert.match(ran.stdout, /^koppler /);
});
