// The one message shown over the board: what just happened, or why something was refused, with at most one action.
export interface Toast {
  text: string;
  warning: boolean;
  action?: { label: string; run: () => void };
}
class Toasts {
  now = $state.raw<Toast | null>(null);
  #timer: ReturnType<typeof setTimeout> | undefined;

  /** A warning stays until it is dismissed; a message goes by itself, later when it offers an action. */
  show(text: string, kind: 'message' | 'warning' = 'message', action?: Toast['action']): void {
    clearTimeout(this.#timer);
    this.now = { text, warning: kind === 'warning', ...(action && { action }) };
    if (kind !== 'warning') this.#timer = setTimeout(() => (this.now = null), action ? 7000 : 2600);
  }
  hide(): void {
    clearTimeout(this.#timer);
    this.now = null;
  }
}
export const toasts = new Toasts();
