import './sandbox.mjs';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { test } from 'node:test';
import { fileURLToPath } from 'node:url';
import { allowStack } from './allow.mjs';
import { freePorts } from './helpers.mjs';

const entry = path.join(path.dirname(fileURLToPath(import.meta.url)), '..', 'dist', 'koppler.mjs');

test('a cable wired by an edit is not taken as made when the local address is only in a comment', async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'koppler-editcable-'));
  const env = { ...process.env, KOPPLER_STATE: dir, KOPPLER_TEMP: dir, KOPPLER_CONFIG_DIR: dir };
  const koppler = (...args) => {
    const r = spawnSync(process.execPath, [entry, ...args], { encoding: 'utf8', env });
    return { out: (r.stdout + r.stderr).trim(), code: r.status };
  };
  process.on('exit', () => koppler('stop', '--all', '--yes'));
  const [mobile, api] = await freePorts(2);
  const local = `http://localhost:${String(api)}/`;
  fs.mkdirSync(path.join(dir, 'lib'));
  const config = path.join(dir, 'lib', 'config.dart');
  const serve = port => `exec python3 -m http.server ${String(port)} --bind 127.0.0.1`;
  const apps = {
    mobile: {
      name: 'Mobile App',
      kind: 'other',
      start: serve(mobile),
      url: `http://localhost:${String(mobile)}`,
      consumes: { api: { how: 'edit', file: 'lib/config.dart' } },
    },
    api: { name: 'Mobile API', kind: 'other', start: serve(api), url: local },
  };
  const stack = { envs: ['qa'], apps };
  fs.writeFileSync(path.join(dir, 'registry.json'), JSON.stringify(stack));
  allowStack(dir, stack);
  fs.writeFileSync(path.join(dir, 'local.json'), JSON.stringify({ apps: { mobile: { path: dir }, api: { path: dir } } }));
  const run = { id: 'run000021', at: 't', kind: 'run', env: 'qa', nodes: { mobile: { run: 'cli' }, api: { run: 'cli' } } };
  fs.writeFileSync(
    path.join(dir, 'history.jsonl'),
    JSON.stringify({ ...run, edges: [{ from: 'mobile', to: 'api' }], plan: { starts: [], restarts: [], stops: [], keeps: [] } }) + '\n',
  );

  // The deployed address in effect, the local one only commented out: not wired.
  fs.writeFileSync(config, `apiUrl: 'https://api-qa.acme.example/',\n// apiUrl: '${local}',\n`);
  const left = koppler('up', '--run', 'run000021');
  assert.equal(left.code, 3, left.out);
  assert.match(left.out, /Mobile App -> local Mobile API: point it at/);

  // The local one in effect: wired, and the run is done.
  fs.writeFileSync(config, `// apiUrl: 'https://api-qa.acme.example/',\napiUrl: '${local}',\n`);
  const wired = koppler('up', '--run', 'run000021');
  assert.equal(wired.code, 0, wired.out);
  assert.doesNotMatch(wired.out, /Left for the agent/);
});
