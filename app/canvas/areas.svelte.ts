// The areas one person chose to see in this stack, kept on this Mac: the board menu, the Apps list and Discover share it.
import { narrows } from '../src/core/areas.ts';
import { board } from './board.svelte.ts';

const key = (dir: string) => `koppler-areas:${dir}`;

class Chosen {
  #by = $state<Record<string, string[]>>({});

  /** The areas chosen in this stack; empty is all of them. */
  get ids(): string[] {
    const dir = board.dir;
    if (!(dir in this.#by)) {
      let kept: string[] = [];
      try {
        const raw: unknown = JSON.parse(localStorage.getItem(key(dir)) ?? '[]');
        if (Array.isArray(raw)) kept = raw.filter((id): id is string => typeof id === 'string');
      } catch {
        // Nothing kept, or the browser keeps nothing: every area.
      }
      return kept.filter(id => id in board.areas);
    }
    return (this.#by[dir] ?? []).filter(id => id in board.areas);
  }
  /** Whether the choice hides anything. */
  get narrows(): boolean {
    return narrows({ areas: board.areas, apps: {} }, this.ids);
  }
  set(ids: string[]): void {
    const all = Object.keys(board.areas).every(id => ids.includes(id));
    const kept = all ? [] : Object.keys(board.areas).filter(id => ids.includes(id));
    this.#by = { ...this.#by, [board.dir]: kept };
    try {
      localStorage.setItem(key(board.dir), JSON.stringify(kept));
    } catch {
      // Not remembered where the browser keeps nothing.
    }
  }
  /** "All", the names while they fit, then a count. */
  get label(): string {
    const ids = this.narrows ? this.ids : [];
    if (!ids.length) return 'All';
    const names = ids.map(id => board.areas[id]?.name ?? id);
    return names.length <= 2 && names.join(', ').length <= 22 ? names.join(', ') : `${String(names.length)} areas`;
  }
}
export const chosen = new Chosen();

/** The names of the areas an app is in, in its order. */
export const areaNames = (app: string): string[] =>
  (board.facts?.apps[app]?.areas ?? []).flatMap(id => board.areas[id]?.name ?? []);
