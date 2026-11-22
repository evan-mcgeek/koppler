import './sandbox.mjs';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { test } from 'node:test';

// koppler down ends the run, as Stop on the canvas does: nothing runs from the board after it. koppler stop does not.
const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'koppler-stop-live-'));
const env = { ...process.env, KOPPLER_STATE: dir, KOPPLER_TEMP: dir, KOPPLER_CONFIG_DIR: dir };
const entry = path.join(path.dirname(fileURLToPath(import.meta.url)), '..', 'dist', 'koppler.mjs');
const koppler = (...args) => {
  const r = spawnSync('node', [entry, ...args], { encoding: 'utf8', env });
  return { out: (r.stdout + r.stderr).trim(), code: r.status };
};
const live = () => JSON.parse(fs.readFileSync(path.join(dir, 'live.json'), 'utf8'));
fs.writeFileSync(path.join(dir, 'registry.json'), JSON.stringify({ envs: ['qa'], apps: {} }));
process.on('exit', () => {
  koppler('stop', '--all', '--yes');
  fs.rmSync(dir, { recursive: true, force: true });
});

test('stop keeps the run, so the next plan says what stopped; down ends it, as Stop on the canvas does', () => {
  fs.writeFileSync(
    path.join(dir, 'live.json'),
    JSON.stringify({
      id: 'run00001',
      at: new Date().toISOString(),
      env: 'qa',
      nodes: { web: { branch: '', run: 'cli' }, api: { branch: '', run: 'cli' } },
      edges: [{ from: 'web', to: 'api' }],
    }),
  );
  koppler('run', 'web', '--', 'sleep', '30');
  koppler('run', 'api', '--', 'sleep', '30');
  assert.match(koppler('stop', 'web').out, /web: stopped/);
  assert.deepEqual(Object.keys(live().nodes), ['web', 'api']);
  assert.equal(koppler('down').code, 0);
  assert.deepEqual(live().nodes, {});
  assert.deepEqual(live().edges, []);
});
