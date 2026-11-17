// How a step's words are shown on the steps panel: a line at rest, break points in long names, and the note with its
// code names told apart from its prose.
import type { Step } from './feature.ts';

/** What a step shows at rest, and whether it has more to open. */
export function atRest(step: Pick<Step, 'summary' | 'values' | 'note'>): { line?: string; opens: boolean } {
  const values = !!step.values?.length;
  if (step.summary) return { line: step.summary, opens: values || !!step.note };
  if (!step.note) return { opens: values };
  const cut = /; | \(/.exec(step.note);
  const line = cut ? step.note.slice(0, cut.index) : step.note;
  return { line, opens: values || line !== step.note };
}

/** A long name in parts, to break after "." and "/" and before "__", so it never breaks inside a word. */
export const breakable = (text: string): string[] => text.split(/(?<=[./])|(?=__)/).filter(Boolean);

const DATE = /^\d{4}-\d{2}-\d{2}$/;
/** A word that names code: a path, a field, a setting, a joined name, or a date. */
export const isCode = (word: string): boolean => /[/_={}]/.test(word) || /[a-z][A-Z]/.test(word) || DATE.test(word);

export interface Words {
  text: string;
  code?: true;
  date?: true;
}
/** The note in runs of prose and code names; the brackets and punctuation round a name stay prose. */
export function noteWords(note: string): Words[] {
  const out: Words[] = [];
  const prose = (text: string) => {
    const last = out.at(-1);
    if (last && !last.code) last.text += text;
    else if (text) out.push({ text });
  };
  for (const token of note.split(/(\s+)/)) {
    const [, before = '', core = '', after = ''] = /^([(["']*)(.*?)([)\]"',;:.!?]*)$/.exec(token) ?? [];
    if (!core || !isCode(core)) {
      prose(token);
      continue;
    }
    prose(before);
    out.push({ text: core, code: true, ...(DATE.test(core) && { date: true as const }) });
    prose(after);
  }
  return out;
}

/** A value in runs, its dates kept whole. */
export const valueWords = (item: string): Words[] =>
  item
    .split(/(\d{4}-\d{2}-\d{2})/)
    .filter(Boolean)
    .map(text => (DATE.test(text) ? { text, date: true as const } : { text }));
