// The requests no agent session has taken yet, as the canvas lists them, and dropping one of them.
import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { readStack } from '../data.ts';
import { appendEvent, runs } from '../engine/runs.ts';
import { TEMP } from '../paths.ts';

const PROMPTS = path.join(TEMP, 'prompts.jsonl');
type Loose = Record<string, unknown>;
/** A value from the queue as text, when it is text. */
const text = (value: unknown) => (typeof value === 'string' ? value : '');
/** One waiting request: what it is in a few words, and when it was sent. */
export interface Waiting {
  key: string;
  tag: string;
  at: string;
  what: string;
}
const keyOf = (line: string) => crypto.createHash('sha1').update(line).digest('hex').slice(0, 12);
const lines = (): string[] => {
  try {
    return fs.readFileSync(PROMPTS, 'utf8').split('\n').filter(Boolean);
  } catch {
    return [];
  }
};
const parsed = (line: string): { tag: string; at: string; data: Loose } | null => {
  try {
    const { tag, at, data } = JSON.parse(line) as { tag?: unknown; at?: unknown; data?: Loose };
    return { tag: text(tag), at: text(at) || text(data?.['at']), data: data ?? {} };
  } catch {
    return null;
  }
};

/** What a request asks for, in the words the canvas uses for it. */
function describe(tag: string, data: Loose): string {
  const apps = readStack()?.apps ?? {};
  const name = (id: unknown) => apps[text(id)]?.name ?? text(id);
  const env = text(data['env']).toUpperCase();
  const nodes = Array.isArray(data['nodes']) ? (data['nodes'] as { id?: unknown }[]) : [];
  const on = nodes.map(node => name(node.id)).join(', ');
  const failures = Array.isArray(data['failures']) ? (data['failures'] as { connection?: unknown }[]) : [];
  switch (tag) {
    case 'koppler':
      return `${data['mode'] === 'manual' ? 'Checklist for' : 'Run on'} ${env}${on ? `: ${on}` : ''}`;
    case 'koppler-stop':
      return data['switchTo'] ? 'Stop and revert, then switch stacks' : 'Stop and revert';
    case 'koppler-fix':
      return `Fix ${failures.map(one => text(one.connection)).join(', ') || 'what the Flow check found'}`;
    case 'koppler-facts':
      return data['app'] ? `Fill in ${name(data['app'])}'s settings` : `Find the ${env} facts the stack misses`;
    case 'koppler-reply':
      return 'Your answer to a question';
    case 'koppler-review':
      return 'Review of the last session';
    default:
      return 'A request for the agent';
  }
}

export const waiting = (): Waiting[] =>
  lines().flatMap(line => {
    const prompt = parsed(line);
    return prompt
      ? [{ key: keyOf(line), tag: prompt.tag, at: prompt.at, what: describe(prompt.tag, prompt.data).slice(0, 200) }]
      : [];
  });

/**
 * Takes one request out of the queue. A run or Stop that still waited for it is closed in the history, with the reason.
 * ponytail: the queue is rewritten without the listener's lock; a session taking it in the same instant could still
 * get the dropped request. Share the lock if that is ever seen.
 */
export function drop(key: string): boolean {
  const all = lines();
  const gone = all.find(line => keyOf(line) === key);
  if (!gone) return false;
  const rest = all.filter(line => line !== gone);
  fs.writeFileSync(PROMPTS + '.tmp', rest.map(line => line + '\n').join(''), { mode: 0o600 });
  fs.renameSync(PROMPTS + '.tmp', PROMPTS);
  const id = parsed(gone)?.data['id'];
  if (
    typeof id === 'string' &&
    runs().some(run => run.id === id && (run.state === 'waiting' || run.state === 'applying'))
  )
    appendEvent(id, 'failed', 'Dropped from the canvas before an agent took it');
  return true;
}
