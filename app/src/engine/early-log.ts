// An app can start and answer, and still log errors in its first seconds: a failed migration, a missing setting, a
// connection refused. After a run starts apps, their logs are read for a while for those.
import fs from 'node:fs';
import { redact } from '../scrub.ts';
import { alive, readRecord, sleep } from './processes.ts';

/** How long after its start an app's log is read, in seconds. */
export const earlyLogSeconds = () => Number(process.env['KOPPLER_EARLY_LOG'] ?? 30);

const PROBLEM = /\b(error|exception|fatal|unhandled|panic|traceback|refused|failed)\b|^\s*(fail|crit):/i;
const NOT_ONE = /\b(no|0) (errors?|exceptions?|failures?)\b|\berrors?: 0\b/i;

/** The lines of a log that tell of a problem, secrets masked, at most `most`. */
export function launchProblems(text: string, most = 5): string[] {
  return text
    .split('\n')
    .map(line => line.trim())
    .filter(line => line && PROBLEM.test(line) && !NOT_ONE.test(line))
    .slice(0, most)
    .map(line => redact(line).slice(0, 240));
}

/** What each app's first seconds showed: nothing wrong, the lines that tell of a problem, or that it stopped. */
export async function readEarlyLogs(ids: string[]): Promise<Record<string, { stopped: boolean; lines: string[] }>> {
  const seconds = earlyLogSeconds();
  const records = ids.flatMap(id => {
    const record = readRecord(id);
    return record ? [{ id, record }] : [];
  });
  const last = Math.max(0, ...records.map(({ record }) => Date.parse(record.startedAt) + seconds * 1000 - Date.now()));
  await sleep(last);
  return Object.fromEntries(
    records.map(({ id, record }) => {
      let text = '';
      try {
        text = fs.readFileSync(record.log, 'utf8');
      } catch {
        // No log to read: nothing to say about it.
      }
      return [id, { stopped: !alive(record), lines: launchProblems(text) }];
    }),
  );
}
