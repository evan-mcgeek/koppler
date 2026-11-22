import './sandbox.mjs';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { test } from 'node:test';

// A tunnel whose Cloudflare Access login keeps asking is stopped, instead of opening a browser page per connection.
const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'koppler-tunnel-login-'));
const bin = path.join(dir, 'bin');
fs.mkdirSync(bin);
// cloudflared logged out: each connection the app makes asks for a login again.
fs.writeFileSync(
  path.join(bin, 'cloudflared'),
  `#!/bin/sh
while :; do
  echo "A browser window should have opened at the following URL:"
  echo
  echo "https://db.acme.test/cdn-cgi/access/cli?redirect_url=x"
  sleep 0.2
done
`,
  { mode: 0o755 },
);
const env = {
  ...process.env,
  PATH: `${bin}:${process.env.PATH}`,
  KOPPLER_STATE: dir,
  KOPPLER_TEMP: dir,
  KOPPLER_CONFIG_DIR: dir,
};
const entry = path.join(path.dirname(fileURLToPath(import.meta.url)), '..', 'dist', 'koppler.mjs');
const koppler = (...args) => {
  const r = spawnSync('node', [entry, ...args], { encoding: 'utf8', env });
  return (r.stdout + r.stderr).trim();
};
fs.writeFileSync(path.join(dir, 'registry.json'), JSON.stringify({ envs: ['qa'], apps: {} }));
process.on('exit', () => {
  koppler('stop', '--all', '--yes');
  fs.rmSync(dir, { recursive: true, force: true });
});

test('a tunnel that keeps asking for an Access login stops, and status says to log in', () => {
  const name = 'tunnel-db-acme-test-5432';
  koppler('run', name, '--keep-alive', '--', 'cloudflared', 'access', 'tcp', '--hostname', 'db.acme.test', '--url', 'localhost:5432');
  const line = () => koppler('status').split('\n').find(row => row.startsWith(name)) ?? '';
  const until = Date.now() + 10000;
  while (/running/.test(line()) && Date.now() < until) spawnSync('sleep', ['0.2']);
  assert.match(line(), /needs login/);
  const log = fs.readFileSync(path.join(dir, 'logs', `${name}.log`), 'utf8');
  assert.match(log.trimEnd().split('\n').pop() ?? '', /cloudflared access login https:\/\/db\.acme\.test, then koppler up/);
  // Stopped after a few pages, not a flood of them.
  assert.ok((log.match(/A browser window should have opened/g) ?? []).length <= 4);
  // The canvas inbox says it too, with the login to copy.
  const said = fs.readFileSync(path.join(dir, 'messages.jsonl'), 'utf8').trim().split('\n').map(line => JSON.parse(line));
  const message = said.find(one => one.title === `${name} needs a Cloudflare Access login`);
  assert.deepEqual(message?.sections?.[0]?.commands, ['cloudflared access login https://db.acme.test']);
});
