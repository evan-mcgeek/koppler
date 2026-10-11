// Session review, while Koppler itself is worked on (run from its source folder): after a full Stop and revert, everything
// the session left behind is gathered in one folder, and the agent is asked to find and fix the problems the user ran into.
import fs from 'node:fs';
import path from 'node:path';
import { CODE } from '../paths.ts';
import { redact } from '../scrub.ts';

/** A run of the session, as far as the review reads it. */
interface SessionRun {
  id: string;
  at?: string;
  kind?: string;
  state?: string;
  reason?: string | undefined;
  nodes?: object;
  layout?: unknown;
}
/** A line of the canvas's debug log or of the message history. */
type Entry = Record<string, unknown> & { at?: string; kind?: string; what?: string; title?: string };

export const isDev = (): boolean => !fs.realpathSync(CODE).split(path.sep).join('/').includes('/plugins/cache/');
const read = (file: string) => {
  try {
    return fs.readFileSync(file, 'utf8');
  } catch {
    return '';
  }
};
const lastLines = (text: string, count: number) => text.trimEnd().split('\n').slice(-count).join('\n');
const jsonl = (text: string): Entry[] =>
  text.split('\n').flatMap(line => {
    try {
      const entry = JSON.parse(line) as Entry | null;
      return entry ? [entry] : [];
    } catch {
      return [];
    }
  });
const PROBLEM = /\b(error|exception|failed|fatal|unhandled|refused|denied|timed? ?out)\b/i;
const STATES = ['done', 'failed', 'replaced', 'applying', 'waiting'];
const indented = (text: string) =>
  text
    .trim()
    .split('\n')
    .map(line => `  ${line.trim()}`)
    .join('\n');

/** Gathers the session in a folder and returns it. The session is every run after the previous finished Stop, up to and with this one. */
export function collectSession({
  temp,
  logsDir,
  stop,
  runs,
}: {
  temp: string;
  logsDir: string;
  stop: { id: string };
  runs: SessionRun[];
}): string {
  const at = runs.findIndex(run => run.id === stop.id);
  const before = runs.slice(0, at).findLastIndex(run => run.kind === 'stop' && run.state === 'done');
  const session = runs.slice(before + 1, at + 1);
  const from = session[0]?.at ?? '';
  const to = new Date().toISOString();
  const inRange = (entry: Entry) => (entry.at ?? '') >= from && (entry.at ?? '') <= to;
  const dir = path.join(temp, 'sessions', stop.id);
  fs.mkdirSync(path.join(dir, 'logs'), { recursive: true });
  const write = (name: string, body: string) => {
    fs.writeFileSync(path.join(dir, name), body, { mode: 0o600 });
  };
  const lines = (entries: Entry[]) => entries.map(entry => JSON.stringify(entry)).join('\n');

  write(
    'runs.json',
    JSON.stringify(
      session.map(({ layout, ...run }) => run),
      null,
      2,
    ),
  );
  const clicks = jsonl(read(path.join(temp, 'debug.jsonl'))).filter(inRange);
  write('debug.jsonl', lines(clicks));
  const messages = jsonl(read(path.join(temp, 'messages.jsonl'))).filter(entry => !entry.at || inRange(entry));
  write('messages.jsonl', lines(messages));
  const ups = session
    .map(run => [run.id, redact(read(path.join(temp, `up-${run.id}.log`)))] as const)
    .filter(([, text]) => text);
  for (const [id, text] of ups) write(`up-${id}.log`, text);
  const apps = [...new Set(session.flatMap(run => Object.keys(run.nodes ?? {})))];
  const appLogs = apps
    .map(id => {
      const log = path.join(logsDir, `${id}.log`);
      return [id, redact(lastLines(read(`${log}.history`) + read(log), 3000))] as const;
    })
    .filter(([, text]) => text.trim());
  for (const [id, text] of appLogs) write(path.join('logs', `${id}.log`), text);
  write('canvas.log', redact(lastLines(read(path.join(logsDir, 'canvas.log')), 400)));

  // What went wrong, at a glance; the details are in the files next to it.
  const failed = session.filter(run => run.state === 'failed');
  const left = ups.filter(([, text]) => text.includes('Left for the agent:'));
  const pageErrors = clicks.filter(entry => entry.kind === 'error');
  const warnings = clicks.filter(entry => entry.kind === 'message');
  const questions = messages.filter(message => message.kind === 'question');
  const clicked: Record<string, number> = {};
  for (const { kind, what = '' } of clicks) if (kind === 'click') clicked[what] = (clicked[what] ?? 0) + 1;
  const repeats = Object.entries(clicked)
    .filter(([, count]) => count >= 4)
    .sort((a, b) => b[1] - a[1])
    .slice(0, 8);
  const logProblems = appLogs
    .map(([id, text]) => [id, text.split('\n').filter(line => PROBLEM.test(line)).length] as const)
    .filter(([, count]) => count);
  const states = STATES.map(state => [state, session.filter(run => run.state === state).length] as const)
    .filter(([, count]) => count)
    .map(([state, count]) => `${String(count)} ${state}`);
  const quoted = (texts: unknown[]) => texts.map(text => `"${String(text)}"`).join('; ');
  const summary = [
    `# Session ${from.slice(0, 16)} to ${to.slice(0, 16)}`,
    '',
    `${String(session.length)} runs: ${states.join(', ')}.`,
    ...failed.map(run => `- Failed ${String(run.kind)} ${run.id}: ${run.reason ?? 'no reason given'}`),
    ...left.map(
      ([id, text]) =>
        `- Koppler left work for the agent in ${id}:\n${indented(text.split('Left for the agent:')[1] ?? '')}`,
    ),
    `${String(questions.length)} questions from the agent${questions.length ? `: ${quoted(questions.map(question => question.title))}` : ''}.`,
    `${String(pageErrors.length)} page errors${
      pageErrors.length
        ? `: ${pageErrors
            .slice(0, 5)
            .map(error => String(error.what))
            .join('; ')}`
        : ''
    }.`,
    `Messages the user saw: ${quoted(warnings.slice(-10).map(warning => warning.what)) || 'none'}.`,
    repeats.length
      ? `Clicked many times (a sign of something not working): ${repeats.map(([what, count]) => `${what} x${String(count)}`).join('; ')}.`
      : 'Nothing clicked over and over.',
    logProblems.length
      ? `Error-like lines in app logs: ${logProblems.map(([id, count]) => `${id} ${String(count)}`).join(', ')} (logs/).`
      : 'No error-like lines in app logs.',
  ];
  write('summary.md', summary.join('\n') + '\n');
  return dir;
}

/** The previous log of an app is kept before a new run starts, so a session keeps every run's output (rolling, 5 MB). */
export function keepPreviousLog(log: string): void {
  try {
    const old = fs.readFileSync(log, 'utf8');
    if (!old.trim()) return;
    const history = `${log}.history`;
    const joined = read(history) + old + '\n';
    fs.writeFileSync(history, joined.length > 5_000_000 ? joined.slice(-5_000_000) : joined, { mode: 0o600 });
  } catch {
    // No log yet: nothing to keep.
  }
}
