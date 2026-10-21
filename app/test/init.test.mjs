import './sandbox.mjs';
import assert from 'node:assert/strict';
import { execFileSync, spawnSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { test } from 'node:test';
import { fileURLToPath } from 'node:url';

const entry = path.join(path.dirname(fileURLToPath(import.meta.url)), '..', 'dist', 'koppler.mjs');

test('koppler init with no stack anywhere says how to start one, and reports no apps it does not have', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'koppler-init-'));
  const repo = path.join(dir, 'code', 'acme-web');
  fs.mkdirSync(repo, { recursive: true });
  execFileSync('git', ['init', '-q', repo]);
  execFileSync('git', ['-C', repo, 'remote', 'add', 'origin', 'git@github.com:acme/acme-web.git']);
  const env = {
    ...process.env,
    HOME: dir,
    KOPPLER_STATE: path.join(dir, 'state'),
    KOPPLER_CONFIG_DIR: path.join(dir, 'config'),
  };
  const run = spawnSync('node', [entry, 'init', '--root', path.join(dir, 'code'), '--no-fetch'], { encoding: 'utf8', env });
  assert.equal(run.status, 0, run.stderr);
  assert.match(run.stdout, /koppler init --new "<name>" --envs/);
  assert.match(run.stdout, /koppler link /);
  assert.doesNotMatch(run.stdout, /APP\s+KIND/);
  assert.doesNotMatch(run.stdout, /suggestions/);
  fs.rmSync(dir, { recursive: true, force: true });
});

test('koppler add takes a clone into the stack in use, by its name or its folder', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'koppler-add-'));
  const code = path.join(dir, 'code');
  for (const name of ['acme-web', 'acme-orders']) {
    const repo = path.join(code, name);
    fs.mkdirSync(repo, { recursive: true });
    execFileSync('git', ['init', '-q', repo]);
    execFileSync('git', ['-C', repo, 'remote', 'add', 'origin', `git@github.com:acme/${name}.git`]);
    fs.writeFileSync(path.join(repo, 'package.json'), '{}');
  }
  const stack = path.join(dir, 'stack');
  fs.mkdirSync(stack);
  fs.writeFileSync(path.join(stack, 'stack.json'), JSON.stringify({ name: 'Acme', envs: ['qa'], apps: {} }));
  const env = { ...process.env, HOME: dir, KOPPLER_STATE: path.join(dir, 'state'), KOPPLER_CONFIG_DIR: path.join(dir, 'config') };
  const koppler = (...args) => spawnSync('node', [entry, ...args], { encoding: 'utf8', env });
  assert.equal(koppler('init', '--root', code, '--stack', stack, '--no-fetch').status, 0);
  const byName = koppler('add', 'acme-web');
  assert.equal(byName.status, 0, byName.stderr);
  assert.match(byName.stdout, /Added acme-web/);
  const byFolder = koppler('add', path.join(code, 'acme-orders'));
  assert.equal(byFolder.status, 0, byFolder.stderr);
  const apps = JSON.parse(fs.readFileSync(path.join(stack, 'stack.json'), 'utf8')).apps;
  assert.deepEqual(Object.keys(apps).sort(), ['acme-orders', 'acme-web']);
  fs.rmSync(dir, { recursive: true, force: true });
});

test('koppler canvas --new-address gives a running canvas a new address, and the old one stops working', async () => {
  const { freePorts } = await import('./helpers.mjs');
  const [port] = await freePorts(1);
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'koppler-address-'));
  const env = { ...process.env, HOME: dir, KOPPLER_STATE: path.join(dir, 'state'), KOPPLER_CONFIG_DIR: path.join(dir, 'config'), KOPPLER_PORT: String(port) };
  const koppler = (...args) => spawnSync('node', [entry, ...args], { encoding: 'utf8', env });
  const url = () => fs.readFileSync(path.join(dir, 'state', 'run', 'canvas-url'), 'utf8').trim();
  try {
    assert.equal(koppler('canvas', '--no-open').status, 0);
    const before = url();
    assert.equal((await fetch(before)).status, 200);
    const renewed = koppler('canvas', '--new-address', '--no-open');
    assert.equal(renewed.status, 0, renewed.stderr);
    assert.match(renewed.stdout, /new address/);
    assert.notEqual(url(), before);
    assert.equal((await fetch(before)).status, 404);
    assert.equal((await fetch(url())).status, 200);
  } finally {
    koppler('canvas', 'stop');
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test('koppler remove takes the app off the team boards and the other apps\' order, so the stack stays valid; one left invalid reads again', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'koppler-remove-'));
  try {
    const stack = path.join(dir, 'stack');
    fs.mkdirSync(stack);
    const file = path.join(stack, 'stack.json');
    const apps = { web: { name: 'Web', kind: 'node', slug: 'acme/web', after: ['orders-api'], consumes: { 'orders-api': {} } }, 'orders-api': { name: 'Orders API', kind: 'node', slug: 'acme/orders-api' }, cart: { name: 'Cart', kind: 'node', slug: 'acme/cart' } };
    const presets = [{ name: 'Checkout', version: 1, nodes: { web: { run: 'cli' }, 'orders-api': { run: 'cli' }, cart: { run: 'cli' } }, edges: [{ from: 'web', to: 'orders-api' }, { from: 'web', to: 'cart' }] }];
    fs.writeFileSync(file, JSON.stringify({ name: 'Acme Shop', koppler: '0.2.1', envs: ['qa'], apps, presets }));
    const env = { ...process.env, HOME: dir, KOPPLER_STATE: path.join(dir, 'state'), KOPPLER_TEMP: path.join(dir, 'temp'), KOPPLER_CONFIG_DIR: path.join(dir, 'config') };
    delete env.CLAUDE_CODE_SESSION_ID;
    const koppler = (...args) => spawnSync('node', [entry, ...args], { encoding: 'utf8', env });
    assert.equal(koppler('init', '--root', path.join(dir, 'code'), '--stack', stack, '--no-fetch').status, 0);
    const removed = koppler('remove', 'orders-api');
    assert.equal(removed.status, 0, removed.stderr);
    assert.match(removed.stdout, /^Removed Orders API from the stack/m);
    const after = JSON.parse(fs.readFileSync(file, 'utf8'));
    assert.deepEqual(Object.keys(after.presets[0].nodes), ['web', 'cart']);
    assert.deepEqual(after.presets[0].edges, [{ from: 'web', to: 'cart' }]);
    assert.equal(after.apps.web.after, undefined);
    assert.deepEqual(after.apps.web.consumes, {});
    // A stack an older Koppler saved this way, Cart gone but still on the board, reads as valid again.
    const { cart, ...left } = apps;
    fs.writeFileSync(file, JSON.stringify({ name: 'Acme Shop', koppler: '0.2.1', envs: ['qa'], apps: left, presets }));
    const read = koppler('stack', 'get', 'presets');
    assert.equal(read.status, 0, read.stderr);
    assert.doesNotMatch(read.stdout + read.stderr, /invalid/);
    const healed = JSON.parse(fs.readFileSync(file, 'utf8'));
    assert.deepEqual(Object.keys(healed.presets[0].nodes), ['web', 'orders-api']);
    assert.deepEqual(healed.presets[0].edges, [{ from: 'web', to: 'orders-api' }]);
    assert.deepEqual(healed.apps.web.after, ['orders-api']);
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});
