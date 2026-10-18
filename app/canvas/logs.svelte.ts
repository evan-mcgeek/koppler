// The logs pane: a tab per app whose log is open, the one in front read in full from the server.
import type { Entry } from '../src/core/shared-log.ts';
import { board } from './board.svelte.ts';
import { live } from './live.svelte.ts';

/** The tab with the log of every app on the board, in one stream. */
export const ALL = '*';
export type Span = 'run' | 'hour' | 'lines';
export type Names = 'every' | 'change';
/** A choice this browser remembers, or the default where it keeps nothing. */
const kept = <T extends string>(key: string, choices: readonly T[], fallback: T): T => {
  try {
    const value = localStorage.getItem(key);
    return choices.includes(value as T) ? (value as T) : fallback;
  } catch {
    return fallback;
  }
};
const keep = (key: string, value: string) => {
  try {
    localStorage.setItem(key, value);
  } catch {
    // Not remembered; the choice still holds for this page.
  }
};

const remembered = (): Record<string, string> => {
  try {
    return (JSON.parse(sessionStorage.getItem('koppler-log-cleared') ?? '{}') ?? {}) as Record<string, string>;
  } catch {
    return {};
  }
};
/** A tab is an app's log now (its id), or as a past run kept it (`<id>@<run>`). */
const partsOf = (key: string): [string, string | undefined] => {
  const [app = '', run] = key.split('@');
  return [app, run];
};
class Logs {
  tabs = $state.raw<string[]>([]);
  active = $state<string | null>(null);
  /** The log exactly as the app wrote it, instead of its lines read and laid out. */
  raw = $state(false);
  /** Per app, the last line there was when its log was cleared: only lines after it show. */
  cleared = $state.raw<Record<string, string>>(remembered());
  /** The open tab's log in full, its last 2000 lines. */
  full = $state.raw<Record<string, string>>({});
  #at: Record<string, number> = {};
  /** The log of every app on the board, as last read. */
  all = $state.raw<Entry[]>([]);
  /** How much of it shows: since the run started, the last hour, or the last 2,000 lines. */
  since = $state<Span>(kept('koppler-log-since', ['run', 'hour', 'lines'], 'run'));
  /** The app's name on every line, or only on a line from another app than the one above. */
  names = $state<Names>(kept('koppler-log-names', ['every', 'change'], 'every'));

  setSince(span: Span): void {
    this.since = span;
    keep('koppler-log-since', span);
    this.reload();
  }
  /** Reads the log of every app again now, if it is the open tab. */
  reload(): void {
    this.#at[ALL] = 0;
    this.refresh();
  }
  setNames(names: Names): void {
    this.names = names;
    keep('koppler-log-names', names);
  }
  /** The apps whose lines the log of every app shows: those on the board, but the ones left out of it. */
  allApps(): string[] {
    return board.nodes.map(node => node.id).filter(id => !board.hiddenLogs[id]);
  }

  open(id: string, run?: string): void {
    const key = run ? `${id}@${run}` : id;
    if (!this.tabs.includes(key)) this.tabs = [...this.tabs, key];
    this.active = key;
    // The pane takes room from the board, so the card whose log this is comes back into view.
    requestAnimationFrame(() => {
      board.show(id);
    });
  }
  /** Whether a tab is a past run's log, which no longer grows. */
  past(key: string): boolean {
    return key !== ALL && !!partsOf(key)[1];
  }
  /** A tab's name: the app's, and when its run was for a past one. */
  label(key: string): string {
    if (key === ALL) return 'All apps';
    const [app, run] = partsOf(key);
    const at = run ? live.status?.runs?.find(one => one.id === run)?.at : undefined;
    const when = at
      ? new Date(at).toLocaleString([], { month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' })
      : '';
    return run ? `${board.nameOf(app)}, run of ${when || run}` : board.nameOf(app);
  }
  close(id: string): void {
    this.tabs = this.tabs.filter(one => one !== id);
    if (this.active === id) this.active = this.tabs.at(-1) ?? null;
  }
  closeAll(): void {
    this.tabs = [];
    this.active = null;
  }
  /** Hides what is in the log so far; new lines keep coming. The log file is not touched. */
  clear(): void {
    const id = this.active;
    const tail = id ? live.tail(id).trimEnd() : '';
    if (!id || !tail) return;
    this.cleared = { ...this.cleared, [id]: tail.slice(tail.lastIndexOf('\n') + 1) };
    try {
      sessionStorage.setItem('koppler-log-cleared', JSON.stringify(this.cleared));
    } catch {
      // Not remembered where the browser keeps nothing.
    }
  }
  /** The open tab's log, asked for in full at most every two seconds. */
  refresh(): void {
    const id = this.active;
    if (!id || Date.now() - (this.#at[id] ?? 0) < 2000) return;
    this.#at[id] = Date.now();
    if (id === ALL) {
      const span = this.since === 'lines' ? 'since=all&lines=2000' : `since=${this.since}`;
      const apps = this.allApps().map(encodeURIComponent).join(',');
      void fetch(`log-all?apps=${apps}&${span}`, { cache: 'no-store' })
        .then(answer => (answer.ok ? (answer.json() as Promise<Entry[]>) : null))
        .then(entries => {
          if (entries) this.all = entries;
        })
        .catch(() => undefined);
      return;
    }
    const [app, run] = partsOf(id);
    const query = `app=${encodeURIComponent(app)}${run ? `&run=${encodeURIComponent(run)}` : ''}`;
    void fetch(`log?${query}`, { cache: 'no-store' })
      .then(answer => (answer.ok ? answer.text() : null))
      .then(text => {
        if (text !== null && text !== this.full[id]) this.full = { ...this.full, [id]: text };
      })
      .catch(() => undefined);
  }
  /** What the open tab shows: its log, from the last line there was when it was cleared. */
  text(id: string): string {
    const all = this.full[id] ?? (this.past(id) ? '' : live.tail(id));
    const mark = this.cleared[id];
    const at = mark ? all.lastIndexOf(mark) : -1;
    return at >= 0 ? all.slice(at + (mark?.length ?? 0)).replace(/^\n/, '') : all;
  }
}
export const logs = new Logs();
