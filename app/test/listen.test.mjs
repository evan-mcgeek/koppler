import './sandbox.mjs';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawn, spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { until } from './helpers.mjs';
import { test } from 'node:test';

let a, again, b, bAgain, dir, env, gone, idA, idB, koppler, listener, wait;
test('One session listens at a time; one the user moved away from cannot take the connection back by listening again.', async () => {
  koppler = path.join(path.dirname(fileURLToPath(import.meta.url)), '..', 'dist', 'koppler.mjs');
  dir = fs.mkdtempSync(path.join(os.tmpdir(), 'koppler-listen-')), env = { ...process.env, KOPPLER_TEMP: dir };
  listener = () => { try { return JSON.parse(fs.readFileSync(path.join(dir, 'listener.json'), 'utf8')); } catch { return {}; } };
  gone = child => new Promise(resolve => child.exitCode !== null || child.signalCode ? resolve() : child.once('exit', resolve));
  const start = (...args) => new Promise(resolve => { const p = spawn('node', [koppler, 'listen', ...args], { env }); let out = ''; p.stdout.on('data', d => { out += d; if (out.includes('\n')) resolve({ p, out }); }); setTimeout(() => resolve({ p, out }), 1500); });
  wait = ms => new Promise(r => setTimeout(r, ms));

  a = await start('take');
  idA = a.out.match(/session (\w+)/)[1];
  assert.equal(listener().session, idA);
  b = await start('take');
  idB = b.out.match(/session (\w+)/)[1];
  assert.notEqual(idA, idB);
});

test('A is stopped by B taking over, and B stays the one connected.', async () => {
  await gone(a.p);
  assert.equal(listener().session, idB);
});

test('A listens again as itself: refused, B keeps the connection.', async () => {
  again = spawnSync('node', [koppler, 'listen', 'as', idA], { env, encoding: 'utf8' });
  assert.equal(again.status, 3);
  assert.match(again.stderr, /Another session is connected/);
  assert.equal(listener().session, idB);
});

test('B listening again as itself is fine.', async () => {
  b.p.kill(); await gone(b.p);
  bAgain = spawn('node', [koppler, 'listen', 'as', idB], { env });
  await until('B listening again', () => listener().pid === bAgain.pid);
  assert.equal(listener().session, idB);
});

test('A listener releases its connection on its way out, which writes in the folder: wait for it before removing the folder.', async () => {
  bAgain.kill(); a.p.kill(); await gone(bAgain);
  fs.rmSync(dir, { recursive: true, force: true });
});

test('The cases a connection must survive, each in its own folder.', async () => {
  const fresh = () => { const d = fs.mkdtempSync(path.join(os.tmpdir(), 'koppler-listen-')); return { d, env: { ...process.env, KOPPLER_TEMP: d }, file: n => path.join(d, n) }; };
  const prompt = n => JSON.stringify({ tag: 'koppler', text: `run ${n}`, data: { id: `run00000${n}` }, at: 't' }) + '\n';
  const run = (t, ...args) => spawnSync('node', [koppler, 'listen', ...args], { env: t.env, encoding: 'utf8', timeout: 8000 });
  const begin = (t, ...args) => new Promise(resolve => { const p = spawn('node', [koppler, 'listen', ...args], { env: t.env }); const got = { p, out: '', err: '', code: null }; p.stdout.on('data', c => { got.out += c; resolve(got); }); p.stderr.on('data', c => { got.err += c; }); p.on('exit', code => { got.code = code; resolve(got); }); });
  const ended = got => new Promise(resolve => got.code !== null ? resolve() : got.p.on('exit', () => resolve()));

  // Prompts a listener took and died before handing over are not lost when the next one starts.
  { const t = fresh(); fs.writeFileSync(t.file('prompts.jsonl.taking'), prompt(1)); fs.writeFileSync(t.file('prompts.jsonl'), prompt(2));
    const first = run(t, 'take'); assert.match(first.stdout, /run 1/); assert.doesNotMatch(first.stdout, /run 2/);
    assert.match(run(t, 'take').stdout, /run 2/); }

  // An inbox with no prompt in it hands nothing over: the listener keeps waiting for the next real one.
  { const t = fresh(); fs.writeFileSync(t.file('prompts.jsonl'), '\nnot json\n');
    const a = await begin(t, 'take'); assert.match(a.out, /connected as session/);
    await wait(1500); assert.equal(a.code, null);
    fs.writeFileSync(t.file('prompts.jsonl'), prompt(4)); await ended(a);
    assert.equal(a.code, 0); assert.match(a.out, /run 4/); }

  // After a disconnect, a session cannot come back by listening again as itself.
  { const t = fresh(); const a = await begin(t, 'take'), id = a.out.match(/session (\w+)/)[1];
    assert.match(run(t, 'stop').stdout, /^Disconnected/); await ended(a);
    const back = run(t, 'as', id); assert.equal(back.status, 3); assert.match(back.stderr, /was disconnected/);
    assert.match(run(t, 'stop').stdout, /No agent session was connected/);
    const again = await begin(t, 'take'); assert.match(again.out, /connected as session/); again.p.kill(); await ended(again); }

  // A session that was replaced without noticing takes no prompts and leaves the new registration alone.
  { const t = fresh(); const a = await begin(t, 'take');
    const theirs = { pid: null, since: 't', busy: new Date().toISOString(), session: 'other001' };
    fs.writeFileSync(t.file('listener.json'), JSON.stringify(theirs)); fs.writeFileSync(t.file('prompts.jsonl'), prompt(3));
    await ended(a); assert.equal(a.code, 3); assert.doesNotMatch(a.out, /run 3/);
    assert.equal(fs.readFileSync(t.file('prompts.jsonl'), 'utf8'), prompt(3));
    assert.deepEqual(JSON.parse(fs.readFileSync(t.file('listener.json'), 'utf8')), theirs); }

  // A pid left in the file that now belongs to something else is not signalled.
  { const t = fresh(); const bystander = spawn('sleep', ['30']);
    fs.writeFileSync(t.file('listener.json'), JSON.stringify({ pid: bystander.pid, started: 'Thu Jan  1 00:00:00 1970', since: 't', session: 'old00001' }));
    const b = await begin(t, 'take'); assert.match(b.out, /connected as session/);
    // Nothing to wait for but time: a signal sent by mistake would have arrived by now.
    run(t, 'stop'); await ended(b); await wait(200);
    assert.equal(bystander.exitCode ?? bystander.signalCode, null); bystander.kill(); }
});

test("A Claude Code session connects under the name Claude Code shows for it, and a rename shows when it listens again.", async () => {
  const entry = path.join(path.dirname(fileURLToPath(import.meta.url)), '..', 'dist', 'koppler.mjs');
  const own = fs.mkdtempSync(path.join(os.tmpdir(), 'koppler-listen-name-'));
  const claude = path.join(own, 'claude');
  const id = 'c0ffee00-1111-2222-3333-444455556666';
  const transcript = path.join(claude, 'projects', '-Users-me-src', `${id}.jsonl`);
  fs.mkdirSync(path.dirname(transcript), { recursive: true });
  const title = record => fs.appendFileSync(transcript, JSON.stringify({ ...record, sessionId: id }) + '\n');
  title({ type: 'ai-title', aiTitle: 'Fixing the cable check' });
  const named = { ...process.env, KOPPLER_TEMP: own, CLAUDE_CODE_SESSION_ID: id, CLAUDE_CONFIG_DIR: claude };
  const read = () => JSON.parse(fs.readFileSync(path.join(own, 'listener.json'), 'utf8'));
  const started = [];
  const listen = (...args) => {
    const child = spawn('node', [entry, 'listen', ...args], { env: named, stdio: 'ignore' });
    started.push(child);
    return child;
  };
  try {
    const first = listen('take');
    await until('it connects', () => fs.existsSync(path.join(own, 'listener.json')) && read().pid === first.pid);
    assert.deepEqual([read().name, read().agent, read().agentSession], ['Fixing the cable check', 'Claude Code', id]);
    // A request is handed over: the listener ends, and the session is marked as working on it, still named.
    fs.writeFileSync(path.join(own, 'prompts.jsonl'), JSON.stringify({ tag: 'koppler', text: 'run', data: { id: 'abcdef12' } }) + '\n');
    await until('it hands the request over', () => first.exitCode !== null);
    assert.equal(read().name, 'Fixing the cable check');
    title({ type: 'custom-title', customTitle: 'Koppler release' });
    const back = listen('as', read().session);
    await until('it listens again', () => read().pid === back.pid);
    assert.equal(read().name, 'Koppler release');
  } finally {
    for (const child of started) child.kill();
  }
});
