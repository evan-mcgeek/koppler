// Cases a review of the engine found: an undo that reported more than it did, a run on an environment with another's
// tunnels, a stack switched under a run, and stack facts that changed after the user allowed them.
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { test } from 'node:test';
import { fileURLToPath } from 'node:url';
import { fingerprint, stackCommands } from '../dist/engine/checks.js';
import { validateStack } from '../dist/core/stack.js';
import { allowStack } from './allow.mjs';

const entry = path.join(path.dirname(fileURLToPath(import.meta.url)), '..', 'dist', 'koppler.mjs');
const fresh = () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'koppler-review-'));
  const env = { ...process.env, KOPPLER_STATE: dir, KOPPLER_TEMP: dir, KOPPLER_CONFIG_DIR: dir, KOPPLER_LOGS: path.join(dir, 'logs') };
  const koppler = (args, cwd = dir) => {
    const r = spawnSync('node', [entry, ...args], { encoding: 'utf8', env, cwd });
    return { out: (r.stdout + r.stderr).trim(), code: r.status };
  };
  const write = (name, value) => fs.writeFileSync(path.join(dir, name), JSON.stringify(value));
  const read = name => JSON.parse(fs.readFileSync(path.join(dir, name), 'utf8'));
  return { dir, koppler, write, read };
};
const withClone = () => {
  const made = fresh();
  const repo = path.join(made.dir, 'orders');
  fs.mkdirSync(repo);
  made.write('registry.json', { envs: ['qa'], apps: { orders: { name: 'Orders API' } } });
  made.write('local.json', { roots: [made.dir], apps: { orders: { path: repo } } });
  return { ...made, repo };
};

test("down takes out Koppler's lines from a file with Windows line ends, and from lines logged as one text", () => {
  const { koppler, write, read, repo } = withClone();
  const file = path.join(repo, '.env.local');
  fs.writeFileSync(file, 'MINE=1\r\nA=http://localhost:1\r\nB=http://localhost:2\r\n');
  write('actions.json', [{ kind: 'env-file', app: 'orders', file, lines: 'A=http://localhost:1\nB=http://localhost:2' }]);
  const r = koppler(['down']);
  assert.equal(r.code, 0, r.out);
  assert.equal(fs.readFileSync(file, 'utf8'), 'MINE=1\r\n');
  assert.deepEqual(read('actions.json'), []);
});

test('down leaves a change it could not find for the agent, instead of calling it undone', () => {
  const { koppler, write, read, repo } = withClone();
  const file = path.join(repo, '.env.local');
  fs.writeFileSync(file, 'MINE=1\n');
  write('actions.json', [{ kind: 'env-file', app: 'orders', file, lines: ['A=http://localhost:1'] }]);
  const r = koppler(['down']);
  assert.equal(r.code, 3, r.out);
  assert.match(r.out, /Left for the agent/);
  assert.equal(read('actions.json').length, 1);
});

test('down counts a file Koppler made, and that is already gone, as undone', () => {
  const { koppler, write, read, repo } = withClone();
  write('actions.json', [{ kind: 'env-file', app: 'orders', file: path.join(repo, '.env.local'), lines: ['A=1'], created: true }]);
  const r = koppler(['down']);
  assert.equal(r.code, 0, r.out);
  assert.deepEqual(read('actions.json'), []);
});

test("down undoes a file logged without its folder in the app's clone, not in the folder it is run from", () => {
  const { dir, koppler, write, repo } = withClone();
  const other = path.join(dir, 'web');
  fs.mkdirSync(other);
  fs.writeFileSync(path.join(other, '.env.local'), 'A=http://localhost:1\n');
  fs.writeFileSync(path.join(repo, '.env.local'), 'A=http://localhost:1\n');
  write('actions.json', [{ kind: 'env-file', app: 'orders', file: '.env.local', lines: ['A=http://localhost:1'] }]);
  const r = koppler(['down'], other);
  assert.equal(r.code, 0, r.out);
  assert.equal(fs.readFileSync(path.join(other, '.env.local'), 'utf8'), 'A=http://localhost:1\n', "another app's file is not touched");
  assert.equal(fs.readFileSync(path.join(repo, '.env.local'), 'utf8'), '');
});

test('history done --failed with no reason asks for one', () => {
  const { koppler } = fresh();
  const r = koppler(['history', 'done', '--failed']);
  assert.doesNotMatch(r.out, /Cannot read properties|TypeError/);
  assert.notEqual(r.code, 0);
});

test("a run on an environment never uses another environment's tunnels: it is refused before anything starts", () => {
  const { dir, koppler, write } = fresh();
  const stack = {
    envs: ['qa', 'prod'],
    source: path.join(dir, 'stack.json'),
    apps: { api: { name: 'Orders API', kind: 'other', start: `touch ${path.join(dir, 'started')}`, prereqs: [{ tunnel: 'db.qa.acme.example', port: 5432 }] } },
  };
  write('registry.json', stack);
  allowStack(dir, stack);
  const r = koppler(['up', 'api', '--env', 'prod']);
  assert.equal(r.code, 1, r.out);
  assert.match(r.out, /Orders API: the stack has no PROD tunnel/);
  assert.equal(fs.existsSync(path.join(dir, 'started')), false, 'nothing was started');
});

test('the stack is not switched while a run still has changes to undo', () => {
  const { dir, koppler, write, read } = fresh();
  const one = path.join(dir, 'one'), two = path.join(dir, 'two');
  for (const folder of [one, two]) {
    fs.mkdirSync(folder);
    fs.writeFileSync(path.join(folder, 'stack.json'), JSON.stringify({ name: path.basename(folder), envs: ['qa'], apps: {} }));
  }
  write('config.json', { stack: one });
  const logged = [{ kind: 'env-file', app: 'orders', file: '/nowhere/.env.local', lines: ['A=1'] }];
  write('actions.json', logged);
  const r = koppler(['sync', '--stack', two, '--root', dir]);
  assert.notEqual(r.code, 0, r.out);
  assert.match(r.out, /still has changes to undo/);
  assert.equal(read('config.json').stack, one);
  assert.deepEqual(read('actions.json'), logged);
});

test("a stack's own code changes are not applied by recipes --apply until the user allowed them", () => {
  const { dir, koppler, write, repo } = withClone();
  fs.writeFileSync(path.join(repo, 'Program.cs'), 'UseHttps();\n');
  const stack = {
    envs: ['qa'],
    source: path.join(dir, 'stack.json'),
    apps: { orders: { name: 'Orders API', kind: 'other', localChanges: [{ file: 'Program.cs', find: 'UseHttps();', replace: '// off', why: 'no https here' }] } },
  };
  write('registry.json', stack);
  const r = koppler(['recipes', '--apply', 'orders']);
  assert.equal(fs.readFileSync(path.join(repo, 'Program.cs'), 'utf8'), 'UseHttps();\n', r.out);
  assert.match(r.out, /allow/);
});

test('what a sign-in gives an app is part of what the user allows, and cannot change which code runs', () => {
  const stack = env => ({ envs: ['qa'], apps: {}, signIns: { azure: { check: 'az account show', login: 'az login', env } } });
  assert.notEqual(fingerprint(stackCommands(stack({ A: '1' }))), fingerprint(stackCommands(stack({ A: '2' }))));
  assert.match(validateStack(stack({ PATH: '/tmp/x' })).join('\n'), /signIns\.azure.*PATH/);
  assert.match(validateStack(stack({ NODE_OPTIONS: '--require /tmp/x.js' })).join('\n'), /signIns\.azure.*NODE_OPTIONS/);
});
