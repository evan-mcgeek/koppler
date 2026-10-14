// Cable tests: the light at a cable's socket says whether the call reaches the local app. A cable is tested by
// itself once both its apps answer, and again on a click.
import { board } from './board.svelte.ts';
import { live } from './live.svelte.ts';
import { toasts } from './toast.svelte.ts';
import { send } from './data.ts';

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
export type Payload =
  { node: string } | { from: string; to: string } | { app: string; host: string; port: number; original: number };
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
  /** Tests held back while their app starts, each with the app it waits for. */
  #starting = new Map<string, { target: string; payload: Payload }>();

  async test({ key, payload }: Pick<Job, 'key' | 'payload'>, auto = false): Promise<void> {
    if (this.results[key]?.state === 'busy' && this.results[key].text !== 'Starting') return;
    // An app whose process is up but does not answer yet is starting: its test waits for it instead of failing.
    const target = 'node' in payload ? payload.node : 'to' in payload ? payload.to : null;
    if (target && live.sent(target) && live.status?.running?.includes(target) && !live.up(target)) {
      const name = board.nameOf(target);
      const detail = `${name} is starting. Koppler checks again once it answers.`;
      this.results[key] = { state: 'busy', text: 'Starting', detail };
      this.#starting.set(key, { target, payload });
      if (!auto) toasts.show(detail);
      return;
    }
    this.results[key] = { state: 'busy' };
    const answer = await send('cable-test', { env: board.env, ...payload, ...(auto && { auto: true }) });
    const out = answer?.ok ? ((await answer.json().catch(() => CANNOT)) as Tested) : CANNOT;
    this.results[key] = { state: out.unsure ? 'warn' : out.ok ? 'ok' : 'bad', text: out.text, detail: out.detail };
    // A test that passes shows on its light; one pressed by hand that fails, or could not be done, says why.
    if (!auto && (!out.ok || out.unsure)) toasts.show(out.detail, 'warning');
  }

  /** Drops the results of these, so they are tested afresh. */
  forget(keys: string[]): void {
    this.results = Object.fromEntries(Object.entries(this.results).filter(([key]) => !keys.includes(key)));
  }

  /** Tests each one once when its apps answer, and forgets its result when one of them stops. Called on each status. */
  follow(jobs: Job[]): void {
    // A test that waited for its app: run once the app answers, or once its process is gone and the test can say so.
    const running = live.status?.running ?? [];
    for (const [key, { target, payload }] of this.#starting) {
      if (running.includes(target) && !live.up(target)) continue;
      this.#starting.delete(key);
      if (this.results[key]?.text === 'Starting') void this.test({ key, payload }, true);
    }
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
