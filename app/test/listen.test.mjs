import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawn, spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

// One session listens at a time; one the user moved away from cannot take the connection back by listening again.
const koppler = path.join(path.dirname(fileURLToPath(import.meta.url)), '..', 'src', 'koppler.mjs');
const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'koppler-listen-')), env = { ...process.env, KOPPLER_TEMP: dir };
const listener = () => JSON.parse(fs.readFileSync(path.join(dir, 'listener.json'), 'utf8'));
const start = (...args) => new Promise(resolve => { const p = spawn('node', [koppler, 'listen', ...args], { env }); let out = ''; p.stdout.on('data', d => { out += d; if (out.includes('\n')) resolve({ p, out }); }); setTimeout(() => resolve({ p, out }), 1500); });
const wait = ms => new Promise(r => setTimeout(r, ms));

const a = await start('--take');
const idA = a.out.match(/session (\w+)/)[1];
assert.equal(listener().session, idA);
const b = await start('--take');
const idB = b.out.match(/session (\w+)/)[1];
await wait(300);
assert.notEqual(idA, idB);
assert.equal(listener().session, idB);
// A listens again as itself: refused, B keeps the connection.
const again = spawnSync('node', [koppler, 'listen', '--as', idA], { env, encoding: 'utf8' });
assert.equal(again.status, 3);
assert.match(again.stderr, /Another session is connected/);
assert.equal(listener().session, idB);
// B listening again as itself is fine.
b.p.kill(); await wait(300);
const bAgain = spawn('node', [koppler, 'listen', '--as', idB], { env }); await wait(500);
assert.equal(listener().session, idB);
bAgain.kill(); a.p.kill();
fs.rmSync(dir, { recursive: true, force: true });
console.log('listen tests ok');

// The cases a connection must survive, each in its own folder.
{
  const fresh = () => { const d = fs.mkdtempSync(path.join(os.tmpdir(), 'koppler-listen-')); return { d, env: { ...process.env, KOPPLER_TEMP: d }, file: n => path.join(d, n) }; };
  const prompt = n => JSON.stringify({ tag: 'koppler', text: `run ${n}`, data: { id: `run00000${n}` }, at: 't' }) + '\n';
  const run = (t, ...args) => spawnSync('node', [koppler, 'listen', ...args], { env: t.env, encoding: 'utf8', timeout: 8000 });
  const begin = (t, ...args) => new Promise(resolve => { const p = spawn('node', [koppler, 'listen', ...args], { env: t.env }); const got = { p, out: '', err: '', code: null }; p.stdout.on('data', c => { got.out += c; resolve(got); }); p.stderr.on('data', c => { got.err += c; }); p.on('exit', code => { got.code = code; resolve(got); }); });
  const ended = got => new Promise(resolve => got.code !== null ? resolve() : got.p.on('exit', () => resolve()));

  // Prompts a listener took and died before handing over are not lost when the next one starts.
  { const t = fresh(); fs.writeFileSync(t.file('prompts.jsonl.taking'), prompt(1)); fs.writeFileSync(t.file('prompts.jsonl'), prompt(2));
    const first = run(t, '--take'); assert.match(first.stdout, /run 1/); assert.doesNotMatch(first.stdout, /run 2/);
    assert.match(run(t, '--take').stdout, /run 2/); }

  // After a disconnect, a session cannot come back by listening again as itself.
  { const t = fresh(); const a = await begin(t, '--take'), id = a.out.match(/session (\w+)/)[1];
    assert.match(run(t, '--stop').stdout, /^Disconnected/); await ended(a);
    const back = run(t, '--as', id); assert.equal(back.status, 3); assert.match(back.stderr, /was disconnected/);
    assert.match(run(t, '--stop').stdout, /No agent session was connected/);
    const again = await begin(t, '--take'); assert.match(again.out, /connected as session/); again.p.kill(); await ended(again); }

  // A session that was replaced without noticing takes no prompts and leaves the new registration alone.
  { const t = fresh(); const a = await begin(t, '--take');
    const theirs = { pid: null, since: 't', busy: new Date().toISOString(), session: 'other001' };
    fs.writeFileSync(t.file('listener.json'), JSON.stringify(theirs)); fs.writeFileSync(t.file('prompts.jsonl'), prompt(3));
    await ended(a); assert.equal(a.code, 3); assert.doesNotMatch(a.out, /run 3/);
    assert.equal(fs.readFileSync(t.file('prompts.jsonl'), 'utf8'), prompt(3));
    assert.deepEqual(JSON.parse(fs.readFileSync(t.file('listener.json'), 'utf8')), theirs); }

  // A pid left in the file that now belongs to something else is not signalled.
  { const t = fresh(); const bystander = spawn('sleep', ['30']);
    fs.writeFileSync(t.file('listener.json'), JSON.stringify({ pid: bystander.pid, started: 'Thu Jan  1 00:00:00 1970', since: 't', session: 'old00001' }));
    const b = await begin(t, '--take'); assert.match(b.out, /connected as session/);
    run(t, '--stop'); await ended(b); await wait(200);
    assert.equal(bystander.exitCode ?? bystander.signalCode, null); bystander.kill(); }
  console.log('listen cases ok');
}
