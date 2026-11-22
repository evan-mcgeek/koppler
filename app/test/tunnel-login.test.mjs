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

test('koppler up logs in once before it opens a tunnel with no Access session, without ever printing the token', async () => {
  const { allowStack } = await import('./allow.mjs');
  const { freePorts } = await import('./helpers.mjs');
  const [appPort, dbPort] = await freePorts(2);
  const home = fs.mkdtempSync(path.join(os.tmpdir(), 'koppler-tunnel-precheck-'));
  const tools = path.join(home, 'bin');
  fs.mkdirSync(tools);
  // No session until `access login` runs; the login prints its token unless told to be quiet.
  fs.writeFileSync(
    path.join(tools, 'cloudflared'),
    `#!/bin/sh
case "$2" in
  token) [ -f "${home}/session" ] && { echo the-token; exit 0; }
         echo "Unable to find token for provided application. Please run login command to generate token." >&2; exit 0 ;;
  login) echo "$*" >> "${home}/logins"; touch "${home}/session"
         case " $* " in *" --quiet "*) ;; *) echo the-token ;; esac; exit 0 ;;
esac
for last; do :; done
exec python3 -m http.server "\${last##*:}" --bind 127.0.0.1
`,
    { mode: 0o755 },
  );
  const upEnv = { ...env, PATH: `${tools}:${process.env.PATH}`, KOPPLER_STATE: home, KOPPLER_TEMP: home, KOPPLER_CONFIG_DIR: home, KOPPLER_EARLY_LOG: '1' };
  const run = (...args) => {
    const r = spawnSync('node', [entry, ...args], { encoding: 'utf8', env: upEnv });
    return { out: (r.stdout + r.stderr).trim(), code: r.status };
  };
  const stack = {
    envs: ['qa'],
    apps: {
      api: {
        name: 'API',
        kind: 'other',
        start: `exec python3 -m http.server ${appPort} --bind 127.0.0.1`,
        url: `http://localhost:${appPort}`,
        prereqs: [{ tunnel: 'db.acme.test', port: dbPort }],
      },
    },
  };
  fs.writeFileSync(path.join(home, 'registry.json'), JSON.stringify(stack));
  allowStack(home, stack);
  fs.writeFileSync(path.join(home, 'local.json'), JSON.stringify({ apps: { api: { path: home } } }));
  try {
    const first = run('up', 'api');
    assert.equal(first.code, 0, first.out);
    assert.match(first.out, new RegExp(`started tunnel-db-acme-test-${dbPort}\\b`));
    assert.equal(fs.readFileSync(path.join(home, 'logins'), 'utf8').trim(), 'access login --quiet --auto-close https://db.acme.test');
    assert.doesNotMatch(first.out, /the-token/);
    run('stop', '--all', '--yes');
    // With a session, no login.
    const second = run('up', 'api');
    assert.equal(second.code, 0, second.out);
    assert.equal(fs.readFileSync(path.join(home, 'logins'), 'utf8').trim().split('\n').length, 1);
  } finally {
    run('stop', '--all', '--yes');
    fs.rmSync(home, { recursive: true, force: true });
  }
});
