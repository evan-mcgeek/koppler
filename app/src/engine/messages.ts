// Messages from the agent to the canvas, and the user's answers back. Plain text only: the canvas never renders them as code.
// Usage: koppler say [--file <json>]        a message, as JSON on stdin or in a file (see sanitizeMessage)
//        koppler say --answered <id> [--text <how>]   the user answered in the chat instead; the canvas shows it as answered
import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { flagValue } from '../cli/output.ts';
import { fail } from '../failure.ts';
import { TEMP } from '../paths.ts';
import { runs } from './runs.ts';

interface Section {
  title: string;
  items: string[];
  /** What the user runs in their own terminal; the canvas shows each in a box with a Copy button. */
  commands?: string[];
}
interface Choice {
  id: string;
  label: string;
  detail?: string;
}
export interface Message {
  kind: string;
  title: string;
  summary?: string;
  /** The run it is about. */
  run?: string;
  apps?: string[];
  sections?: Section[];
  choices?: Choice[];
}
interface Answer {
  choice?: string;
  text?: string;
  /** Where it was answered: on the canvas, in the chat, dismissed, or replaced by a newer Send. */
  via?: string;
}
export type Shown = Message & { id: string; at: string; answered?: Answer & { at: string | undefined } };
type Loose = Record<string, unknown>;

const file = () => path.join(process.env['KOPPLER_TEMP'] || TEMP, 'messages.jsonl');
const text = (value: unknown, max: number) => (typeof value === 'string' ? value.trim().slice(0, max) : '');
const listOf = (value: unknown) => (Array.isArray(value) ? (value as unknown[]) : []);
const texts = (value: unknown, most: number, max: number) =>
  listOf(value)
    .slice(0, most)
    .map(item => text(item, max))
    .filter(Boolean);
const matching = (pattern: RegExp, value: unknown): value is string => typeof value === 'string' && pattern.test(value);
const KINDS = ['question', 'result', 'failure', 'info'];
const append = (line: object) => {
  fs.appendFileSync(file(), JSON.stringify(line) + '\n', { mode: 0o600 });
};

/**
 * A message as it may be shown: only known fields, each cut to size.
 * { kind, title, summary?, run?, apps?: [ids], sections?: [{ title, items: [text], commands?: [text] }], choices?: [{ id, label, detail? }] }
 */
export function sanitizeMessage(given: unknown): { message: Message; error?: undefined } | { error: string } {
  if (!given || typeof given !== 'object') return { error: 'a message is a JSON object' };
  const input = given as Loose;
  const title = text(input['title'], 120);
  if (!title) return { error: 'a message needs a title' };
  const asked = listOf(input['choices']);
  const kind = KINDS.includes(input['kind'] as string) ? (input['kind'] as string) : asked.length ? 'question' : 'info';
  const sections = listOf(input['sections'])
    .slice(0, 8)
    .map((section): Section => {
      const { title: heading, items, commands } = (section ?? {}) as Loose;
      const run = texts(commands, 6, 1000);
      return { title: text(heading, 80), items: texts(items, 12, 400), ...(run.length && { commands: run }) };
    })
    .filter(section => section.title || section.items.length || section.commands);
  const choices = asked
    .slice(0, 6)
    .map((choice, at): Choice => {
      const { id, label, detail } = (choice ?? {}) as Loose;
      const more = text(detail, 300);
      return {
        id: matching(/^[a-z0-9-]{1,32}$/, id) ? id : String(at + 1),
        label: text(label, 80),
        ...(more && { detail: more }),
      };
    })
    .filter(choice => choice.label);
  const summary = text(input['summary'], 800);
  const { run, apps } = input;
  return {
    message: {
      kind,
      title,
      ...(summary && { summary }),
      ...(matching(/^[a-z0-9]{6,40}$/, run) && { run }),
      ...(Array.isArray(apps) && { apps: apps.filter(app => matching(/^[a-z0-9-]{1,64}$/, app)).slice(0, 30) }),
      ...(sections.length && { sections }),
      ...(choices.length && { choices }),
    },
  };
}

export const appendMessage = (message: Message): Shown => {
  const entry = { id: crypto.randomBytes(6).toString('hex'), at: new Date().toISOString(), ...message };
  fs.mkdirSync(path.dirname(file()), { recursive: true });
  append(entry);
  return entry;
};
export const appendAnswer = (id: string, answer: Answer): void => {
  append({ answer: id, at: new Date().toISOString(), ...answer });
};

/** The latest messages, each with its answer when there is one. A question about a run a newer Send replaced is closed. */
export function readMessages(limit = 20, history: { id: string; at: string }[] = runs()): Shown[] {
  let raw: string;
  try {
    raw = fs.readFileSync(file(), 'utf8');
  } catch {
    return [];
  }
  const list: Shown[] = [];
  const byId = new Map<string, Shown>();
  for (const line of raw.split('\n')) {
    let entry: Loose | null;
    try {
      entry = JSON.parse(line) as Loose | null;
    } catch {
      continue;
    }
    if (!entry) continue;
    const { answer, at, choice, text: said, via } = entry as { answer?: string; at?: string } & Answer;
    if (answer) {
      const message = byId.get(answer);
      if (message && !message.answered)
        message.answered = { at, ...(choice && { choice }), ...(said && { text: said }), via: via ?? 'canvas' };
    } else if (entry['id'] && entry['title']) {
      const message = entry as unknown as Shown;
      byId.set(message.id, message);
      list.push(message);
    }
  }
  const order = history.map(run => run.id);
  for (const message of list) {
    const at = message.run ? order.indexOf(message.run) : -1;
    const next = at >= 0 ? history[at + 1] : undefined;
    if (message.kind === 'question' && !message.answered && next) message.answered = { at: next.at, via: 'replaced' };
  }
  return list.slice(-limit);
}

/** Clears the panel's history. A question still waiting for an answer is kept, so the agent's open question is never lost. */
export function clearMessages(): { cleared: true; kept: number } {
  const keep = readMessages(1000)
    .filter(message => message.kind === 'question' && !message.answered)
    .map(({ answered, ...message }) => message);
  fs.writeFileSync(file(), keep.map(message => JSON.stringify(message) + '\n').join(''), { mode: 0o600 });
  return { cleared: true, kept: keep.length };
}

export function sayCommand(args: string[]): void {
  if (args.includes('--answered')) {
    const id = flagValue(args, '--answered');
    if (!id || !readMessages(200).some(message => message.id === id)) fail(`no message ${String(id)}`);
    appendAnswer(id, { text: text(flagValue(args, '--text') ?? 'answered in the chat', 400), via: 'chat' });
    console.log(`Marked ${id} as answered.`);
    return;
  }
  let input: unknown;
  try {
    input = JSON.parse(fs.readFileSync(flagValue(args, '--file') ?? 0, 'utf8'));
  } catch {
    fail('give the message as JSON on stdin or with --file');
  }
  const cleaned = sanitizeMessage(input);
  if (cleaned.error !== undefined) fail(cleaned.error);
  console.log(`Shown on the canvas as ${appendMessage(cleaned.message).id}`);
}
