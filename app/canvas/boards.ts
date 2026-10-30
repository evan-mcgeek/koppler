// Opening boards from the picker, a file or a link: the board model does the work, this says how it went. Leaving a
// board while something runs goes through a Stop and revert first, as leaving a stack does.
import type { StoredPreset } from '../src/core/presets.ts';
import { board } from './board.svelte.ts';
import { runs } from './run.svelte.ts';
import { toasts } from './toast.svelte.ts';
import { post } from './data.ts';

interface Fetched {
  presets?: unknown;
  error?: string;
}
type Outcome = { notes: string[]; error?: undefined } | { error: string };
const say = (name: string, out: Outcome): boolean => {
  if (out.error !== undefined) toasts.show(`Cannot open ${name}. ${out.error}`, 'warning');
  else if (out.notes.length) toasts.show(`Opened ${name}, changed to fit: ${out.notes.join('; ')}`);
  return out.error === undefined;
};
/** Opens `to` at once when nothing runs, else after the Stop and revert its review shows. */
function leave(to: string, open: () => void): void {
  if (runs.idle) {
    open();
    return;
  }
  runs.stopReview({
    title: `Open ${to}`,
    sub: `Something is still running. It is stopped and reverted first, then ${to} opens.`,
    notices: [
      { text: 'Left alone: anything you started yourself or from your IDE, your AWS sign-ins and stored credentials.' },
    ],
    ok: 'Stop, revert and open',
    text: 'Stop and revert this stack using the koppler-run skill (stop every process the agent started, revert every temporary code change). Report what was stopped and reverted.',
    sent: `Stopping and reverting, and ${to} is open`,
    then: open,
  });
}
export const openBoard = (preset: StoredPreset): void => {
  leave(preset.name, () => say(preset.name, board.openBoard(preset)));
};

export async function openFile(file: File | undefined): Promise<void> {
  if (!file) return;
  let data: unknown;
  try {
    data = JSON.parse(await file.text());
  } catch {
    toasts.show(`${file.name} is not a JSON file`, 'warning');
    return;
  }
  leave(file.name, () => {
    const out = board.importBoards(data, file.name);
    say(out.error === undefined ? out.name : file.name, out);
  });
}

/** The page cannot read a private repo, so the canvas server fetches the link. Gives why it could not be opened. */
export async function openLink(url: string): Promise<string | null> {
  const got: Fetched = await post<Fetched>('preset', { url });
  if (got.error) return got.error;
  if (!runs.idle) {
    leave('the linked board', () => {
      const out = board.importBoards(got.presets, url);
      say(out.error === undefined ? out.name : url, out);
    });
    return null;
  }
  const out = board.importBoards(got.presets, url);
  if (out.error !== undefined) return out.error;
  say(out.name, out);
  return null;
}

const UNITS = [
  ['year', 31536000],
  ['month', 2592000],
  ['week', 604800],
  ['day', 86400],
  ['hour', 3600],
  ['minute', 60],
] as const;
/** "3 hours ago", in the reader's language. */
export function ago(iso: string): string {
  const secs = (new Date(iso).getTime() - Date.now()) / 1000;
  const format = new Intl.RelativeTimeFormat(undefined, { numeric: 'auto' });
  for (const [unit, size] of UNITS) if (Math.abs(secs) >= size) return format.format(Math.round(secs / size), unit);
  return 'just now';
}
