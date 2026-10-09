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
