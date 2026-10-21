import './sandbox.mjs';
import assert from 'node:assert/strict';
import { spawn, spawnSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
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

test('installed inside another git repo, --version names no commit; run from its own clone, it does', () => {
  const host = fs.mkdtempSync(path.join(os.tmpdir(), 'koppler-host-'));
  try {
    const git = (...args) => spawnSync('git', ['-C', host, ...args], { encoding: 'utf8' });
    git('init', '-q');
    git('-c', 'user.email=a@example.com', '-c', 'user.name=A', 'commit', '-q', '--allow-empty', '-m', 'host');
    const installed = path.join(host, 'lib', 'node_modules', 'koppler');
    fs.mkdirSync(installed, { recursive: true });
    fs.cpSync(path.join(app, 'dist'), path.join(installed, 'dist'), { recursive: true });
    fs.copyFileSync(path.join(app, 'package.json'), path.join(installed, 'package.json'));
    fs.symlinkSync(path.join(app, 'node_modules'), path.join(installed, 'node_modules'));
    const ran = spawnSync(process.execPath, [path.join(installed, 'dist', 'koppler.mjs'), '--version'], { encoding: 'utf8' });
    assert.match(ran.stdout, /^koppler \d+\.\d+\.\d+\n$/);
    const own = spawnSync(process.execPath, [path.join(app, 'dist', 'koppler.mjs'), '--version'], { encoding: 'utf8' });
    assert.match(own.stdout, /^koppler \d+\.\d+\.\d+ \([0-9a-f]{7,}\)\n$/);
  } finally {
    fs.rmSync(host, { recursive: true, force: true });
  }
});
