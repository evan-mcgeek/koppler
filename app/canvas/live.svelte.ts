// What is running right now: the status the server puts together every second and a half, and what it says about
// the cards of the board on screen.
import type { BoardInput } from '../src/core/plan.ts';
import { board } from './board.svelte.ts';

export interface Step {
  label: string;
  /** done, failed, user (waiting on the user) or todo. */
  state: string;
  detail?: string;
  /** A command for the user to run. */
  copy?: string;
}
interface Running {
  device: string;
  platform: string;
  flavor?: string;
  source?: string;
}
interface AppStatus {
  port?: number;
  listening?: boolean;
  /** A mobile app: the simulators and devices it runs on. */
  running?: Running[];
  steps?: Step[];
}
interface Status {
  apps?: Record<string, AppStatus | undefined>;
  /** Tunnel ports, and whether something listens on each. */
  ports?: Record<string, boolean | undefined>;
  /** The board that was last run. Absent when the server cannot tell. */
  live?: (BoardInput & { env?: string; nodes?: Record<string, unknown> }) | null;
  /** The run Koppler is applying, or last applied. */
  progress?: { env?: string; apps?: string[] };
  /** What Koppler started and still runs, by name, and the environment each app was started on. */
  running?: string[];
  runningEnvs?: Record<string, string | undefined>;
  /** The last runs, oldest first. */
  runs?: { state?: string; kind?: string; changes?: { app: string; title: string; file?: string }[] }[];
  /** Whether an agent session takes what the canvas sends: listening, busy or none. */
  agent?: { state?: string };
  /** The credentials each app declares per environment, and whether each is stored. */
  secrets?: Record<string, Record<string, { name: string; stored?: boolean; when?: string }[] | undefined> | undefined>;
}

class Live {
  status = $state.raw<Status | null>(null);
  #timer: ReturnType<typeof setInterval> | undefined;

  /** Asks for the status now and every second and a half, while the page is in view. */
  watch(): void {
    const ask = async () => {
      if (document.hidden) return;
      try {
        const answer = await fetch('../data/status.json');
        if (answer.ok) this.status = (await answer.json()) as Status;
      } catch {
        // The server is away: the last status stays until it answers again.
      }
    };
    void ask();
    clearInterval(this.#timer);
    this.#timer = setInterval(() => void ask(), 1500);
  }

  /**
   * Whether an app's state belongs on this board: it was run with the last board in this environment, or is in the
   * run Koppler is applying on it. Another environment's apps show as not started, not as borrowed green dots.
   */
  sent(id: string): boolean {
    const { live, progress } = this.status ?? {};
    const here = !live?.env || live.env === board.env;
    return (!!live?.nodes?.[id] && here) || (!!progress?.apps?.includes(id) && progress.env === board.env);
  }
  #info(id: string): AppStatus | undefined {
    return this.sent(id) ? this.status?.apps?.[id] : undefined;
  }
  /** Whether a sent app answers: true, false, or null when nothing is known of it. */
  up(id: string): boolean | null {
    const info = this.#info(id);
    if (!info) return null;
    if (info.running) return info.running.length > 0;
    return info.listening ?? null;
  }
  /** What the live dot says in words. */
  about(id: string): string {
    const info = this.#info(id);
    if (info?.running) return this.where(id);
    if (info?.listening === undefined) return '';
    const port = String(info.port ?? '');
    return info.listening ? `Running on port ${port}` : `Nothing is listening on port ${port}`;
  }
  /** Where a mobile app runs, or that it runs for another board. */
  where(id: string): string {
    const info = this.#info(id);
    if (!info?.running) {
      const other = this.status?.apps?.[id];
      const up = other?.running ? other.running.length > 0 : other?.listening === true;
      const env = (this.status?.live?.env ?? '').toUpperCase();
      return !info && up && this.status?.live?.nodes?.[id]
        ? `Running for your ${env} board, not this one. Run switches it.`
        : '';
    }
    const [first] = info.running;
    if (!first) return 'Not running on a simulator or device';
    const platform = { ios: 'iOS simulator', android: 'Android' }[first.platform] ?? first.platform;
    const from = first.source ? `, started from ${first.source === 'ide' ? 'your IDE' : 'Koppler'}` : '';
    const more = info.running.length > 1 ? `, and ${String(info.running.length - 1)} more` : '';
    return `Running on ${first.device} (${platform})${first.flavor ? `, ${first.flavor}` : ''}${from}${more}`;
  }
  /**
   * The app's checklist. The agent writes it once; whether the app runs is live, so a running app's Start and Check
   * wait on no one, and a "done" Check never outlives the app.
   */
  steps(id: string): Step[] {
    const steps = this.#info(id)?.steps ?? [];
    const up = this.up(id);
    if (up === true)
      return steps.map(step =>
        (step.label === 'Start' || step.label === 'Check') && (step.state === 'user' || step.state === 'todo')
          ? { label: step.label, state: 'done', detail: 'Running.' }
          : step,
      );
    if (up !== false) return steps;
    return steps.map(step =>
      step.label === 'Check' && step.state === 'done'
        ? { ...step, state: 'todo', detail: 'Not running right now.' }
        : step,
    );
  }
  /** Whether something listens on a tunnel's port; undefined when no sent app needs it. */
  tunnel(port: string, apps: string[]): boolean | undefined {
    return apps.some(app => this.sent(app)) ? this.status?.ports?.[port] : undefined;
  }
}
export const live = new Live();

/** The one line a card says about its checklist, and its tone. */
export function progress(steps: Step[]): [tone: string, text: string] {
  const find = (state: string) => steps.find(step => step.state === state);
  const [failed, mine, todo] = [find('failed'), find('user'), find('todo')];
  if (failed) return ['failed', `Failed: ${failed.label}`];
  if (mine) return ['user', `Waiting on you: ${mine.label}`];
  if (todo) return ['todo', `Next: ${todo.label}`];
  return ['done', 'All steps done'];
}
