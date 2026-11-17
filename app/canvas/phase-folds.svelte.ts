// The phases one person folded on a feature board's steps panel, kept in this browser per stack and board.
import { board } from './board.svelte.ts';

const key = () => `koppler-phase-folds:${board.dir || `export:${board.facts?.name ?? ''}`}:${board.name ?? ''}`;

class PhaseFolds {
  #by = $state<Record<string, string[]>>({});

  /** The folded phases of the board on screen, by name. */
  get names(): string[] {
    const at = key();
    if (at in this.#by) return this.#by[at] ?? [];
    try {
      const raw: unknown = JSON.parse(localStorage.getItem(at) ?? '[]');
      return Array.isArray(raw) ? raw.filter((name): name is string => typeof name === 'string') : [];
    } catch {
      // Nothing kept, or the browser keeps nothing: every phase is open.
      return [];
    }
  }
  set(names: string[]): void {
    const at = key();
    this.#by = { ...this.#by, [at]: names };
    try {
      localStorage.setItem(at, JSON.stringify(names));
    } catch {
      // Not remembered where the browser keeps nothing.
    }
  }
  toggle(name: string): void {
    this.set(this.names.includes(name) ? this.names.filter(one => one !== name) : [...this.names, name]);
  }
}
export const phaseFolds = new PhaseFolds();
