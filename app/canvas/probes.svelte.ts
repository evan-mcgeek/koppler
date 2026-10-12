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

/** What is tested: a call between two apps, or an app's way to a database or cache through its tunnel. */
export type Payload = { from: string; to: string } | { app: string; host: string; port: number; original: number };
/** A cable or a tunnel link, with the apps that have to answer before it is tested by itself. */
export interface Job {
  key: string;
  apps: string[];
  payload: Payload;
}

class Probes {
  /** The last result per cable and tunnel link, kept until the page reloads or one of its apps stops answering. */
  results = $state<Record<string, Probe>>({});
  #tried = new Set<string>();

  async test({ key, payload }: Pick<Job, 'key' | 'payload'>, auto = false): Promise<void> {
    if (this.results[key]?.state === 'busy') return;
    this.results[key] = { state: 'busy' };
    const token = location.pathname.split('/')[2] ?? '';
    const out = await fetch(`/cable-test?token=${encodeURIComponent(token)}`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ env: board.env, ...payload, ...(auto && { auto: true }) }),
    })
      .then(async answer => (answer.ok ? ((await answer.json()) as Tested) : CANNOT))
      .catch(() => CANNOT);
    this.results[key] = { state: out.unsure ? 'warn' : out.ok ? 'ok' : 'bad', text: out.text, detail: out.detail };
    // A test that passes shows on its light; one pressed by hand that fails, or could not be done, says why.
    if (!auto && (!out.ok || out.unsure)) toasts.show(out.detail, 'warning');
  }

  /** Tests each one once when its apps answer, and forgets its result when one of them stops. */
  follow(jobs: Job[]): void {
    for (const job of jobs) {
      const ready = job.apps.every(app => live.sent(app) && live.up(app));
      if (!ready) {
        if (this.#tried.delete(job.key))
          this.results = Object.fromEntries(Object.entries(this.results).filter(([key]) => key !== job.key));
      } else if (!this.#tried.has(job.key)) {
        this.#tried.add(job.key);
        void this.test(job, true);
      }
    }
  }
}
export const probes = new Probes();
