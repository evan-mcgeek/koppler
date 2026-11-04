import './sandbox.mjs';
import assert from 'node:assert/strict';
import { execFileSync, spawnSync } from 'node:child_process';
import crypto from 'node:crypto';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { test } from 'node:test';
import { fileURLToPath } from 'node:url';

const entry = path.join(path.dirname(fileURLToPath(import.meta.url)), '..', 'dist', 'koppler.mjs');
const app = (name, port) => ({ name, kind: 'node', slug: `acme/${name.toLowerCase()}`, url: `http://localhost:${port}` });

/** Two private stacks on this Mac, Acme Shop in use and Acme Shop QA beside it, each with its own boards. */
function sandbox() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'koppler-stackmerge-'));
  const config = path.join(dir, 'config'), temp = path.join(dir, 'temp'), code = path.join(dir, 'code');
  const shop = path.join(config, 'stacks', 'acme-shop'), qa = path.join(config, 'stacks', 'acme-shop-qa');
  for (const folder of [shop, qa, temp, code]) fs.mkdirSync(folder, { recursive: true });
  const write = (file, value) => fs.writeFileSync(file, JSON.stringify(value, null, 2));
  write(path.join(shop, 'stack.json'), {
    name: 'Acme Shop', envs: ['qa'],
    apps: { web: app('Web', 3000), orders: app('Orders', 5000) },
    presets: [{ name: 'Team checkout', version: 1, nodes: { web: { run: 'cli' } }, edges: [] }],
  });
  write(path.join(qa, 'stack.json'), {
    name: 'Acme Shop QA', envs: ['qa'],
    apps: { orders: app('Orders', 5001), pay: { ...app('Pay', 7000), consumes: { orders: { how: 'env', env: 'ORDERS_URL' } } } },
    queues: { events: { name: 'shop-events', type: 'sqs' } },
    presets: [{ name: 'Payments', version: 1, nodes: { pay: { run: 'docker' }, orders: { run: 'cli' } }, edges: [{ from: 'pay', to: 'orders' }] }],
  });
  const env = { ...process.env, HOME: dir, KOPPLER_STATE: dir, KOPPLER_TEMP: temp, KOPPLER_CONFIG_DIR: config };
  delete env.CLAUDE_CODE_SESSION_ID;
  const koppler = (...args) => spawnSync('node', [entry, ...args], { encoding: 'utf8', env });
  const init = koppler('init', '--root', code, '--stack', shop, '--no-fetch');
  assert.equal(init.status, 0, init.stderr);
  const read = file => JSON.parse(fs.readFileSync(file, 'utf8'));
  return { dir, config, temp, shop, qa, koppler, read, write };
}

test('stack merge lists what it adds and each conflict, changes nothing until every conflict is settled, and keeps a locked field', () => {
  const { dir, shop, koppler, read } = sandbox();
  const file = path.join(shop, 'stack.json');
  const before = fs.readFileSync(file, 'utf8');
  const shown = koppler('stack', 'merge', 'Acme Shop QA');
  assert.equal(shown.status, 0, shown.stderr);
  assert.match(shown.stdout, /ADD apps\.pay\n/);
  assert.match(shown.stdout, /ADD queues\n/);
  assert.match(shown.stdout, /ADD presets\["Payments"\]\n/);
  assert.match(shown.stdout, /apps\.orders\.url: ours "http:\/\/localhost:5000", theirs "http:\/\/localhost:5001"\n/);
  assert.match(shown.stdout, /1 conflict to settle: --keep <path>=ours\|theirs/);
  assert.equal(fs.readFileSync(file, 'utf8'), before);

  const open = koppler('stack', 'merge', 'Acme Shop QA', '--apply');
  assert.equal(open.status, 1);
  assert.match(open.stderr, /1 conflict is not settled: apps\.orders\.url/);
  assert.match(koppler('stack', 'merge', 'Acme Shop QA', '--keep', 'apps.web.url=theirs').stderr, /apps\.web\.url is not a conflict of this merge/);
  assert.match(koppler('stack', 'merge', 'Acme Shop QA', '--keep', 'apps.orders.url=mine').stderr, /--keep apps\.orders\.url=mine: expected <path>=ours\|theirs/);
  assert.match(koppler('stack', 'merge', 'Acme Shop').stderr, /Acme Shop is the stack in use/);
  assert.match(koppler('stack', 'merge', 'Nope').stderr, /no stack called Nope/);
  assert.equal(fs.readFileSync(file, 'utf8'), before);

  // Locked here, the field keeps its value whatever the merge is told, and the merge says so.
  assert.equal(koppler('stack', 'lock', 'apps.orders.url').status, 0);
  const locked = koppler('stack', 'merge', 'Acme Shop QA', '--prefer', 'theirs');
  assert.match(locked.stdout, /apps\.orders\.url: ours "http:\/\/localhost:5000", theirs "http:\/\/localhost:5001" - locked, keeps ours\n/);
  assert.match(locked.stdout, /Every conflict is settled: add --apply to make the change\./);

  const done = koppler('stack', 'merge', 'Acme Shop QA', '--prefer', 'theirs', '--apply');
  assert.equal(done.status, 0, done.stderr);
  assert.match(done.stdout, /MERGED Acme Shop QA into Acme Shop: 3 added, 1 conflict settled/);
  const merged = read(file);
  assert.equal(merged.name, 'Acme Shop');
  assert.deepEqual(Object.keys(merged.apps), ['web', 'orders', 'pay']);
  assert.equal(merged.apps.orders.url, 'http://localhost:5000');
  assert.deepEqual(merged.queues, { events: { name: 'shop-events', type: 'sqs' } });
  assert.deepEqual(merged.presets.map(one => one.name), ['Team checkout', 'Payments']);
  // What is left to tell them apart is the locked field.
  assert.match(koppler('stack', 'merge', 'Acme Shop QA').stdout, /locked, keeps ours\nNothing else to merge: what still differs is locked\./);
  fs.rmSync(dir, { recursive: true, force: true });
});

test('stack merge keeps nothing that breaks the stack: the result is checked as a whole, and nothing is written', () => {
  const { dir, shop, qa, koppler, read, write } = sandbox();
  // Fine on its own, but its app's prod settings need the prod it has and this stack does not, and ours is kept.
  const theirs = read(path.join(qa, 'stack.json'));
  theirs.apps.pay.envs = { prod: { url: 'https://pay.acme.example' } };
  write(path.join(qa, 'stack.json'), { ...theirs, envs: ['qa', 'prod'] });
  const before = fs.readFileSync(path.join(shop, 'stack.json'), 'utf8');
  const refused = koppler('stack', 'merge', 'Acme Shop QA', '--prefer', 'ours', '--apply');
  assert.equal(refused.status, 1);
  assert.match(refused.stderr, /apps\.pay\.envs\.prod/);
  assert.equal(fs.readFileSync(path.join(shop, 'stack.json'), 'utf8'), before);
  fs.rmSync(dir, { recursive: true, force: true });
});

test('board copy takes a board as it is to another stack, refusing the apps that stack lacks unless told to drop them', () => {
  const { dir, temp, qa, koppler, read, write } = sandbox();
  const mine = { name: 'Checkout', version: 1, nodes: { web: { run: 'cli' }, orders: { run: 'docker', branch: 'feature/refunds' } }, edges: [{ from: 'web', to: 'orders' }], layout: { nodes: { web: { x: 0, y: 0 }, orders: { x: 340, y: 0 } } } };
  write(path.join(temp, 'state.json'), { preset: 'Checkout', presets: [mine] });
  const shelf = path.join(temp, 'stacks', crypto.createHash('sha1').update(path.resolve(qa)).digest('hex').slice(0, 12), 'state.json');

  const missing = koppler('board', 'copy', 'Checkout', '--to', 'Acme Shop QA');
  assert.equal(missing.status, 1);
  assert.match(missing.stderr, /Acme Shop QA has no Web \(web\); --drop-missing leaves it off the copy/);
  assert.equal(fs.existsSync(shelf), false);

  const copied = koppler('board', 'copy', 'checkout', '--to', 'Acme Shop QA', '--drop-missing');
  assert.equal(copied.status, 0, copied.stderr);
  assert.match(copied.stdout, /COPIED Checkout to Acme Shop QA's boards, without Web/);
  const [board] = read(shelf).presets;
  assert.deepEqual(board.nodes, { orders: { run: 'docker', branch: 'feature/refunds' } });
  assert.deepEqual(board.edges, []);
  assert.deepEqual(board.layout.nodes.orders, { x: 340, y: 0 });
  assert.match(koppler('board', 'copy', 'Checkout', '--to', 'Acme Shop QA', '--drop-missing').stderr, /Acme Shop QA already has a board called Checkout/);

  // From the other stack into the one in use: one of its team boards, run modes and cables as they are.
  const team = koppler('board', 'copy', 'Payments', '--from', 'Acme Shop QA', '--drop-missing');
  assert.equal(team.status, 0, team.stderr);
  assert.match(team.stdout, /COPIED Payments to Acme Shop's boards, without Pay/);
  const payments = read(path.join(temp, 'state.json')).presets.find(one => one.name === 'Payments');
  assert.deepEqual(payments.nodes, { orders: { run: 'cli' } });
  assert.equal(read(path.join(temp, 'board-edits.json')).edits.at(-1).preset.name, 'Payments');
  // And its own boards, kept with it while another stack is in use.
  write(shelf, { presets: [{ name: 'QA smoke', version: 1, nodes: { orders: { run: 'cli' } }, edges: [] }] });
  assert.equal(koppler('board', 'copy', 'QA smoke', '--from', 'Acme Shop QA').status, 0);
  assert.ok(read(path.join(temp, 'state.json')).presets.some(one => one.name === 'QA smoke'));

  assert.match(koppler('board', 'copy', 'Nope', '--to', 'Acme Shop QA').stderr, /no board called Nope/);
  assert.match(koppler('board', 'copy', 'Checkout').stderr, /koppler board copy "<name>" --to\|--from <stack>/);
  assert.match(koppler('board', 'copy', 'Checkout', '--to', 'Acme Shop').stderr, /Acme Shop is the stack in use/);
  fs.rmSync(dir, { recursive: true, force: true });
});

test('stack publish moves the private stack in use into a folder of a clone and uses it from there, never committing', () => {
  const { dir, config, shop, koppler, read } = sandbox();
  const repo = path.join(dir, 'acme-stacks');
  fs.mkdirSync(path.join(repo, 'stacks', 'taken'), { recursive: true });
  fs.writeFileSync(path.join(repo, 'stacks', 'taken', 'stack.json'), '{}');
  execFileSync('git', ['init', '-q', repo]);
  const stack = fs.readFileSync(path.join(shop, 'stack.json'), 'utf8');
  assert.equal(koppler('stack', 'lock', 'apps.web.url').status, 0);

  assert.match(koppler('stack', 'publish', path.join(dir, 'elsewhere', 'shop')).stderr, /is not inside a git clone/);
  assert.match(koppler('stack', 'publish', path.join(repo, 'stacks', 'taken')).stderr, /already holds a stack\.json/);
  assert.match(koppler('stack', 'publish', path.join(repo, 'docs')).stderr, /<clone>\/stacks\/<name> or <clone>\/\.koppler/);
  assert.equal(fs.readFileSync(path.join(shop, 'stack.json'), 'utf8'), stack);

  const target = path.join(repo, 'stacks', 'acme-shop');
  const published = koppler('stack', 'publish', target);
  assert.equal(published.status, 0, published.stderr);
  assert.match(published.stdout, /PUBLISHED Acme Shop to .*stacks\/acme-shop\/stack\.json; it is the stack in use from there/);
  assert.match(published.stdout, /git -C .*acme-stacks add stacks\/acme-shop\/stack\.json/);
  assert.match(published.stdout, /git -C .*acme-stacks commit -m 'Add the Acme Shop stack'/);
  assert.match(published.stdout, /git -C .*acme-stacks push/);
  assert.equal(fs.readFileSync(path.join(target, 'stack.json'), 'utf8'), stack);
  assert.equal(fs.existsSync(shop), false);
  assert.equal(read(path.join(config, 'config.json')).stack, target);
  // Nothing committed: the user does that.
  assert.equal(spawnSync('git', ['-C', repo, 'rev-parse', 'HEAD']).status, 128);
  assert.match(koppler('stack', 'locks').stdout, /apps\.web\.url/);
  assert.match(koppler('stack', 'publish', path.join(repo, 'stacks', 'again')).stderr, /not a private stack/);
  fs.rmSync(dir, { recursive: true, force: true });
});
