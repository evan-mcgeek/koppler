import './sandbox.mjs';
import assert from 'node:assert/strict';
import { execFileSync, spawnSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { test } from 'node:test';
import { fileURLToPath } from 'node:url';

const entry = path.join(path.dirname(fileURLToPath(import.meta.url)), '..', 'dist', 'koppler.mjs');
const app = (name, port) => ({ name, kind: 'node', slug: `acme/${name.toLowerCase()}`, url: `http://localhost:${port}` });

/** A clone of the team's stack repo, and a stand-in for gh that plays GitHub, where someone else added an app since. */
function sandbox() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'koppler-stackshare-'));
  const repo = path.join(dir, 'stacks'), bin = path.join(dir, 'bin');
  fs.mkdirSync(repo);
  fs.mkdirSync(bin);
  const committed = { name: 'Acme', envs: ['qa'], apps: { web: app('Web', 3000) } };
  fs.writeFileSync(path.join(repo, 'stack.json'), JSON.stringify(committed, null, 2));
  execFileSync('git', ['init', '-q', repo]);
  execFileSync('git', ['-C', repo, 'remote', 'add', 'origin', 'git@github.com:acme/stacks.git']);
  execFileSync('git', ['-C', repo, '-c', 'user.email=t@acme.example', '-c', 'user.name=t', 'add', 'stack.json']);
  execFileSync('git', ['-C', repo, '-c', 'user.email=t@acme.example', '-c', 'user.name=t', 'commit', '-q', '-m', 'stack']);
  const remote = { ...committed, apps: { ...committed.apps, pay: app('Pay', 7000) } };
  fs.writeFileSync(path.join(dir, 'remote.json'), JSON.stringify(remote));
  fs.writeFileSync(
    path.join(bin, 'gh'),
    `#!/usr/bin/env node
const fs = require('fs');
const args = process.argv.slice(2).join(' ');
const input = args.includes('--input') ? fs.readFileSync(0, 'utf8') : '';
fs.appendFileSync(${JSON.stringify(path.join(dir, 'gh.log'))}, JSON.stringify({ args, input }) + '\\n');
if (args.endsWith('repos/acme/stacks --jq .default_branch')) console.log('main');
else if (args.includes('contents/stack.json?ref=main')) process.stdout.write(fs.readFileSync(${JSON.stringify(path.join(dir, 'remote.json'))}, 'utf8'));
else if (args.includes('/commits/')) console.log('abc123');
else if (args.includes('/pulls')) console.log('https://github.com/acme/stacks/pull/9');
else if (args.includes('contents/') && !args.includes('-X')) process.exit(1);
`,
    { mode: 0o755 },
  );
  fs.mkdirSync(path.join(dir, 'config'));
  fs.writeFileSync(path.join(dir, 'config', 'config.json'), JSON.stringify({ stack: repo }));
  const env = { ...process.env, PATH: `${bin}:${process.env.PATH}`, KOPPLER_STATE: dir, KOPPLER_TEMP: dir, KOPPLER_CONFIG_DIR: path.join(dir, 'config') };
  const koppler = (...args) => spawnSync('node', [entry, ...args], { encoding: 'utf8', env });
  const calls = () => fs.readFileSync(path.join(dir, 'gh.log'), 'utf8').trim().split('\n').map(line => JSON.parse(line));
  return { dir, repo, koppler, calls };
}

test('stack check passes a good stack file and fails a bad one with each problem; schema is a JSON Schema', () => {
  const { dir, repo, koppler } = sandbox();
  const good = koppler('stack', 'check');
  assert.equal(good.status, 0, good.stderr);
  assert.match(good.stdout, /stack\.json: OK/);
  const bad = path.join(dir, 'bad.json');
  fs.writeFileSync(bad, JSON.stringify({ name: 'Acme', envs: ['qa'], apps: { web: { kind: 'node', consumes: { nope: {} } } } }));
  const failed = koppler('stack', 'check', bad);
  assert.equal(failed.status, 1);
  assert.match(failed.stderr, /bad\.json: \d+ problems?/);
  assert.match(failed.stderr, /apps\.web\.consumes\.nope: no such app/);
  const schema = JSON.parse(koppler('stack', 'schema').stdout);
  assert.match(schema.$schema, /json-schema\.org/);
  assert.ok(schema.properties.apps);
  fs.rmSync(repo, { recursive: true, force: true });
});

test("stack propose opens a pull request with this copy's changes, made on the stack as the team has it now", () => {
  const { repo, koppler, calls } = sandbox();
  assert.match(koppler('stack', 'propose').stderr, /Nothing to propose/);
  const mine = JSON.parse(fs.readFileSync(path.join(repo, 'stack.json'), 'utf8'));
  mine.apps.web.consumes = { pay: { how: 'env', env: 'PAY_URL' } };
  mine.apps.api = app('Api', 5001);
  fs.writeFileSync(path.join(repo, 'stack.json'), JSON.stringify(mine, null, 2));
  const proposed = koppler('stack', 'propose');
  assert.equal(proposed.status, 0, proposed.stderr);
  assert.match(proposed.stdout, /PROPOSED 2 changes on acme\/stacks: https:\/\/github\.com\/acme\/stacks\/pull\/9/);
  const put = calls().find(call => call.args.includes('-X PUT'));
  const sent = JSON.parse(Buffer.from(JSON.parse(put.input).content, 'base64').toString('utf8'));
  // The app someone added on GitHub stays; this copy's new app and call join it.
  assert.deepEqual(Object.keys(sent.apps).sort(), ['api', 'pay', 'web']);
  assert.deepEqual(sent.apps.web.consumes, { pay: { how: 'env', env: 'PAY_URL' } });
});
