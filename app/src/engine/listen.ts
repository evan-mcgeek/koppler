// Waits for Send/Stop prompts from the standalone canvas, prints them as JSON lines and consumes them.
// While it waits, temp/listener.json says an agent session is connected, so the canvas can show it.
// Usage: koppler listen take       connect this session: takes over from any other, and prints this session's id first
//        koppler listen as <id>    listen again as that session; refused once another session has taken over, or after a disconnect
//        koppler listen stop       stop whichever session is listening (disconnect); only take connects again
// Run it in the background; it exits once prompts arrive.
import { execFileSync } from 'node:child_process';
import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { tempDir } from '../paths.ts';
import { Failure } from '../failure.ts';
import type { Prompt } from './history.ts';
import { writeJson } from '../json-files.ts';

/** Who is connected to the canvas, as temp/listener.json has it. */
interface Listener {
  pid: number | null;
  /** When the listening process started: a pid alone can belong to an unrelated process by now. */
  started?: string | null;
  since?: string;
  busy?: string;
  cwd?: string;
  session?: string;
  disconnected?: string;
  /** What the agent said the session works on, and which agent and session of its own it is. */
  name?: string;
  agent?: string;
  agentSession?: string;
}

const startOf = (pid: number) => {
  try {
    const started = execFileSync('ps', ['-p', String(pid), '-o', 'lstart='], {
      encoding: 'utf8',
      stdio: ['ignore', 'pipe', 'ignore'],
    });
    return started.trim() || null;
  } catch {
    return null;
  }
};
/** The listener a record names, if it still runs. */
export const listenerPid = (record: Pick<Listener, 'pid' | 'started'> | null | undefined): number | null =>
  record?.pid && record.started && startOf(record.pid) === record.started ? record.pid : null;

const stop = (pid: number) => {
  try {
    process.kill(pid, 'SIGTERM');
  } catch {
    // It ended by itself.
  }
};
const stamp = () => new Date().toISOString();
const newSession = () => crypto.randomBytes(4).toString('hex');
const REPLACED =
  'Another session is connected to the canvas now, or this one was disconnected. This one no longer gets Sends.';

/** Ends the agent's work on what it took, when that was no run (a fill request, an answer): true when it was working. */
export function finishTaken(): boolean {
  const file = path.join(tempDir(), 'listener.json');
  try {
    const { busy, ...rest } = JSON.parse(fs.readFileSync(file, 'utf8')) as Listener;
    if (!busy) return false;
    writeJson(file, rest);
    return true;
  } catch {
    return false;
  }
}

export async function listen(argv: string[]): Promise<void> {
  const temp = tempDir();
  const inbox = path.join(temp, 'prompts.jsonl');
  const taking = inbox + '.taking';
  const listener = path.join(temp, 'listener.json');
  const lock = listener + '.lock';
  /** The session's name and agent: given now, or kept from when it connected. */
  const who = (current: Listener | null): Pick<Listener, 'name' | 'agent' | 'agentSession'> => {
    const kept = takeOver ? undefined : current;
    const claude = process.env['CLAUDE_CODE_SESSION_ID'];
    const agent = claude ? 'Claude Code' : kept?.agent;
    const agentSession = claude ?? kept?.agentSession;
    const name = given ?? kept?.name;
    return { ...(name && { name }), ...(agent && { agent }), ...(agentSession && { agentSession }) };
  };
  const read = (): Listener | null => {
    try {
      return JSON.parse(fs.readFileSync(listener, 'utf8')) as Listener | null;
    } catch {
      return null;
    }
  };
  const write = (record: Listener) => {
    writeJson(listener, record);
  };
  // Who is connected changes in one step at a time: a session being replaced cannot undo what the new one just wrote.
  function locked<T>(work: () => T): T {
    fs.mkdirSync(temp, { recursive: true });
    for (let tries = 0; ; tries++) {
      try {
        fs.mkdirSync(lock);
        break;
      } catch {
        // A lock left by a process that died is taken over.
        const age = Date.now() - (fs.statSync(lock, { throwIfNoEntry: false })?.mtimeMs ?? 0);
        if (tries > 200 || age > 5000) fs.rmSync(lock, { recursive: true, force: true });
        else Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, 10);
      }
    }
    try {
      return work();
    } finally {
      fs.rmSync(lock, { recursive: true, force: true });
    }
  }

  if (argv[0] === 'stop') {
    const was = locked(() => {
      const current = read();
      const other = listenerPid(current);
      // The marker stays, so a session listening again as itself is told it was disconnected.
      write({ pid: null, disconnected: stamp() });
      if (other && other !== process.pid) stop(other);
      return current && !current.disconnected;
    });
    console.log(
      was
        ? 'Disconnected: Sends from the canvas now wait until an agent session connects.'
        : 'No agent session was connected.',
    );
    return;
  }
  // One session listens at a time, so a Send never lands in a session the user is not looking at. A session listening
  // again names itself, so one the user has moved away from cannot take the connection back.
  const as = argv[0] === 'as' ? argv[1] : undefined;
  const takeOver = argv[0] === 'take';
  const named = argv.indexOf('--name');
  const given = named < 0 ? undefined : (argv[named + 1] ?? '').replace(/\s+/g, ' ').trim().slice(0, 80) || undefined;
  const joined = locked((): { refused: string } | { refused?: undefined; since: string; session: string } => {
    const current = read();
    const running = listenerPid(current);
    const other = running && running !== process.pid ? running : null;
    if (!takeOver && current?.disconnected)
      return {
        refused:
          'This session was disconnected from the canvas. It no longer gets Sends; run /koppler-run connect here to connect again.',
      };
    if (!takeOver && (as ? current?.session && current.session !== as : other)) {
      const from = current?.since ? ` (since ${current.since})` : '';
      return {
        refused: `Another session is connected to the canvas now${from}. This one no longer gets Sends; run /koppler-run connect here to take it back.`,
      };
    }
    const since = other || !current?.since ? stamp() : current.since;
    const session = takeOver ? newSession() : (as ?? current?.session ?? newSession());
    // Registered before the other is stopped: on its way out it sees it is no longer the one connected.
    write({ pid: process.pid, started: startOf(process.pid), since, cwd: process.cwd(), session, ...who(current) });
    if (other) stop(other);
    return { since, session };
  });
  if (joined.refused !== undefined) throw new Failure(joined.refused, 3);
  const { since, session } = joined;
  if (takeOver) console.log(`connected as session ${session}; listen again with: koppler listen as ${session}`);
  const release = () => {
    locked(() => {
      if (read()?.pid === process.pid) fs.rmSync(listener, { force: true });
    });
  };
  for (const signal of ['SIGTERM', 'SIGINT', 'SIGHUP'] as const)
    process.on(signal, () => {
      try {
        release();
      } catch {
        // Ending anyway.
      }
      process.exit(0);
    });

  // True once prompts were handed over; a session that was replaced or disconnected meanwhile takes nothing and ends.
  const take = () =>
    locked(() => {
      if (read()?.session !== session) throw new Failure(REPLACED, 3);
      // What a listener that died half-way left behind is handed over first, never written over.
      let text = '';
      try {
        text = fs.readFileSync(taking, 'utf8');
      } catch {
        // Nothing was left behind.
      }
      if (!text.trim()) {
        try {
          fs.renameSync(inbox, taking);
        } catch {
          return false;
        }
        text = fs.readFileSync(taking, 'utf8');
      }
      const picked = pickPrompts(text.split('\n'));
      // Each prompt handed to the agent is marked in the run history, so the canvas stops showing it as waiting.
      for (const prompt of picked) {
        const id = prompt.data?.['id'];
        if (typeof id !== 'string' || !/^[a-z0-9]{6,40}$/.test(id)) continue;
        const event = JSON.stringify({ id, event: 'picked', at: stamp() });
        fs.appendFileSync(path.join(temp, 'history.jsonl'), event + '\n', { mode: 0o600 });
      }
      process.stdout.write(picked.map(prompt => JSON.stringify(prompt) + '\n').join(''));
      fs.unlinkSync(taking);
      // Still connected while the session works on it: the next listen keeps the same "since".
      try {
        write({ pid: null, since, busy: stamp(), cwd: process.cwd(), session, ...who(read()) });
      } catch {
        // The prompts are out; the marker is a courtesy.
      }
      return true;
    });
  while (!take()) await new Promise(done => setTimeout(done, 1000));
}

/**
 * What a listener hands the agent from the queue: of the Sends and Stops only the newest (it replaces the rest, which
 * then show as replaced), every other prompt as it is; each with the minutes it waited, so a stale one is asked about first.
 */
export function pickPrompts(lines: string[], now = Date.now()): (Prompt & { waited: number })[] {
  const all = lines.flatMap(line => {
    try {
      const prompt = JSON.parse(line) as Prompt | null;
      return prompt ? [prompt] : [];
    } catch {
      return [];
    }
  });
  const boards = all.filter(prompt => prompt.tag === 'koppler' || prompt.tag === 'koppler-stop');
  const newest = boards.at(-1);
  return all
    .filter(prompt => !boards.includes(prompt) || prompt === newest)
    .map(prompt => ({
      ...prompt,
      waited: Math.max(0, Math.round((now - Date.parse(prompt.at ?? '')) / 60000)) || 0,
    }));
}
