import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { test } from 'node:test';
import { fileURLToPath } from 'node:url';
import { until } from './helpers.mjs';

const entry = path.join(path.dirname(fileURLToPath(import.meta.url)), '..', 'dist', 'koppler.mjs');

test('koppler logs --all shows every app on the board in one stream, in the order its lines came', async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'koppler-sharedlog-'));
  const env = { ...process.env, KOPPLER_STATE: dir, KOPPLER_TEMP: dir, KOPPLER_CONFIG_DIR: dir, KOPPLER_LOGS: dir };
  const koppler = (...args) => spawnSync(process.execPath, [entry, ...args], { encoding: 'utf8', env });
  const apps = { orders: { name: 'Orders API', kind: 'other' }, pay: { name: 'Payments API', kind: 'other' } };
  fs.writeFileSync(path.join(dir, 'registry.json'), JSON.stringify({ envs: ['qa'], apps }));
  const board = { env: 'qa', nodes: { orders: { x: 0, y: 0 }, pay: { x: 400, y: 0 } }, edges: [] };
  fs.writeFileSync(path.join(dir, 'state.json'), JSON.stringify(board));
  try {
    koppler('run', 'orders', '--', 'sh', '-c', 'echo order created; sleep 2.5; echo order charged; sleep 30');
    koppler('run', 'pay', '--', 'sh', '-c', 'sleep 0.3; echo payment taken; sleep 30');
    // What the apps wrote, not the line that names the command each was started with.
    const written = () =>
      koppler('logs', '--all')
        .stdout.split('\n')
        .filter(line => /order|payment/.test(line) && !line.includes(' $ '));
    await until('both apps wrote', () => written().length === 3);
    const said = written();
    assert.deepEqual(
      said.map(line => line.replace(/^.\d\d:\d\d:\d\d\.\d{3} /, '').replace(/\s+/g, ' ')),
      ['Orders API order created', 'Payments API payment taken', 'Orders API order charged'],
    );
    assert.match(said[0] ?? '', /^ \d\d:\d\d:\d\d\.\d{3} Orders API {4}order created$/);
    // Left out with --except, and when hidden on the board.
    assert.doesNotMatch(koppler('logs', '--all', '--except', 'pay').stdout, /payment/);
    fs.writeFileSync(path.join(dir, 'state.json'), JSON.stringify({ ...board, hiddenLogs: { orders: true } }));
    const hidden = koppler('logs', '--all').stdout;
    assert.doesNotMatch(hidden, /order created/);
    assert.match(hidden, /payment taken/);
  } finally {
    koppler('stop', '--all', '--yes');
  }
});
