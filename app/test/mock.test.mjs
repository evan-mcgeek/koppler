import './sandbox.mjs';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { test } from 'node:test';
import { fileURLToPath } from 'node:url';
import { freePorts, until } from './helpers.mjs';

const entry = path.join(path.dirname(fileURLToPath(import.meta.url)), '..', 'dist', 'koppler.mjs');

test("koppler run --mock answers the app's mock responses on its local address, without its clone", async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'koppler-mock-'));
  const env = { ...process.env, KOPPLER_STATE: dir, KOPPLER_TEMP: dir, KOPPLER_CONFIG_DIR: dir };
  const koppler = (...args) => spawnSync('node', [entry, ...args], { encoding: 'utf8', env });
  process.on('exit', () => koppler('stop', '--all', '--yes'));
  const [port] = await freePorts(1);
  const url = `http://localhost:${String(port)}`;
  const mock = [
    { method: 'GET', path: '/orders/*', body: { id: 7, state: 'paid' } },
    { method: 'POST', path: '/orders', status: 201, body: 'created' },
  ];
  const stack = { envs: ['qa'], apps: { orders: { name: 'Orders API', kind: 'dotnet', url, mock } } };
  fs.writeFileSync(path.join(dir, 'registry.json'), JSON.stringify(stack));

  const ran = koppler('run', 'orders', '--mock');
  assert.equal(ran.status, 0, ran.stdout + ran.stderr);
  await until('the mock answers', () => fetch(url).then(() => true, () => false));
  assert.deepEqual(await (await fetch(`${url}/orders/7`)).json(), { id: 7, state: 'paid' });
  const created = await fetch(`${url}/orders`, { method: 'POST', body: '{}' });
  assert.equal(created.status, 201);
  assert.equal(await created.text(), 'created');
  assert.equal((await fetch(`${url}/payments`)).status, 404);
  assert.match(koppler('logs', 'orders').stdout, /GET \/orders\/7 200/);

  koppler('stop', 'orders');
  await until('the mock stops', () => fetch(url).then(() => false, () => true));

  // No responses in the stack: it says where to add them.
  stack.apps.orders.mock = [];
  fs.writeFileSync(path.join(dir, 'registry.json'), JSON.stringify(stack));
  assert.match(koppler('run', 'orders', '--mock').stderr, /orders: has no mock responses yet/);
});
