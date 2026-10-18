import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { test } from 'node:test';
import { fileURLToPath } from 'node:url';
import { until } from './helpers.mjs';

const entry = path.join(path.dirname(fileURLToPath(import.meta.url)), '..', 'dist', 'koppler.mjs');

test('every line an app writes, its errors too, gets the time it arrived, beside its log', async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'koppler-stamp-'));
  const env = { ...process.env, KOPPLER_STATE: dir, KOPPLER_TEMP: dir, KOPPLER_CONFIG_DIR: dir, KOPPLER_LOGS: dir };
  const koppler = (...args) => spawnSync(process.execPath, [entry, ...args], { encoding: 'utf8', env });
  const script = 'echo one; echo two >&2; sleep 0.4; echo three; sleep 30';
  try {
    assert.equal(koppler('run', 'demo', '--', 'sh', '-c', script).status, 0);
    const log = path.join(dir, 'demo.log');
    await until('the app writes its last line', () => fs.readFileSync(log, 'utf8').includes('three'));
    const lines = fs.readFileSync(log, 'utf8').trimEnd().split('\n');
    const times = fs.readFileSync(`${log}.times`, 'utf8').trimEnd().split('\n').map(Number);
    assert.deepEqual(lines.slice(1), ['one', 'two', 'three']);
    assert.equal(times.length, lines.length);
    assert.ok(times.every((time, at) => at === 0 || time >= (times[at - 1] ?? 0)), 'in order');
    assert.ok((times[3] ?? 0) - (times[2] ?? 0) >= 300, 'a line written later has a later time');
  } finally {
    koppler('stop', 'demo');
  }
});
