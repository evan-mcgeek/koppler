// Waits for Send/Stop prompts from the standalone canvas, prints them as JSON lines and consumes them.
// While it waits, temp/listener.json says an agent session is connected, so the canvas can show it.
// Usage: koppler listen --take       connect this session: takes over from any other, and prints this session's id first
//        koppler listen --as <id>    listen again as that session; refused once another session has taken over
//        koppler listen --stop       stop whichever session is listening (disconnect)
// Run it in the background; it exits once prompts arrive.
import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { pickPrompts } from './runs.mjs';
import { TEMP } from './paths.mjs';

export function listen(argv) {
  const temp = process.env.KOPPLER_TEMP || TEMP;
  const inbox = path.join(temp, 'prompts.jsonl'), taking = inbox + '.taking', listener = path.join(temp, 'listener.json');
  const alive = pid => { try { process.kill(pid, 0); return true; } catch { return false; } };
  const current = (() => { try { return JSON.parse(fs.readFileSync(listener, 'utf8')); } catch { return null; } })();
  const other = current && current.pid !== process.pid && alive(current.pid) ? current : null;
  const asAt = argv.indexOf('--as'), as = asAt >= 0 ? argv[asAt + 1] : null;

  if (argv.includes('--stop')) {
    const was = other || fs.existsSync(listener);
    if (other) process.kill(other.pid, 'SIGTERM');
    fs.rmSync(listener, { force: true });
    console.log(was ? 'Disconnected: Sends from the canvas now wait until an agent session connects.' : 'No agent session was connected.');
    process.exit(0);
  }
  // One session listens at a time, so a Send never lands in a session the user is not looking at. A session listening
  // again names itself, so one the user has moved away from cannot take the connection back.
  const takeOver = argv.includes('--take');
  if (!takeOver && (as ? current?.session && current.session !== as : other)) {
    console.error(`Another session is connected to the canvas now${current?.since ? ` (since ${current.since})` : ''}. This one no longer gets Sends; run /koppler-run connect here to take it back.`);
    process.exit(3);
  }
  if (other) process.kill(other.pid, 'SIGTERM');
  const since = (() => { try { const l = JSON.parse(fs.readFileSync(listener, 'utf8')); return other ? new Date().toISOString() : l.since ?? new Date().toISOString(); } catch { return new Date().toISOString(); } })();
  fs.mkdirSync(temp, { recursive: true });
  const session = takeOver ? crypto.randomBytes(4).toString('hex') : as ?? current?.session ?? crypto.randomBytes(4).toString('hex');
  fs.writeFileSync(listener, JSON.stringify({ pid: process.pid, since, cwd: process.cwd(), session }) + '\n', { mode: 0o600 });
  if (takeOver) console.log(`connected as session ${session}; listen again with: koppler listen --as ${session}`);
  const release = () => { try { if (JSON.parse(fs.readFileSync(listener, 'utf8')).pid === process.pid) fs.rmSync(listener); } catch {} };
  for (const sig of ['SIGTERM', 'SIGINT', 'SIGHUP']) process.on(sig, () => { release(); process.exit(0); });

  const take = () => {
    try { fs.renameSync(inbox, taking); } catch { return false; }
    const picked = pickPrompts(fs.readFileSync(taking, 'utf8').split('\n'));
    // Each prompt handed to the agent is marked in the run history, so the canvas stops showing it as waiting.
    for (const p of picked) { const id = p.data?.id; if (/^[a-z0-9]{6,40}$/.test(id ?? '')) fs.appendFileSync(path.join(temp, 'history.jsonl'), JSON.stringify({ id, event: 'picked', at: new Date().toISOString() }) + '\n', { mode: 0o600 }); }
    process.stdout.write(picked.map(p => JSON.stringify(p) + '\n').join(''));
    fs.unlinkSync(taking);
    // Still connected while the session works on it: the next listen keeps the same "since".
    try { fs.writeFileSync(listener, JSON.stringify({ pid: null, since, busy: new Date().toISOString(), cwd: process.cwd(), session }) + '\n', { mode: 0o600 }); } catch {}
    return true;
  };
  if (!take()) {
    const timer = setInterval(() => { if (take()) clearInterval(timer); }, 1000);
  }
}
