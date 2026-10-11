import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { collectSession, keepPreviousLog } from '../dist/session.mjs';

const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'koppler-session-')), logs = path.join(dir, 'logs');
fs.mkdirSync(logs);
// A restart keeps the previous run's log.
const log = path.join(logs, 'api.log');
fs.writeFileSync(log, 'first run\nboom: Unhandled exception\n');
keepPreviousLog(log);
fs.writeFileSync(log, 'second run\n');
assert.match(fs.readFileSync(`${log}.history`, 'utf8'), /first run/);

// Only this session (after the previous finished Stop) is gathered, with a summary of what went wrong.
const runs = [
  { id: 'old', kind: 'run', at: '2026-01-01T09:00:00Z', state: 'done', nodes: { web: {} } },
  { id: 'stop1', kind: 'stop', at: '2026-01-01T09:30:00Z', state: 'done', nodes: {} },
  { id: 'r1', kind: 'run', at: '2026-01-01T10:00:00Z', state: 'failed', reason: 'port held', nodes: { api: {} } },
  { id: 'stop2', kind: 'stop', at: '2026-01-01T10:30:00Z', state: 'done', nodes: {} },
];
fs.writeFileSync(path.join(dir, 'debug.jsonl'), [
  { at: '2026-01-01T09:10:00Z', kind: 'click', what: 'old click' },
  ...Array.from({ length: 5 }, () => ({ at: '2026-01-01T10:05:00Z', kind: 'click', what: 'button#stop' })),
  { at: '2026-01-01T10:06:00Z', kind: 'error', what: 'x is undefined' },
].map(o => JSON.stringify(o)).join('\n'));
fs.writeFileSync(path.join(dir, 'up-r1.log'), 'started api\napi exited: Password=up-not-real\n\nLeft for the agent:\n  - A -> local B: point it at http://x\n');
fs.appendFileSync(log, 'fail: postgres://admin:app-not-real@db/orders refused\n');
fs.writeFileSync(path.join(logs, 'canvas.log'), 'Authorization: Bearer canvas-not-real\n');
const out = collectSession({ temp: dir, logsDir: logs, stop: runs[3], runs });
// Every log gathered for the agent has its secrets masked.
for (const f of ['up-r1.log', 'logs/api.log', 'canvas.log']) assert.doesNotMatch(fs.readFileSync(path.join(out, f), 'utf8'), /not-real/, f);
assert.match(fs.readFileSync(path.join(out, 'logs/api.log'), 'utf8'), /postgres:\/\/\*\*\*:\*\*\*@db\/orders refused/);
const summary = fs.readFileSync(path.join(out, 'summary.md'), 'utf8');
assert.deepEqual(JSON.parse(fs.readFileSync(path.join(out, 'runs.json'), 'utf8')).map(r => r.id), ['r1', 'stop2']);
assert.match(summary, /Failed run r1: port held/);
assert.match(summary, /Koppler left work for the agent in r1/);
assert.match(summary, /1 page errors: x is undefined/);
assert.match(summary, /button#stop x5/);
assert.match(summary, /api 2/);
assert.doesNotMatch(fs.readFileSync(path.join(out, 'debug.jsonl'), 'utf8'), /old click/);
console.log('session tests ok');
