import assert from 'node:assert/strict';
import fs from 'node:fs';
import net from 'node:net';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { allowStack } from './allow.mjs';

// End to end, as an attacker with write access to a shared stack would try it: shell syntax in a tunnel's host name,
// in a stack that reached the engine without passing validation. The run must hand it to the tunnel program as one
// argument and run nothing else.
const freePort = () => new Promise(resolve => { const s = net.createServer(); s.listen(0, '127.0.0.1', () => { const { port } = s.address(); s.close(() => resolve(port)); }); });
const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'koppler-attack-')), bin = path.join(dir, 'bin'), marker = path.join(dir, 'ran'), seen = path.join(dir, 'seen');
const env = { ...process.env, KOPPLER_STATE: dir, KOPPLER_TEMP: dir, KOPPLER_CONFIG_DIR: dir, PATH: `${bin}:${process.env.PATH}` };
const koppler = (...args) => { const r = spawnSync('node', [path.join(path.dirname(fileURLToPath(import.meta.url)), '..', 'src', 'koppler.mjs'), ...args], { encoding: 'utf8', env, timeout: 60000 }); return { out: (r.stdout + r.stderr).trim(), code: r.status }; };
const [appPort, tunnelPort] = [await freePort(), await freePort()];
// A stand-in for the tunnel program: it notes each argument on a line of its own and listens where it is told to.
fs.mkdirSync(bin);
fs.writeFileSync(path.join(bin, 'cloudflared'), `#!/bin/sh\nprintf '%s\\n' "$@" > "${seen}"\nfor last; do :; done\nexec python3 -m http.server "\${last##*:}" --bind 127.0.0.1\n`, { mode: 0o755 });
const host = `db.acme.example; touch ${marker} #`;
const stack = { envs: ['qa'], apps: { api: { name: 'API', kind: 'other', start: `exec python3 -m http.server ${appPort} --bind 127.0.0.1`, url: `http://localhost:${appPort}`, prereqs: [{ tunnel: host, port: tunnelPort }] } } };
fs.writeFileSync(path.join(dir, 'registry.js'), `window.REGISTRY = ${JSON.stringify(stack)};`);
fs.writeFileSync(path.join(dir, 'local.js'), `window.LOCAL = ${JSON.stringify({ apps: { api: { path: dir } } })};`);
allowStack(dir, stack);
try {
  const r = koppler('up', 'api');
  assert.equal(r.code, 0, r.out);
  assert.equal(fs.existsSync(marker), false, 'the injected command ran');
  assert.ok(fs.readFileSync(seen, 'utf8').split('\n').includes(host), 'the host name did not reach the tunnel program as one argument');
} finally { koppler('stop', '--all', '--yes'); fs.rmSync(dir, { recursive: true, force: true }); }
console.log('attacks tests ok');
