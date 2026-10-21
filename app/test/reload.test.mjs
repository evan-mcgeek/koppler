import './sandbox.mjs';
import assert from 'node:assert/strict';
import { spawn, spawnSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { test } from 'node:test';
import { fileURLToPath } from 'node:url';
import { until } from './helpers.mjs';

const entry = path.join(path.dirname(fileURLToPath(import.meta.url)), '..', 'dist', 'koppler.mjs');

test("koppler reload sends hot reload, and with --restart hot restart, to the app's flutter run", async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'koppler-reload-'));
  const env = { ...process.env, KOPPLER_STATE: dir, KOPPLER_TEMP: dir, KOPPLER_CONFIG_DIR: dir };
  const koppler = (...args) => spawnSync('node', [entry, ...args], { encoding: 'utf8', env });
  // A stand-in for `flutter run`: it notes each signal it gets, as the real one reloads on it.
  const heard = path.join(dir, 'heard');
  const flutter = spawn(
    process.execPath,
    ['-e', `const fs = require('fs'); for (const s of ['SIGUSR1', 'SIGUSR2']) process.on(s, () => fs.appendFileSync(${JSON.stringify(heard)}, s + '\\n')); setInterval(() => {}, 1000);`],
    { stdio: 'ignore' },
  );
  try {
    fs.writeFileSync(path.join(dir, 'flutter-mobile.pid'), String(flutter.pid));
    await new Promise(resolve => setTimeout(resolve, 300));
    assert.match(koppler('reload', 'mobile').stdout, /Hot reloaded mobile/);
    assert.match(koppler('reload', 'mobile', '--restart').stdout, /Hot restarted mobile/);
    await until('both signals arrive', () => fs.existsSync(heard) && fs.readFileSync(heard, 'utf8') === 'SIGUSR1\nSIGUSR2\n');
    assert.match(koppler('reload', 'web').stderr, /web is not a Flutter app Koppler runs/);
  } finally {
    const exited = new Promise(resolve => flutter.once('exit', resolve));
    flutter.kill();
    await exited;
  }
  assert.match(koppler('reload', 'mobile').stderr, /mobile no longer runs/);
});
