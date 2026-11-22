// Runs an app's command and keeps when each line it writes arrives, for the log of every app in time order: its output
// goes to its log unchanged, and each line's time (ms since the epoch) to the times file beside it, one per line.
// Usage (through koppler run): stamp.mjs <log> -- <command...>
import { spawn } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { LOGIN_PROMPT, needsLoginLine, needsLoginMessage, recentPrompts, tooManyPrompts } from './core/access-login.ts';
import { appendMessage } from './engine/messages.ts';

const [log = '', dash, ...command] = process.argv.slice(2);
if (!log || dash !== '--' || command.length === 0) {
  console.error('usage: stamp.mjs <log> -- <command...>');
  process.exit(2);
}
const out = fs.openSync(log, 'a', 0o600);
const times = fs.openSync(`${log}.times`, 'a', 0o600);
// Its errors and its output in the order it wrote them: one stream, as when both went straight to the log.
const child = spawn('sh', ['-c', 'exec "$@" 2>&1', 'sh', ...command], { stdio: ['ignore', 'pipe', 'ignore'] });
let prompts: number[] = [];
// The end of the last chunk, so a prompt split across two chunks is still found.
let carry = '';
let stopping = false;
child.stdout.on('data', (chunk: Buffer) => {
  if (stopping) return;
  fs.writeSync(out, chunk);
  let lines = 0;
  for (const byte of chunk) if (byte === 10) lines++;
  if (lines) fs.writeSync(times, `${String(Date.now())}\n`.repeat(lines));
  const now = Date.now();
  const text = carry + chunk.toString('utf8');
  for (let at = text.indexOf(LOGIN_PROMPT); at >= 0; at = text.indexOf(LOGIN_PROMPT, at + 1)) prompts.push(now);
  carry = text.slice(-(LOGIN_PROMPT.length - 1));
  prompts = recentPrompts(prompts, now);
  if (tooManyPrompts(prompts, now)) stopLoggedOut();
});
/** Ends the whole process group, the keep-alive loop included, so nothing starts the tunnel again. */
function stopLoggedOut() {
  stopping = true;
  fs.writeSync(out, `${needsLoginLine(command)}\n`);
  fs.writeSync(times, `${String(Date.now())}\n`);
  try {
    appendMessage(needsLoginMessage(path.basename(log, '.log'), command));
  } catch {
    // The log and status still say it.
  }
  try {
    process.kill(-process.pid, 'SIGTERM');
  } catch {
    child.kill('SIGTERM');
  }
}
for (const signal of ['SIGTERM', 'SIGINT', 'SIGHUP'] as const)
  process.on(signal, () => {
    child.kill(signal);
  });
child.on('error', error => {
  fs.writeSync(out, `${error.message}\n`);
  fs.writeSync(times, `${String(Date.now())}\n`);
  process.exit(127);
});
// Ends as the app ends, with its exit code: a step that runs to completion is judged by it.
child.on('close', (code, signal) => {
  process.exit(code ?? (signal ? 128 : 1));
});
