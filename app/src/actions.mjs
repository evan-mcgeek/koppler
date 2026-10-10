// The action log: every temporary change Koppler or the agent made, which Stop undoes. A lost entry is a change Stop
// can never undo, so the log is written whole (a temporary file, then a rename), under a lock, and a log that cannot
// be read is never taken as empty: Koppler keeps a copy and stops, so a person can repair it first.
import fs from 'node:fs';

const sleep = ms => Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, ms);

export function readActions(file) {
  let text;
  try { text = fs.readFileSync(file, 'utf8'); } catch (e) { if (e.code === 'ENOENT') return []; throw e; }
  if (!text.trim()) return [];
  let list = null;
  try { list = JSON.parse(text); } catch {}
  if (Array.isArray(list)) return list;
  const copy = `${file}.damaged-${new Date().toISOString().replace(/[:.]/g, '-')}`;
  try { fs.copyFileSync(file, copy); } catch {}
  throw new Error(`the action log ${file} is damaged, so Stop could not undo what it lists. A copy is kept at ${copy}. Repair the log (it is a JSON list) or move it away, then try again; nothing else was changed`);
}

function writeActions(file, list) {
  const tmp = `${file}.${process.pid}.tmp`;
  fs.writeFileSync(tmp, JSON.stringify(list, null, 2) + '\n', { mode: 0o600 });
  fs.renameSync(tmp, file);
}

// Reads the log, lets `change` edit it, and writes it back, with no other writer in between. Returns what `change`
// returned. A lock left by a process that died is taken over after 10 seconds.
export function updateActions(file, change) {
  const lock = `${file}.lock`;
  for (let waited = 0; ; waited += 50) {
    try { fs.mkdirSync(lock); break; } catch (e) {
      if (e.code !== 'EEXIST') throw e;
      let age = 0; try { age = Date.now() - fs.statSync(lock).mtimeMs; } catch {}
      if (age > 10000) { fs.rmSync(lock, { recursive: true, force: true }); continue; }
      if (waited > 10000) throw new Error(`the action log ${file} is busy (another Koppler command is writing it); try again`);
      sleep(50);
    }
  }
  try {
    const list = readActions(file), result = change(list);
    writeActions(file, list);
    return result;
  } finally { fs.rmSync(lock, { recursive: true, force: true }); }
}
