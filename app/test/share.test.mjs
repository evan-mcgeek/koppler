import './sandbox.mjs';
import assert from 'node:assert/strict';
import { execFileSync, spawnSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { test } from 'node:test';
import { fileURLToPath } from 'node:url';

const entry = path.join(path.dirname(fileURLToPath(import.meta.url)), '..', 'dist', 'koppler.mjs');
const board = { name: 'Shop', version: 1, nodes: { web: { run: 'cli', note: 'mine' } }, edges: [], layout: { nodes: { web: { x: 0, y: 0 } } } };
const stackOf = presets => ({ name: 'Acme', envs: ['qa'], apps: { web: { name: 'Web', kind: 'node', slug: 'acme/web' } }, presets });

/** A folder holding the stack, its own board in the run state, and a stand-in for gh that plays GitHub. */
function sandbox({ github }) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'koppler-share-'));
  const repo = path.join(dir, 'stacks'), stack = path.join(repo, 'shop'), bin = path.join(dir, 'bin');
  fs.mkdirSync(stack, { recursive: true });
  fs.mkdirSync(bin);
  fs.mkdirSync(path.join(dir, 'state'));
  fs.writeFileSync(path.join(stack, 'stack.json'), JSON.stringify(stackOf([{ name: 'Team', version: 1, nodes: {}, edges: [] }]), null, 2));
  if (github) {
    execFileSync('git', ['init', '-q', repo]);
    execFileSync('git', ['-C', repo, 'remote', 'add', 'origin', 'git@github.com:acme/stacks.git']);
  }
  fs.mkdirSync(path.join(dir, 'config'));
  fs.writeFileSync(path.join(dir, 'config', 'config.json'), JSON.stringify({ stack }));
  fs.writeFileSync(path.join(dir, 'state', 'state.json'), JSON.stringify({ presets: [board] }));
  // The team's stack on GitHub has a board the local file lacks; the pull request must keep it.
  const remote = stackOf([{ name: 'Team', version: 1, nodes: {}, edges: [] }, { name: 'Payments', version: 1, nodes: {}, edges: [] }]);
  fs.writeFileSync(path.join(dir, 'remote.json'), JSON.stringify(remote));
  fs.writeFileSync(
    path.join(bin, 'gh'),
    `#!/usr/bin/env node
const fs = require('fs');
const args = process.argv.slice(2).join(' ');
const input = args.includes('--input') ? fs.readFileSync(0, 'utf8') : '';
fs.appendFileSync(${JSON.stringify(path.join(dir, 'gh.log'))}, JSON.stringify({ args, input }) + '\\n');
if (args.endsWith('repos/acme/stacks --jq .default_branch')) console.log('main');
else if (args.includes('contents/shop/stack.json?ref=main')) process.stdout.write(fs.readFileSync(${JSON.stringify(path.join(dir, 'remote.json'))}, 'utf8'));
else if (args.includes('/commits/')) console.log('abc123');
else if (args.includes('/pulls')) console.log('https://github.com/acme/stacks/pull/7');
else if (args.includes('contents/') && !args.includes('-X')) process.exit(1);
`,
    { mode: 0o755 },
  );
  const env = { ...process.env, PATH: `${bin}:${process.env.PATH}`, KOPPLER_STATE: path.join(dir, 'state'), KOPPLER_TEMP: path.join(dir, 'state'), KOPPLER_CONFIG_DIR: path.join(dir, 'config') };
  const koppler = (...args) => spawnSync('node', [entry, ...args], { encoding: 'utf8', env });
  const calls = () => fs.readFileSync(path.join(dir, 'gh.log'), 'utf8').trim().split('\n').map(line => JSON.parse(line));
  return { dir, stack, koppler, calls };
}

test('a board is shared as a pull request on the stack repo, made from the team stack as it is on GitHub', () => {
  const { dir, stack, koppler, calls } = sandbox({ github: true });
  const before = fs.readFileSync(path.join(stack, 'stack.json'), 'utf8');
  const shared = koppler('board', 'share', 'shop');
  assert.equal(shared.status, 0, shared.stderr);
  assert.match(shared.stdout, /PROPOSED Shop to the team on acme\/stacks: https:\/\/github\.com\/acme\/stacks\/pull\/7/);
  const put = calls().find(call => call.args.includes('-X PUT'));
  assert.match(put.args, /repos\/acme\/stacks\/contents\/shop\/stack\.json/);
  const sent = JSON.parse(Buffer.from(JSON.parse(put.input).content, 'base64').toString('utf8'));
  // The team's boards stay, this one joins them, and the note kept on this Mac does not go along.
  assert.deepEqual(sent.presets.map(one => one.name), ['Team', 'Payments', 'Shop']);
  assert.deepEqual(sent.presets[2].nodes, { web: { run: 'cli', note: 'mine' } });
  assert.deepEqual(sent.presets[2].layout, board.layout);
  const pull = JSON.parse(calls().find(call => call.args.includes('/pulls')).input);
  assert.deepEqual([pull.title, pull.base], ['Add the "Shop" board', 'main']);
  // The clone on this Mac is not touched.
  assert.equal(fs.readFileSync(path.join(stack, 'stack.json'), 'utf8'), before);
  fs.rmSync(dir, { recursive: true, force: true });
});

test('a stack that is not on GitHub keeps the board in its file here, to commit', () => {
  const { dir, stack, koppler } = sandbox({ github: false });
  const shared = koppler('board', 'share', 'Shop');
  assert.equal(shared.status, 0, shared.stderr);
  assert.match(shared.stdout, /KEPT Shop/);
  const kept = JSON.parse(fs.readFileSync(path.join(stack, 'stack.json'), 'utf8'));
  assert.deepEqual(kept.presets.map(one => one.name), ['Team', 'Shop']);
  assert.match(koppler('board', 'share', 'Nope').stderr, /Nope is not one of your boards/);
  fs.rmSync(dir, { recursive: true, force: true });
});

test('a feature board is shared with its request, phases, steps and where its cards sit on the map', () => {
  const { dir, stack, koppler } = sandbox({ github: false });
  const feature = { request: 'A customer pays', phases: [{ name: 'Pay', steps: [{ from: 'web', to: 'web', kind: 'call', note: 'Sends it' }] }] };
  const discover = { open: ['web'], at: { web: { x: 40, y: 220 } }, layout: 1 };
  fs.writeFileSync(path.join(dir, 'state', 'state.json'), JSON.stringify({ presets: [{ name: 'Checkout', version: 1, nodes: {}, edges: [], feature, discover }] }));
  const shared = koppler('board', 'share', 'Checkout');
  assert.equal(shared.status, 0, shared.stderr);
  const kept = JSON.parse(fs.readFileSync(path.join(stack, 'stack.json'), 'utf8')).presets.find(one => one.name === 'Checkout');
  assert.deepEqual([kept.feature, kept.discover], [feature, discover]);
  fs.rmSync(dir, { recursive: true, force: true });
});
