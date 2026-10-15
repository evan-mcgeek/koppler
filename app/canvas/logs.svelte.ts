// The logs pane: a tab per app whose log is open, the one in front read in full from the server.
import { board } from './board.svelte.ts';
import { live } from './live.svelte.ts';

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
    return !!partsOf(key)[1];
  }
  /** A tab's name: the app's, and when its run was for a past one. */
  label(key: string): string {
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
