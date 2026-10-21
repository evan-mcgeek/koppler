import './sandbox.mjs';
import assert from 'node:assert/strict';
import { spawn, spawnSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { test } from 'node:test';
import { fileURLToPath } from 'node:url';

const bin = path.join(path.dirname(fileURLToPath(import.meta.url)), '..', 'dist', 'koppler.mjs');

test('An agent session that makes a board is asked to connect, unless it listens already; outside an agent, nothing is said.', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'koppler-connect-'));
  fs.writeFileSync(path.join(dir, 'registry.json'), JSON.stringify({ envs: ['qa'], apps: { api: { name: 'API', kind: 'other', slug: 'x/api' } } }));
  fs.mkdirSync(path.join(dir, 'repo'));
  fs.writeFileSync(path.join(dir, 'local.json'), JSON.stringify({ apps: { api: { path: path.join(dir, 'repo') } } }));
  const env = { ...process.env, KOPPLER_STATE: dir, KOPPLER_TEMP: dir, KOPPLER_CONFIG_DIR: dir };
  delete env.CLAUDE_CODE_SESSION_ID;
  const koppler = (extra, ...args) => {
    const r = spawnSync('node', [bin, ...args], { encoding: 'utf8', env: { ...env, ...extra } });
    return (r.stdout + r.stderr).trim();
  };
  const agent = { CLAUDE_CODE_SESSION_ID: 'c0ffee00-0000-4000-8000-000000000000' };
  assert.doesNotMatch(koppler({}, 'board', 'new', 'One', '--add', 'api'), /CONNECT/);
  assert.match(koppler(agent, 'board', 'new', 'Two', '--add', 'api'), /CONNECT: no agent session gets the canvas's requests yet\. Run `koppler listen take` in the background/);
  // That session listening: nothing more to say to it; to another session, that the requests go elsewhere.
  const sleeper = spawn('sleep', ['30']);
  const started = spawnSync('ps', ['-p', String(sleeper.pid), '-o', 'lstart='], { encoding: 'utf8' }).stdout.trim();
  fs.writeFileSync(path.join(dir, 'listener.json'), JSON.stringify({ pid: sleeper.pid, started, agentSession: agent.CLAUDE_CODE_SESSION_ID }));
  try {
    assert.doesNotMatch(koppler(agent, 'board', 'new', 'Three', '--add', 'api'), /CONNECT/);
    assert.match(koppler({ CLAUDE_CODE_SESSION_ID: 'another' }, 'board', 'new', 'Four', '--add', 'api'), /CONNECT: another agent session gets the canvas's requests/);
  } finally {
    sleeper.kill();
    fs.rmSync(dir, { recursive: true, force: true });
  }
});
