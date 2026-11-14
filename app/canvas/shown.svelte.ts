// The kinds of card one person hid from Discover in this stack, kept in this browser: categories, and queue types.
import { board } from './board.svelte.ts';

const key = (dir: string) => `koppler-hidden:${dir}`;
/** The stack's folder; an exported page has none, so its stack's name. */
const stack = () => board.dir || `export:${board.facts?.name ?? ''}`;

class Hidden {
  #by = $state<Record<string, string[]>>({});

  /** The filters hidden in this stack: a category such as `outside`, or a queue type such as `queue:kafka`. */
  get ids(): string[] {
    const dir = stack();
    if (dir in this.#by) return this.#by[dir] ?? [];
    try {
      const raw: unknown = JSON.parse(localStorage.getItem(key(dir)) ?? '[]');
      return Array.isArray(raw) ? raw.filter((id): id is string => typeof id === 'string') : [];
    } catch {
      // Nothing kept, or the browser keeps nothing: every card shows.
      return [];
    }
  }
  set(ids: string[]): void {
    const dir = stack();
    this.#by = { ...this.#by, [dir]: ids };
    try {
      localStorage.setItem(key(dir), JSON.stringify(ids));
    } catch {
      // Not remembered where the browser keeps nothing.
    }
  }
  toggle(id: string): void {
    this.set(this.ids.includes(id) ? this.ids.filter(one => one !== id) : [...this.ids, id]);
  }
}
export const hidden = new Hidden();
