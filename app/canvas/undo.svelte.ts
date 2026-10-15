// The undo history of the board in Edit: each step is the board as text; changes close together are one step.
import { board } from './board.svelte.ts';

class Undo {
  /** Whether there is a step to go back to, or forward to again. */
  canUndo = $state(false);
  canRedo = $state(false);
  #past: string[] = [];
  #future: string[] = [];
  #now = '';
  #at = 0;

  /** Notes a change to the board. Changes less than 0.7 seconds apart, a drag for one, are one step to undo. */
  record(): void {
    if (board.live) return;
    const now = board.content();
    if (now === this.#now) return;
    if (this.#now && Date.now() - this.#at > 700) this.#past.push(this.#now);
    if (this.#now) this.#future = [];
    this.#now = now;
    this.#at = Date.now();
    this.canUndo = this.#past.length > 0;
    this.canRedo = false;
  }

  /** Takes the board as it is now as the current step, without a step to undo. */
  adopt(): void {
    if (!board.live) this.#now = board.content();
  }

  #step(from: string[], to: string[]): void {
    const back = from.pop();
    if (back === undefined) return;
    to.push(this.#now);
    this.#now = back;
    // The next change is a step of its own.
    this.#at = 0;
    board.setContent(back);
    this.canUndo = this.#past.length > 0;
    this.canRedo = this.#future.length > 0;
  }
  undo(): void {
    this.#step(this.#past, this.#future);
  }
  redo(): void {
    this.#step(this.#future, this.#past);
  }
}
export const undo = new Undo();
