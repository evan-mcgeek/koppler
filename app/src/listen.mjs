// Waits for Send/Stop prompts from the standalone canvas, prints them as JSON lines and consumes them.
// While it waits, temp/listener.json says an agent session is connected, so the canvas can show it.
// Usage: koppler listen --take       connect this session: takes over from any other, and prints this session's id first
//        koppler listen --as <id>    listen again as that session; refused once another session has taken over, or after a disconnect
//        koppler listen --stop       stop whichever session is listening (disconnect); only --take connects again
// Run it in the background; it exits once prompts arrive.
import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import { pickPrompts } from './runs.mjs';
import { TEMP } from './paths.ts';

// When a process started: a pid alone can belong to an unrelated process by now.
const startOf = pid => { try { return execFileSync('ps', ['-p', String(pid), '-o', 'lstart='], { encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] }).trim() || null; } catch { return null; } };
// The listener a record names, if it still runs.
export const listenerPid = record => record?.pid && record.started && startOf(record.pid) === record.started ? record.pid : null;

export function listen(argv) {
  const temp = process.env.KOPPLER_TEMP || TEMP;
  const inbox = path.join(temp, 'prompts.jsonl'), taking = inbox + '.taking', listener = path.join(temp, 'listener.json'), lock = listener + '.lock';
  const read = () => { try { return JSON.parse(fs.readFileSync(listener, 'utf8')); } catch { return null; } };
  const write = record => fs.writeFileSync(listener, JSON.stringify(record) + '\n', { mode: 0o600 });
  // Who is connected changes in one step at a time: a session being replaced cannot undo what the new one just wrote.
  const locked = work => {
    fs.mkdirSync(temp, { recursive: true });
    for (let i = 0; ; i++) {
      try { fs.mkdirSync(lock); break; } catch {
        // A lock left by a process that died is taken over.
        if (i > 200 || Date.now() - (fs.statSync(lock, { throwIfNoEntry: false })?.mtimeMs ?? 0) > 5000) { fs.rmSync(lock, { recursive: true, force: true }); continue; }
        Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, 10);
      }
    }
    try { return work(); } finally { fs.rmSync(lock, { recursive: true, force: true }); }
  };
  const stop = pid => { try { process.kill(pid, 'SIGTERM'); } catch {} };
  const asAt = argv.indexOf('--as'), as = asAt >= 0 ? argv[asAt + 1] : null;

  if (argv.includes('--stop')) {
    const was = locked(() => {
      const current = read(), other = listenerPid(current);
      // The marker stays, so a session listening again as itself is told it was disconnected.
      write({ pid: null, disconnected: new Date().toISOString() });
      if (other && other !== process.pid) stop(other);
      return current && !current.disconnected;
    });
    console.log(was ? 'Disconnected: Sends from the canvas now wait until an agent session connects.' : 'No agent session was connected.');
    process.exit(0);
  }
  // One session listens at a time, so a Send never lands in a session the user is not looking at. A session listening
  // again names itself, so one the user has moved away from cannot take the connection back.
  const takeOver = argv.includes('--take');
  const joined = locked(() => {
    const current = read(), running = listenerPid(current), other = running && running !== process.pid ? running : null;
    if (!takeOver && current?.disconnected) return { refused: 'This session was disconnected from the canvas. It no longer gets Sends; run /koppler-run connect here to connect again.' };
    if (!takeOver && (as ? current?.session && current.session !== as : other)) return { refused: `Another session is connected to the canvas now${current?.since ? ` (since ${current.since})` : ''}. This one no longer gets Sends; run /koppler-run connect here to take it back.` };
    const since = other || !current?.since ? new Date().toISOString() : current.since;
    const session = takeOver ? crypto.randomBytes(4).toString('hex') : as ?? current?.session ?? crypto.randomBytes(4).toString('hex');
    // Registered before the other is stopped: on its way out it sees it is no longer the one connected.
    write({ pid: process.pid, started: startOf(process.pid), since, cwd: process.cwd(), session });
    if (other) stop(other);
    return { since, session };
  });
  if (joined.refused) { console.error(joined.refused); process.exit(3); }
  const { since, session } = joined;
  if (takeOver) console.log(`connected as session ${session}; listen again with: koppler listen --as ${session}`);
  const mine = () => read()?.session === session;
  const release = () => locked(() => { if (read()?.pid === process.pid) fs.rmSync(listener, { force: true }); });
  for (const sig of ['SIGTERM', 'SIGINT', 'SIGHUP']) process.on(sig, () => { try { release(); } catch {} process.exit(0); });

  // True once prompts were handed over; a session that was replaced or disconnected meanwhile takes nothing and ends.
  const take = () => locked(() => {
    if (!mine()) { console.error('Another session is connected to the canvas now, or this one was disconnected. This one no longer gets Sends.'); process.exit(3); }
    // What a listener that died half-way left behind is handed over first, never written over.
    let text = ''; try { text = fs.readFileSync(taking, 'utf8'); } catch {}
    if (!text.trim()) { try { fs.renameSync(inbox, taking); } catch { return false; } text = fs.readFileSync(taking, 'utf8'); }
    const picked = pickPrompts(text.split('\n'));
    // Each prompt handed to the agent is marked in the run history, so the canvas stops showing it as waiting.
    for (const p of picked) { const id = p.data?.id; if (/^[a-z0-9]{6,40}$/.test(id ?? '')) fs.appendFileSync(path.join(temp, 'history.jsonl'), JSON.stringify({ id, event: 'picked', at: new Date().toISOString() }) + '\n', { mode: 0o600 }); }
    process.stdout.write(picked.map(p => JSON.stringify(p) + '\n').join(''));
    fs.unlinkSync(taking);
    // Still connected while the session works on it: the next listen keeps the same "since".
    try { write({ pid: null, since, busy: new Date().toISOString(), cwd: process.cwd(), session }); } catch {}
    return true;
  });
  if (!take()) {
    const timer = setInterval(() => { if (take()) clearInterval(timer); }, 1000);
  }
}
