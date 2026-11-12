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

test('stack merge refuses while a stack has two team boards with one name, which it could not tell apart', () => {
  const { dir, shop, koppler, read, write } = sandbox();
  const ours = read(path.join(shop, 'stack.json'));
  write(path.join(shop, 'stack.json'), { ...ours, presets: [...ours.presets, { ...ours.presets[0], nodes: { orders: { run: 'cli' } } }] });
  const before = fs.readFileSync(path.join(shop, 'stack.json'), 'utf8');
  const refused = koppler('stack', 'merge', 'Acme Shop QA', '--prefer', 'theirs', '--apply');
  assert.equal(refused.status, 1);
  assert.match(refused.stderr, /Acme Shop has more than one team board called Team checkout: give each its own name first/);
  assert.equal(fs.readFileSync(path.join(shop, 'stack.json'), 'utf8'), before);
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
  const mine = { name: 'Checkout', version: 1, area: 'checkout', nodes: { web: { run: 'cli' }, orders: { run: 'docker', branch: 'feature/refunds' } }, edges: [{ from: 'web', to: 'orders' }], layout: { nodes: { web: { x: 0, y: 0 }, orders: { x: 340, y: 0 } } } };
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
  // An area the other stack does not have is left off: the board takes the area of its apps there.
  assert.equal(board.area, undefined);
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
  // A feature board holds no app that runs here, and still copies.
  const feature = { request: 'Refund an order', phases: [{ name: 'Refund', steps: [{ from: 'pay', to: 'orders' }] }] };
  write(shelf, { presets: [{ name: 'Refunds flow', version: 1, nodes: {}, edges: [], feature }] });
  const flow = koppler('board', 'copy', 'Refunds flow', '--from', 'Acme Shop QA');
  assert.equal(flow.status, 0, flow.stderr);
  assert.deepEqual(read(path.join(temp, 'state.json')).presets.find(one => one.name === 'Refunds flow').feature, feature);

  assert.match(koppler('board', 'copy', 'Nope', '--to', 'Acme Shop QA').stderr, /no board called Nope/);
  assert.match(koppler('board', 'copy', 'Checkout').stderr, /koppler board copy "<name>" --to\|--from <stack>/);
  assert.match(koppler('board', 'copy', 'Checkout', '--to', 'Acme Shop').stderr, /Acme Shop is the stack in use/);
  fs.rmSync(dir, { recursive: true, force: true });
});

test('stack publish moves the private stack in use into a folder of a clone and uses it from there, never committing', () => {
  const { dir, config, temp, shop, koppler, read, write } = sandbox();
  const real = fs.realpathSync(dir);
  const repo = path.join(dir, 'acme-stacks'), bare = path.join(dir, 'no-remote');
  fs.mkdirSync(path.join(repo, 'stacks', 'taken'), { recursive: true });
  fs.writeFileSync(path.join(repo, 'stacks', 'taken', 'stack.json'), '{}');
  execFileSync('git', ['init', '-q', repo]);
  execFileSync('git', ['-C', repo, 'remote', 'add', 'origin', 'git@github.com:acme/stacks.git']);
  execFileSync('git', ['init', '-q', bare]);
  // The stack runs a check of its own, approved for its file where it is now.
  write(path.join(shop, 'stack.json'), { ...read(path.join(shop, 'stack.json')), checks: [{ name: 'Docker', run: 'docker info' }] });
  const stack = fs.readFileSync(path.join(shop, 'stack.json'), 'utf8');
  assert.equal(koppler('stack', 'lock', 'apps.web.url').status, 0);
  write(path.join(temp, 'state.json'), { presets: [{ name: 'Checkout', version: 1, nodes: { web: { run: 'cli' } }, edges: [] }] });
  write(path.join(temp, 'board-edits.json'), { edits: [{ id: 'e1', at: new Date().toISOString(), stack: shop, board: 'Checkout', edit: {} }] });

  assert.match(koppler('stack', 'publish', path.join(dir, 'elsewhere', 'shop')).stderr, /is not inside a git clone/);
  assert.match(koppler('stack', 'publish', path.join(repo, 'stacks', 'taken')).stderr, /already holds a stack\.json/);
  assert.match(koppler('stack', 'publish', path.join(repo, 'docs')).stderr, /<clone>\/stacks\/<name> or <clone>\/\.koppler/);
  assert.match(koppler('stack', 'publish', path.join(bare, 'stacks', 'acme-shop')).stderr, /has no remote: git -C .*no-remote remote add origin <its address>/);
  assert.equal(fs.readFileSync(path.join(shop, 'stack.json'), 'utf8'), stack);

  // A step that fails half-way leaves everything as it was: the copy goes, the lock and the queued edit stay.
  const target = path.join(repo, 'stacks', 'acme-shop');
  fs.chmodSync(shop, 0o500);
  const failed = koppler('stack', 'publish', target);
  fs.chmodSync(shop, 0o700);
  assert.equal(failed.status, 1);
  assert.match(failed.stderr, /could not publish .*; nothing changed/);
  assert.equal(fs.existsSync(path.join(target, 'stack.json')), false);
  assert.equal(fs.readFileSync(path.join(shop, 'stack.json'), 'utf8'), stack);
  assert.equal(read(path.join(config, 'config.json')).stack, shop);
  assert.match(koppler('stack', 'locks').stdout, /apps\.web\.url/);
  assert.equal(read(path.join(temp, 'board-edits.json')).edits[0].stack, shop);

  const published = koppler('stack', 'publish', target);
  assert.equal(published.status, 0, published.stderr);
  assert.match(published.stdout, /PUBLISHED Acme Shop to .*stacks\/acme-shop\/stack\.json; it is the stack in use from there/);
  assert.match(published.stdout, /git -C .*acme-stacks add stacks\/acme-shop\/stack\.json/);
  assert.match(published.stdout, /git -C .*acme-stacks commit -m 'Add the Acme Shop stack'/);
  assert.match(published.stdout, /git -C .*acme-stacks push/);
  assert.match(published.stdout, /Its own commands need approving again where it is now: koppler doctor --approve, in your own terminal/);
  assert.equal(fs.readFileSync(path.join(target, 'stack.json'), 'utf8'), stack);
  assert.equal(fs.existsSync(shop), false);
  const now = read(path.join(config, 'config.json')).stack;
  assert.equal(fs.realpathSync(now), path.join(real, 'acme-stacks', 'stacks', 'acme-shop'));
  assert.equal(read(path.join(temp, 'board-edits.json')).edits[0].stack, now);
  // Nothing committed: the user does that.
  assert.equal(spawnSync('git', ['-C', repo, 'rev-parse', 'HEAD']).status, 128);
  assert.match(koppler('stack', 'locks').stdout, /apps\.web\.url/);
  assert.match(koppler('stack', 'publish', path.join(repo, 'stacks', 'again')).stderr, /not a private stack/);

  // Koppler finds it where it is now, also after a rescan: listed, and switched away from and back to with its boards.
  assert.equal(koppler('sync', '--rescan').status, 0);
  assert.match(koppler('use').stdout, /\* Acme Shop {2}\(shared/);
  assert.equal(koppler('use', 'Acme Shop QA').status, 0);
  const back = koppler('use', 'Acme Shop');
  assert.equal(back.status, 0, back.stderr);
  assert.deepEqual(read(path.join(temp, 'state.json')).presets.map(one => one.name), ['Checkout']);
  fs.rmSync(dir, { recursive: true, force: true });
});

test('use <stack> --boards lists that stack’s boards, its team’s and its own, and keeps the stack in use', () => {
  const { dir, temp, qa, koppler, write } = sandbox();
  const shelf = path.join(temp, 'stacks', crypto.createHash('sha1').update(path.resolve(qa)).digest('hex').slice(0, 12));
  fs.mkdirSync(shelf, { recursive: true });
  write(path.join(shelf, 'state.json'), { presets: [{ name: 'QA smoke', version: 1, nodes: { orders: { run: 'cli' } }, edges: [] }] });
  write(path.join(temp, 'state.json'), { presets: [{ name: 'Mine', version: 1, nodes: { web: { run: 'cli' } }, edges: [] }] });

  const other = koppler('use', 'Acme Shop QA', '--boards');
  assert.equal(other.status, 0, other.stderr);
  assert.equal(other.stdout.trim(), 'Payments  (team board)\nQA smoke  (your board)');
  assert.deepEqual(JSON.parse(koppler('use', 'acme shop qa', '--boards', '--json').stdout).map(one => one.name), ['Payments', 'QA smoke']);
  // The stack in use is the same as before, and naming it lists its boards as --boards alone does.
  assert.match(koppler('use').stdout, /^\* Acme Shop /m);
  assert.equal(koppler('use', 'Acme Shop', '--boards').stdout, koppler('use', '--boards').stdout);
  assert.equal(koppler('use', '--boards').stdout.trim(), 'Team checkout  (team board)\nMine  (your board)');
  assert.match(koppler('use', 'Nope', '--boards').stderr, /no stack called Nope/);
  fs.rmSync(dir, { recursive: true, force: true });
});

test('a stack written with the old run, config and note merges in, its facts carried to start and the notes', () => {
  const { dir, shop, qa, koppler, read, write } = sandbox();
  const old = read(path.join(qa, 'stack.json'));
  Object.assign(old, { koppler: '0.3.2' });
  Object.assign(old.apps.pay, { run: { cli: 'npm run dev' }, config: 'Settings from SSM', note: 'Takes the payments' });
  write(path.join(qa, 'stack.json'), old);

  const merged = koppler('stack', 'merge', 'Acme Shop QA', '--keep', 'apps.orders.url=ours', '--apply');
  assert.equal(merged.status, 0, merged.stderr);
  const stack = read(path.join(shop, 'stack.json'));
  assert.equal(stack.apps.pay.start, 'npm run dev');
  assert.equal(stack.apps.pay.description, 'Takes the payments');
  assert.equal(['run', 'config', 'note'].some(field => field in stack.apps.pay), false);
  assert.deepEqual(stack.notes, ['Pay: Settings from SSM']);
  fs.rmSync(dir, { recursive: true, force: true });
});
