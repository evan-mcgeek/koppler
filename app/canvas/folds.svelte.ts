// Which sections of each card are open, kept on this Mac: a new card starts with Setup open and the rest folded.
export const SECTIONS = ['setup', 'databases', 'note', 'calls'] as const;
export type Section = (typeof SECTIONS)[number];
const KEY = 'koppler-folds';
const read = (): Record<string, Section[]> => {
  try {
    const raw: unknown = JSON.parse(localStorage.getItem(KEY) ?? '{}');
    return raw && typeof raw === 'object' ? (raw as Record<string, Section[]>) : {};
  } catch {
    // Nothing kept, or the browser keeps nothing: every card as new.
    return {};
  }
};

class Folds {
  #open = $state<Record<string, Section[]>>(read());
  /** The one section a click just opened, as `card:section`: what it holds can start at once. */
  opened = $state<string | null>(null);

  isOpen(card: string, section: Section): boolean {
    return (this.#open[card] ?? ['setup']).includes(section);
  }
  /** Opens or folds one section; `all` does every section of the card, the way that one goes. */
  toggle(card: string, section: Section, all = false): void {
    const open = !this.isOpen(card, section);
    this.opened = open && !all ? `${card}:${section}` : null;
    if (all) this.#set(card, open ? [...SECTIONS] : []);
    else {
      const now = this.#open[card] ?? ['setup'];
      this.#set(card, open ? [...now, section] : now.filter(one => one !== section));
    }
  }
  /** Every section open, or every one folded. */
  setAll(card: string, open: boolean): void {
    this.#set(card, open ? [...SECTIONS] : []);
  }
  #set(card: string, open: Section[]): void {
    this.#open = { ...this.#open, [card]: open };
    try {
      localStorage.setItem(KEY, JSON.stringify(this.#open));
    } catch {
      // Not remembered where the browser keeps nothing.
    }
  }
}
export const folds = new Folds();
