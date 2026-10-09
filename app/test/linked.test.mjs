import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

// A linked stack in a throwaway config: added, changed here, updated from GitHub, shared as a pull request.
const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'koppler-linked-'));
process.env.KOPPLER_CONFIG_DIR = dir; process.env.KOPPLER_TEMP = path.join(dir, 'temp'); fs.mkdirSync(process.env.KOPPLER_TEMP);
const { changes, discardChanges, linkStack, linkedStatus, proposeChanges, updateStack } = await import('../src/linked.mjs');
const link = 'https://github.com/acme/team-config/blob/main/stacks/shop/stack.json';
let remote = { name: 'Shop', envs: ['qa'], apps: { api: { name: 'API', kind: 'node', slug: 'acme/api' } } };
const read = async f => (assert.deepEqual(f, { owner: 'acme', repo: 'team-config', ref: 'main', path: 'stacks/shop/stack.json' }), JSON.stringify(remote));
const config = {};

assert.match((await linkStack('https://evil.test/x.json', { config, save() {}, read })).error, /Paste a link to a stack.json on GitHub/);
assert.match((await linkStack(link, { config, save() {}, read: async () => '{"apps": []}' })).error, /not a stack Koppler can use/);
const linked = await linkStack(link, { config, save() {}, read });
assert.equal(linked.name, 'Shop');
assert.equal(config.stack, linked.stack);
const stackFile = path.join(linked.stack, 'stack.json'), local = () => JSON.parse(fs.readFileSync(stackFile, 'utf8'));
assert.deepEqual(linkedStatus(linked.stack).changes, []);
assert.deepEqual(await updateStack(linked.stack, { read }), { updated: false, message: 'Already up to date.' });

// GitHub changed, the copy did not: it follows.
remote = { ...remote, envs: ['qa', 'prod'] };
assert.deepEqual(await updateStack(linked.stack, { read }), { updated: true, message: 'Updated from GitHub.' });
assert.deepEqual(local().envs, ['qa', 'prod']);

// The copy changed here: listed as changes; a GitHub change on top is refused, so nothing is lost.
fs.writeFileSync(stackFile, JSON.stringify({ ...local(), apps: { ...local().apps, api: { ...local().apps.api, url: 'http://localhost:3000' }, web: { name: 'Web', kind: 'web', slug: 'acme/web' } } }));
assert.deepEqual(linkedStatus(linked.stack).changes, ['added Web', 'changed API: url']);
remote = { ...remote, notes: ['new note'] };
assert.match((await updateStack(linked.stack, { read })).error, /changed on GitHub, and this copy has changes of its own/);
assert.equal(local().apps.web.name, 'Web');

// The pull request carries the copy and a list of its changes; once merged, an update brings the copy in line.
let sent;
const pr = await proposeChanges(linked.stack, { propose: async (f, text, opts) => { sent = { f, stack: JSON.parse(text), ...opts }; return { url: 'https://github.com/acme/team-config/pull/7' }; } });
assert.equal(pr.url, 'https://github.com/acme/team-config/pull/7');
assert.match(sent.branch, /^koppler\/shop-/);
assert.equal(sent.title, 'Shop: 2 changes from Koppler');
assert.match(sent.body, /- added Web\n- changed API: url/);
assert.equal(sent.stack.apps.web.name, 'Web');
assert.equal(linkedStatus(linked.stack).pr, pr.url);
remote = local();
assert.deepEqual(await updateStack(linked.stack, { read }), { updated: true, message: 'Your changes are in the shared stack now.' });
assert.deepEqual(linkedStatus(linked.stack), { url: link, fetchedAt: linkedStatus(linked.stack).fetchedAt, changes: [] });
assert.match((await proposeChanges(linked.stack, { propose: async () => assert.fail('nothing to send') })).error, /nothing to share/);

// Discard goes back to the shared stack as last fetched.
fs.writeFileSync(stackFile, JSON.stringify({ ...local(), name: 'Mine' }));
assert.deepEqual(linkedStatus(linked.stack).changes, ['changed name']);
discardChanges(linked.stack);
assert.equal(local().name, 'Shop');
assert.deepEqual(changes({ apps: {} }, { apps: {} }), []);
fs.rmSync(dir, { recursive: true });
console.log('linked tests ok');
