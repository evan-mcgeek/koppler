// Cable tests: the light at a cable's socket says whether the call reaches the local app. A cable is tested by
// itself once both its apps answer, and again on a click.
import { board } from './board.svelte.ts';
import { live } from './live.svelte.ts';
import { toasts } from './toast.svelte.ts';

export interface Probe {
  state: 'busy' | 'ok' | 'warn' | 'bad';
  text?: string;
  detail?: string;
}
interface Tested {
  ok: boolean;
  unsure?: boolean;
  text: string;
  detail: string;
}
const CANNOT: Tested = {
  ok: false,
  unsure: true,
  text: 'Cannot test',
  detail: 'Testing needs the Koppler canvas running (koppler canvas).',
};

class Probes {
  /** The last result per cable, kept until the page reloads or an end stops answering. */
  results = $state<Record<string, Probe>>({});
  #tried = new Set<string>();

  /** A cable has a light once both its apps are part of what runs. */
  shown(from: string, to: string): boolean {
    return live.sent(from) && live.sent(to);
  }

  async test(from: string, to: string, auto = false): Promise<void> {
    const key = `${from}>${to}`;
    if (this.results[key]?.state === 'busy') return;
    this.results[key] = { state: 'busy' };
    const token = location.pathname.split('/')[2] ?? '';
    const out = await fetch(`/cable-test?token=${encodeURIComponent(token)}`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ env: board.env, from, to, ...(auto && { auto: true }) }),
    })
      .then(async answer => (answer.ok ? ((await answer.json()) as Tested) : CANNOT))
      .catch(() => CANNOT);
    this.results[key] = { state: out.unsure ? 'warn' : out.ok ? 'ok' : 'bad', text: out.text, detail: out.detail };
    // A test that passes shows on its light; one pressed by hand that fails, or could not be done, says why.
    if (!auto && (!out.ok || out.unsure)) toasts.show(out.detail, 'warning');
  }

  /** Tests each cable once when both its apps answer, and forgets its result when one stops. */
  follow(): void {
    for (const { id, source, target } of board.edges) {
      const ready = [source, target].every(app => live.sent(app) && live.up(app));
      if (!ready) {
        if (this.#tried.delete(id))
          this.results = Object.fromEntries(Object.entries(this.results).filter(([key]) => key !== id));
      } else if (!this.#tried.has(id)) {
        this.#tried.add(id);
        void this.test(source, target, true);
      }
    }
  }
}
export const probes = new Probes();
