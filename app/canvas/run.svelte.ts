// Run and Stop: what the board asks for, what that changes against what is running, the review of it, and the
// request the agent or Koppler gets once it is confirmed. The plan itself is core/plan.
import { describe, plan, type Plan } from '../src/core/plan.ts';
import { board } from './board.svelte.ts';
import { save } from './data.ts';
import { live } from './live.svelte.ts';
import { toasts } from './toast.svelte.ts';

/** One line of a review: an app or a tunnel, with what is worth knowing under it. */
export interface ReviewItem {
  name: string;
  notes: { text: string; kind?: 'host' | 'flag' }[];
  off?: boolean;
}
export interface Review {
  title: string;
  sub: string;
  notices: { text: string; kind?: 'prod' }[];
  groups: { verb: string; label: string; items: ReviewItem[] }[];
  ok: string;
  /** Marks the confirm button red: a protected environment, or a stop. */
  prod: boolean;
  /** Something has to be put right first: the confirm button is off. */
  blocked: boolean;
  confirm: () => void;
}
const VERBS = [
  ['starts', 'Starts'],
  ['restarts', 'Restarts'],
  ['stops', 'Stops and reverts'],
  ['keeps', 'Keeps running'],
] as const;
const newRunId = () => (Date.now().toString(36) + Math.random().toString(36).slice(2, 8)).replace(/[^a-z0-9]/g, '');
const name = (id: string) => board.apps.find(app => app.id === id)?.name ?? id;
const several = (count: number, one: string) => `${String(count)} ${one}${count === 1 ? '' : 's'}`;

class Runs {
  /** The review on screen, waiting to be confirmed. */
  review = $state.raw<Review | null>(null);

  /** What the board asks for, as the agent and the plan read it. */
  graph() {
    const nodes = board.nodes.map(({ id, data }) => {
      const app = board.apps.find(one => one.id === id);
      return {
        id,
        branch: data.branch || null,
        run: data.run as 'cli' | 'ide',
        ...(data.hideTunnels && board.tunnelsOf(id).length > 0 && { tunnels: false as const }),
        ...(board.switchesOver(id) && { changes: data.changes ?? ('set-aside' as const) }),
        ...(data.platform && data.run === 'cli' && !!app?.platforms.length && { platform: data.platform }),
        ...(data.note.trim() && { note: data.note.trim() }),
        ...(board.localLibraries(id).length > 0 && { libraries: board.localLibraries(id) }),
      };
    });
    const edges = board.edges.map(({ source, target }) => ({ from: source, to: target }));
    const deployed = nodes.flatMap(({ id }) =>
      (board.apps.find(app => app.id === id)?.calls ?? [])
        .filter(to => !edges.some(edge => edge.from === id && edge.to === to))
        .map(to => ({ from: id, to })),
    );
    const queues = Object.fromEntries(
      board.infra.flatMap(card => (card.type === 'queue' && card.data.local ? [[card.data.queue, 'local']] : [])),
    );
    return { env: board.env, mode: 'auto', nodes, edges, deployed, ...(Object.keys(queues).length && { queues }) };
  }

  #plan(desired: Parameters<typeof plan>[1]): Plan {
    const status = live.status;
    const running = status?.running;
    return plan(status?.live ?? null, desired, {
      name,
      running: id => running?.includes(id),
      strays: (running ?? []).filter(id => board.apps.some(app => app.id === id) && !status?.live?.nodes?.[id]),
      startedOn: id => status?.runningEnvs?.[id],
      queuesOf: id => board.queuesOf(id),
    });
  }

  /** The credentials the board's apps always need that are not stored yet. */
  #missing(): string[] {
    return board.nodes.flatMap(({ id }) =>
      (live.status?.secrets?.[id]?.[board.env] ?? [])
        .filter(one => !one.stored && (!one.when || /^always\b/i.test(one.when.trim())))
        .map(one => `${one.name} for ${name(id)}`),
    );
  }

  #describe(graph: ReturnType<Runs['graph']>): string {
    const env = graph.env.toUpperCase();
    const calls = (from: string, to: string) => board.apps.find(app => app.id === from)?.known.includes(to);
    return [
      `ENV ${env}`,
      'MODE auto: apply the changes and start everything',
      ...Object.keys(graph.queues ?? {}).map(queue => `QUEUE ${board.queueName(queue)}: local, in the AWS emulator`),
      ...graph.nodes.flatMap(node => {
        const platform = board.apps
          .find(app => app.id === node.id)
          ?.platforms.find(([value]) => value === node.platform);
        const how = [node.run === 'ide' ? 'IDE' : 'CLI', node.run === 'cli' ? platform?.[1].split(' ')[0] : undefined];
        return [
          `LOCAL ${name(node.id)} [${how.filter(Boolean).join(', ')}] on ${node.branch ?? 'current branch'}`,
          ...(node.note ? [`  note: ${node.note}`] : []),
        ];
      }),
      ...graph.edges.map(({ from, to }) => {
        const found = board.apps.find(app => app.id === from)?.calls.includes(to);
        const how = calls(from, to)
          ? ''
          : found
            ? ' (found in its repo, not in the stack yet)'
            : ' (NEW: not in the stack; find how the caller picks this address, record it in consumes, ask if unclear)';
        return `  ${name(from)} → local ${name(to)}${how}`;
      }),
      ...graph.deployed.map(({ from, to }) => `  ${name(from)} → ${env} ${name(to)}`),
      ...graph.deployed
        .filter(({ to }) => graph.nodes.some(node => node.id === to))
        .map(({ from, to }) => `! ${name(to)} is local but ${name(from)} still calls ${env}`),
    ].join('\n');
  }

  /** Hands a request to the server, for Koppler or the agent. Copied instead when the server does not take it. */
  /** Hands a request to the server, for Koppler or the agent. Copied instead when the server does not take it. */
  async deliver(text: string, prompt: { tag: string; data: object }, sent: string): Promise<boolean> {
    const token = location.pathname.split('/')[2] ?? '';
    try {
      const answer = await fetch(`/prompt?token=${encodeURIComponent(token)}`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ ...prompt, text }),
      });
      if (answer.ok) {
        toasts.show(sent);
        return true;
      }
    } catch {
      // Said below.
    }
    await navigator.clipboard.writeText(text).catch(() => undefined);
    toasts.show('No agent connection, so the request was copied to your clipboard', 'warning');
    return false;
  }

  #groups(steps: Plan, extra: (id: string) => ReviewItem['notes'] = () => []): Review['groups'] {
    return VERBS.filter(([verb]) => steps[verb].length).map(([verb, label]) => ({
      verb,
      label,
      items: steps[verb].map(step => ({
        name: name(step.id),
        notes: [
          ...(step.why.length ? [{ text: step.why.join('; ') }] : []),
          ...(verb === 'starts' || verb === 'restarts' ? extra(step.id) : []),
        ],
      })),
    }));
  }

  /** Run: shows what the board would change, and sends it once confirmed. */
  start(): void {
    const graph = this.graph();
    if (!graph.nodes.length) {
      toasts.show('Add at least one app first', 'warning');
      return;
    }
    const steps = this.#plan(graph);
    const env = graph.env.toUpperCase();
    const first = board.envs[0]?.toUpperCase() ?? '';
    // A note is for the agent: such a run goes to it first, since Koppler cannot act on free text.
    const byAgent = graph.nodes.some(node => 'note' in node);
    const missing = this.#missing();
    const borrowed = board.nodes.filter(node => board.borrowsTunnels(node.id)).map(node => node.id);
    const tunnels = board.plan;
    const skipped = board.nodes.filter(node => node.data.hideTunnels && board.tunnelsOf(node.id).length);
    const notes = (id: string): ReviewItem['notes'] => {
      const node = board.nodes.find(one => one.id === id);
      const app = board.apps.find(one => one.id === id);
      if (!node || !app) return [];
      const onCurrent = !node.data.branch || node.data.branch === app.current;
      const changes = several(app.dirty, 'change').replace(/^(\d+) /, '$1 uncommitted ');
      return [
        { text: node.data.branch || app.current || 'current branch', kind: 'host' },
        ...(app.dirty && onCurrent ? [{ text: `With your ${changes}`, kind: 'flag' as const }] : []),
        ...(app.dirty && !onCurrent
          ? [
              {
                text: `Your ${changes} on ${app.current}: ${node.data.changes === 'take-along' ? 'taken along' : 'set aside'}, back on Stop`,
                kind: 'flag' as const,
              },
            ]
          : []),
        ...(node.data.run === 'ide' ? [{ text: 'You start it; the agent only prepares it' }] : []),
        ...(node.data.note ? [{ text: `Note: ${node.data.note}` }] : []),
        ...(board.localLibraries(id).length
          ? [{ text: `Uses your local ${board.localLibraries(id).join(', ')}` }]
          : []),
      ];
    };
    const called: Record<string, string[]> = {};
    for (const { from, to } of graph.deployed) called[to] = [...(called[to] ?? []), from];
    const agent = live.status?.agent?.state ?? 'none';
    this.review = {
      title: `Run on ${env}`,
      sub: byAgent
        ? 'The agent does exactly this, with your note, and asks before anything else.'
        : 'Koppler does this as soon as you send it; the agent only steps in for what it cannot do alone.',
      // What blocks the run comes first, so the reason the button is off is the first thing read.
      notices: [
        ...(borrowed.length
          ? [
              {
                text: `The stack has no ${env} sign-in or tunnel for ${borrowed.map(name).join(', ')}. Koppler will not use another environment's.`,
                kind: 'prod' as const,
              },
            ]
          : []),
        ...(missing.length && board.protected
          ? [{ text: `Store first, then send: ${missing.join(', ')}.`, kind: 'prod' as const }]
          : []),
        ...(board.protected
          ? [
              {
                text: `${env}: your local code reads and writes real ${env} data.${tunnels.length ? ` Running opens the ${env} ${tunnels.length === 1 ? 'tunnel' : 'tunnels'} listed below.` : ''}`,
                kind: 'prod' as const,
              },
            ]
          : []),
        ...(steps.nothing ? [{ text: 'Nothing to change: the board matches what is running.' }] : []),
        ...(live.status?.live === undefined
          ? [{ text: 'Koppler cannot see what is running from this page, so everything is listed as starting.' }]
          : []),
        ...(live.status?.runs?.some(one => one.state === 'waiting')
          ? [{ text: 'An earlier run is still waiting for the agent. This one replaces it.' }]
          : []),
        ...(agent === 'none' && byAgent
          ? [
              {
                text: 'No agent is listening, so this waits until one is. Run /koppler-run connect in your agent session.',
              },
            ]
          : []),
        ...(missing.length && !board.protected
          ? [{ text: `Not stored yet, the agent will ask for it: ${missing.join(', ')}.` }]
          : []),
      ],
      groups: [
        ...this.#groups(steps, notes),
        ...(Object.keys(called).length
          ? [
              {
                verb: 'calls',
                label: `Calls ${board.protected ? env : `deployed ${env}`}`,
                items: Object.entries(called).map(([to, from]) => ({
                  name: name(to),
                  notes: [{ text: `from ${from.map(name).join(', ')}` }],
                })),
              },
            ]
          : []),
        ...(tunnels.length
          ? [
              {
                verb: 'calls',
                label: 'Opens tunnels',
                items: tunnels.map(tunnel => {
                  const off = tunnel.apps.filter(app => borrowed.includes(app));
                  const open = live.status?.ports?.[String(tunnel.port)] ? ' (already open)' : '';
                  return {
                    name: `${tunnel.what} on ${tunnel.bind}:${String(tunnel.port)}${open}`,
                    off: off.length > 0,
                    notes: [
                      { text: tunnel.host, kind: 'host' as const },
                      ...(off.length
                        ? [{ text: `${first} host: the stack has no ${env} entry for ${off.map(name).join(', ')}` }]
                        : []),
                    ],
                  };
                }),
              },
            ]
          : []),
        ...(skipped.length
          ? [
              {
                verb: 'keeps',
                label: 'No tunnels',
                items: skipped.map(node => ({
                  name: node.data.name,
                  notes: [{ text: 'Only its API runs; calls through its tunnels fail' }],
                })),
              },
            ]
          : []),
      ],
      ok: steps.nothing ? 'Run anyway' : board.protected ? `Run on ${env}` : 'Run',
      prod: board.protected,
      blocked: borrowed.length > 0 || (board.protected && missing.length > 0),
      confirm: () => {
        const confirmed = Object.fromEntries(VERBS.map(([verb]) => [verb, steps[verb]]));
        const text =
          'Set up and run this stack using the koppler-run skill and temp/registry.js.\n' +
          this.#describe(graph) +
          '\nPLAN the user confirmed on the canvas (do exactly this; check it first with koppler plan):\n' +
          describe(steps, { name })
            .map(line => `  ${line}`)
            .join('\n');
        // What is confirmed is the board as it was reviewed.
        const layout = board.saved();
        void save(layout);
        const data = { ...graph, id: newRunId(), plan: confirmed, layout };
        void this.deliver(
          text,
          { tag: 'koppler', data },
          byAgent ? 'Sent. Waiting for the agent' : 'Sent. Koppler is starting it',
        );
      },
    };
  }

  /** Asks the agent to find out why an app failed to start; it says what it would change and asks before acting. */
  askToFix(id: string, step: string): Promise<boolean> {
    const env = board.env.toUpperCase();
    const text = [
      'Fix this failed start, using the koppler-run skill.',
      `ENV ${env}`,
      `APP ${name(id)} (${id})`,
      `FAILED ${step}`,
      'Find the cause, say what you would change, and ask before you start, stop or restart anything.',
    ].join('\n');
    const data = {
      env: board.env,
      failures: [{ connection: name(id), result: 'Failed to start', detail: step, app: id }],
    };
    const waiting = (live.status?.agent?.state ?? 'none') === 'none';
    return this.deliver(
      text,
      { tag: 'koppler-fix', data },
      waiting ? 'Saved. The agent gets it when one connects.' : 'Sent to the agent',
    );
  }

  /** Stop: what Koppler started is stopped and its temporary changes are undone. */
  stop(): void {
    const steps = this.#plan({ env: board.env, nodes: {}, edges: [] });
    const started = (live.status?.running ?? []).filter(one => one !== 'canvas');
    const others = started.filter(one => !board.apps.some(app => app.id === one));
    const last = [...(live.status?.runs ?? [])].reverse().find(one => one.state === 'done' || one.state === 'failed');
    const left = last && last.kind !== 'stop' ? (last.changes ?? []) : [];
    const running = started.length > 0;
    this.review = {
      title: running ? 'Stop and revert' : 'Revert temporary changes',
      sub: running
        ? 'Koppler stops what it started and undoes its temporary changes; the agent only gets what it cannot undo safely.'
        : 'Nothing is running. Koppler undoes what the last run left behind.',
      notices: [
        ...(others.length ? [{ text: `Also stops: ${others.join(', ')}.` }] : []),
        {
          text: 'Left alone: anything you started yourself or from your IDE, your AWS sign-ins and stored credentials.',
        },
      ],
      groups: [
        ...(running ? this.#groups(steps).filter(group => group.verb === 'stops') : []),
        ...(left.length
          ? [
              {
                verb: 'stops',
                label: 'Revert',
                items: left.map(change => ({
                  name: name(change.app),
                  notes: [{ text: `${change.title}${change.file ? ` (${change.file})` : ''}` }],
                })),
              },
            ]
          : []),
      ],
      ok: running ? 'Stop and revert' : 'Revert',
      prod: true,
      blocked: false,
      confirm: () => {
        const text =
          'Stop and revert this stack using the koppler-run skill: stop every process the agent started (apps, tunnels, background tasks; leave anything started from an IDE or by me) and revert every temporary code change (do-not-commit edits and added launch profiles). Report what was stopped and reverted.';
        void this.deliver(
          text,
          { tag: 'koppler-stop', data: { action: 'stop', id: newRunId() } },
          'Stopping and reverting',
        );
      },
    };
  }
}
export const runs = new Runs();
