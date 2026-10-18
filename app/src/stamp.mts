// Runs an app's command and keeps when each line it writes arrives, for the log of every app in time order: its output
// goes to its log unchanged, and each line's time (ms since the epoch) to the times file beside it, one per line.
// Usage (through koppler run): stamp.mjs <log> -- <command...>
import { spawn } from 'node:child_process';
import fs from 'node:fs';

const [log = '', dash, ...command] = process.argv.slice(2);
if (!log || dash !== '--' || command.length === 0) {
  console.error('usage: stamp.mjs <log> -- <command...>');
  process.exit(2);
}
const out = fs.openSync(log, 'a', 0o600);
const times = fs.openSync(`${log}.times`, 'a', 0o600);
// Its errors and its output in the order it wrote them: one stream, as when both went straight to the log.
const child = spawn('sh', ['-c', 'exec "$@" 2>&1', 'sh', ...command], { stdio: ['ignore', 'pipe', 'ignore'] });
child.stdout.on('data', (chunk: Buffer) => {
  fs.writeSync(out, chunk);
  let lines = 0;
  for (const byte of chunk) if (byte === 10) lines++;
  if (lines) fs.writeSync(times, `${String(Date.now())}\n`.repeat(lines));
});
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
