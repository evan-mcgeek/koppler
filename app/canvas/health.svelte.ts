// The board at a glance, and the Flow check behind it: every app of the run, its tunnels and its cables, tested in
// one go. It never reads a production credential.
import { board } from './board.svelte.ts';
import { live } from './live.svelte.ts';
import { probes, type Payload, type Probe } from './probes.svelte.ts';
import { runs } from './run.svelte.ts';

export type Kind = 'app' | 'cable' | 'tunnel';
export interface FlowJob {
  kind: Kind;
  key: string;
  /** The card to show for it. */
  id: string;
  from: string;
  to?: string;
  payload: Payload;
}
const name = board.nameOf;
const several = (count: number, one: string, many: string) => `${String(count)} ${count === 1 ? one : many}`;
const label = (job: FlowJob) => (job.to ? `${job.from} to ${job.to}` : job.from);
const tunnelKey = (tunnel: { host: string; original: number }) => `tunnel:${tunnel.host}:${String(tunnel.original)}`;

class Health {
  /** The connections of the last Flow check; null before the first one. */
  flow = $state.raw<FlowJob[] | null>(null);
  asked = $state(false);

  /** The apps of this board that are part of what runs. */
  readonly sent: string[] = $derived(board.nodes.map(node => node.id).filter(id => live.sent(id)));
  /** Its process is up but it does not answer yet. */
  starting(id: string): boolean {
    return live.sent(id) && !!live.status?.running?.includes(id) && live.up(id) === false;
  }
  /** What is off on the board without testing anything: apps down or failed, steps that wait, closed tunnels, cables that failed their test. */
  readonly items: { level: 'bad' | 'warn'; id: string; down?: boolean; text: string }[] = $derived.by(() => {
    const ids = this.sent;
    const items: Health['items'] = [];
    for (const id of ids) {
      const steps = live.steps(id);
      const failed = steps.find(step => step.state === 'failed');
      if (live.up(id) === false && this.starting(id))
        items.push({ level: 'warn', id, down: true, text: `${name(id)} is starting` });
      else if (live.up(id) === false) items.push({ level: 'bad', id, down: true, text: `${name(id)} is not running` });
      else if (failed) items.push({ level: 'bad', id, text: `${name(id)}: ${failed.label.toLowerCase()} failed` });
      else if (steps.some(step => step.state === 'user'))
        items.push({ level: 'warn', id, text: `${name(id)} is waiting on you` });
    }
    for (const tunnel of board.plan) {
      const id = tunnel.apps.find(app => ids.includes(app));
      if (id && live.status?.ports?.[String(tunnel.port)] === false)
        items.push({ level: 'bad', id, text: `${tunnel.what} tunnel is closed` });
    }
    for (const [key, result] of Object.entries(probes.results)) {
      const [from = '', to = ''] = key.replace(/^node:/, '').split('>');
      // An app that is down is listed once; its own check and the cables into it would only repeat that.
      if (
        result.state !== 'bad' ||
        !ids.includes(from) ||
        items.some(item => item.down && (item.id === from || item.id === to))
      )
        continue;
      items.push({
        level: 'bad',
        id: from,
        text: `${name(from)}${to ? ` to ${name(to)}` : ''}: ${(result.text ?? '').toLowerCase()}`,
      });
    }
    return items;
  });

  /** Every connection on the board: each app, each cable, each database or cache tunnel. */
  jobs(): FlowJob[] {
    return [
      ...board.nodes
        .filter(({ id }) => board.app(id)?.serves)
        .map(({ id }): FlowJob => ({ kind: 'app', key: `node:${id}`, id, from: name(id), payload: { node: id } })),
      ...board.edges.map(({ id, source, target }): FlowJob => ({
        kind: 'cable',
        key: id,
        id: source,
        from: name(source),
        to: `local ${name(target)}`,
        payload: { from: source, to: target },
      })),
      ...board.links.map(({ from, tunnel }): FlowJob => ({
        kind: 'tunnel',
        key: `${from}>${tunnelKey(tunnel)}`,
        id: from,
        from: name(from),
        to: tunnel.what,
        payload: { app: from, host: tunnel.bind, port: tunnel.port, original: tunnel.original },
      })),
    ];
  }
  result(job: FlowJob): Probe {
    return probes.results[job.key] ?? { state: 'busy' };
  }
  get busy(): boolean {
    return !!this.flow?.some(job => this.result(job).state === 'busy');
  }

  /** Tests every connection again. One whose app was never started is not a failure: it says so, and nothing is tried. */
  async check(): Promise<void> {
    const flow = this.jobs();
    this.flow = flow;
    this.asked = false;
    const unsent = (job: FlowJob) =>
      Object.values(job.payload).find(
        (id): id is string => typeof id === 'string' && board.apps.some(app => app.id === id) && !live.sent(id),
      );
    probes.forget(flow.map(job => job.key));
    for (const job of flow) {
      const id = unsent(job);
      if (id)
        probes.results[job.key] = {
          state: 'warn',
          text: 'Not started',
          detail: `${name(id)} is on the board but has not been started yet. Press Run to start it.`,
        };
    }
    await Promise.all(flow.filter(job => !unsent(job)).map(job => probes.test(job, true)));
  }

  /** Hands what the check found failing to the agent, which says what it would change and asks before it acts. */
  async askToFix(): Promise<void> {
    const failures = (this.flow ?? [])
      .filter(job => this.result(job).state === 'bad')
      .map(job => ({
        connection: label(job),
        result: this.result(job).text ?? '',
        detail: this.result(job).detail ?? '',
        ...job.payload,
      }));
    if (!failures.length) return;
    const text = [
      'Fix what the Koppler flow check found, using the koppler-run skill.',
      `ENV ${board.env.toUpperCase()}`,
      'FAILED:',
      ...failures.map(one => `  ${one.connection}: ${one.result}. ${one.detail}`),
      'Find the cause of each, say what you would change, and ask before you start, stop or restart anything.',
    ].join('\n');
    const waiting = (live.status?.agent?.state ?? 'none') === 'none';
    this.asked = await runs.deliver(
      text,
      { tag: 'koppler-fix', data: { env: board.env, failures } },
      waiting ? 'Saved. The agent gets it when one connects.' : 'Sent to the agent',
    );
  }

  /** The one light: its state, what it says, and what resting on it adds. */
  readonly chip: { state: 'bad' | 'busy' | 'warn' | 'idle' | 'ok'; label: string; title: string } = $derived.by(() => {
    const ids = board.nodes.map(node => node.id);
    const run = live.status?.live;
    const runEnv = run?.env && Object.keys(run.nodes ?? {}).length ? run.env : null;
    const otherEnv = runEnv && runEnv !== board.env ? runEnv.toUpperCase() : null;
    // A failed start outranks everything that is still on its way.
    const failed = otherEnv ? [] : this.sent.filter(id => live.steps(id).some(step => step.state === 'failed'));
    if (failed.length)
      return {
        state: 'bad',
        label: `${String(failed.length)} failed: ${failed.map(name).join(', ')}`,
        title: 'Its card says why. Ask the agent to fix it from the card, or run a Flow check.',
      };
    const starting = otherEnv ? [] : ids.filter(id => this.starting(id));
    if (starting.length)
      return {
        state: 'busy',
        label: `Starting ${starting.length === 1 ? name(starting[0] ?? '') : `${String(starting.length)} apps`}`,
        title: 'Koppler checks the connections again once it answers.',
      };
    const apps = this.sent.length;
    // Apps that run but this board does not show: never "Nothing running" while they do.
    const unseen =
      !this.busy && !otherEnv && !apps
        ? (live.status?.running ?? []).filter(id => board.apps.some(app => app.id === id) && !ids.includes(id))
        : [];
    if (unseen.length)
      return {
        state: 'warn',
        label: `${unseen.length === 1 ? name(unseen[0] ?? '') : `${String(unseen.length)} apps`} running, not on this board`,
        title: `${unseen.map(name).join(', ')} ${unseen.length === 1 ? 'runs' : 'run'}, but this board does not show ${unseen.length === 1 ? 'it' : 'them'}. Run starts this board and stops what is not on it; Stop stops everything.`,
      };
    if (this.busy && this.flow) {
      const done = this.flow.filter(job => this.result(job).state !== 'busy').length;
      return {
        state: 'busy',
        label: `Checking ${String(done)} of ${String(this.flow.length)}`,
        title: 'Flow check in progress',
      };
    }
    if (otherEnv)
      return {
        state: 'warn',
        label: `Running on ${otherEnv}`,
        title: `What runs now is your ${otherEnv} board. This board is set to ${board.env.toUpperCase()} and has not been run; Run switches over.`,
      };
    if (!apps)
      return { state: 'idle', label: 'Nothing running', title: 'Nothing on the board is running. Run starts it.' };
    // After a Flow check the light says what its report says; before one, what the cards and tunnels show.
    const bad = this.flow
      ? this.flow.filter(job => this.result(job).state === 'bad').length
      : this.items.filter(item => item.level === 'bad').length;
    const waiting = this.flow ? 0 : this.items.length - bad;
    const unsent = ids.length - apps;
    const check = 'Flow check: test every connection on the board';
    if (bad) return { state: 'bad', label: `${several(bad, 'thing is', 'things are')} off`, title: check };
    if (unsent)
      return {
        state: 'warn',
        label: `${String(unsent)} not started`,
        title: `${several(unsent, 'app on this board was', 'apps on this board were')} not started yet. Run starts ${unsent === 1 ? 'it' : 'them'}.`,
      };
    if (waiting) return { state: 'warn', label: `${String(waiting)} waiting on you`, title: check };
    return { state: 'ok', label: 'All running', title: check };
  });
}
export const health = new Health();
