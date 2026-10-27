import './sandbox.mjs';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { test } from 'node:test';
import { allowStack } from './allow.mjs';
import { freePorts } from './helpers.mjs';

const bin = path.join(import.meta.dirname, '..', 'dist', 'koppler.mjs');

test("a cable whose how Koppler cannot apply is left for the agent, though the caller's file already names the local address", async () => {
  const [portA, portB] = await freePorts(2);
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'koppler-unapplied-'));
  const env = { ...process.env, KOPPLER_STATE: dir, KOPPLER_TEMP: dir, KOPPLER_CONFIG_DIR: dir };
  const koppler = (...args) => {
    const r = spawnSync('node', [bin, ...args], { encoding: 'utf8', env });
    return { out: (r.stdout + r.stderr).trim(), code: r.status };
  };
  try {
    // How A finds B is written down in words, not as anything Koppler can apply.
    const how = 'Remote config base URL (lib/config/model.dart)';
    const apps = {
      a: { name: 'A', kind: 'other', start: `exec python3 -m http.server ${String(portA)} --bind 127.0.0.1`, url: `http://localhost:${String(portA)}`, consumes: { b: { how, file: 'lib/config/model.dart' } } },
      b: { name: 'B', kind: 'other', start: `exec python3 -m http.server ${String(portB)} --bind 127.0.0.1`, url: `http://localhost:${String(portB)}` },
    };
    const stack = { envs: ['qa'], apps };
    fs.writeFileSync(path.join(dir, 'registry.json'), JSON.stringify(stack));
    allowStack(dir, stack);
    // The file has B's local address, in effect, in another flavour's block: not what this run starts A with.
    fs.mkdirSync(path.join(dir, 'lib', 'config'), { recursive: true });
    fs.writeFileSync(
      path.join(dir, 'lib', 'config', 'model.dart'),
      `const dev = 'http://localhost:${String(portB)}/';\nconst qa = 'https://b.qa.acme.test/';\n`,
    );
    fs.writeFileSync(path.join(dir, 'local.json'), JSON.stringify({ apps: { a: { path: dir }, b: { path: dir } } }));
    fs.writeFileSync(
      path.join(dir, 'history.jsonl'),
      `${JSON.stringify({ id: 'run000021', at: 't', kind: 'run', env: 'qa', nodes: { a: { run: 'cli' }, b: { run: 'cli' } }, edges: [{ from: 'a', to: 'b' }], plan: { starts: [], restarts: [], stops: [], keeps: [] } })}\n`,
    );
    const run = koppler('up', '--run', 'run000021');
    assert.equal(run.code, 3, run.out);
    assert.match(run.out, new RegExp(`Left for the agent:[\\s\\S]*A -> local B: point it at http://localhost:${String(portB)}\\b`));
    assert.doesNotMatch(run.out, /started a /);
    assert.doesNotMatch(fs.readFileSync(path.join(dir, 'history.jsonl'), 'utf8'), /"event":"done"/);
  } finally {
    koppler('stop', '--all', '--yes');
    fs.rmSync(dir, { recursive: true, force: true });
  }
});
