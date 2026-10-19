// Run and Stop: what the board asks for, what that changes against what is running, the review of it, and the
// request the agent or Koppler gets once it is confirmed. The plan itself is core/plan.
import { describe, plan, type Plan, type RunIn } from '../src/core/plan.ts';
import { board } from './board.svelte.ts';
import { openBoard } from './boards.ts';
import { post, save, send } from './data.ts';
import { live } from './live.svelte.ts';
import { dialogs } from './dialogs.svelte.ts';
import { toasts } from './toast.svelte.ts';

/** One line of a review: an app or a tunnel, with what is worth knowing under it. */
export interface ReviewItem {
  name: string;
  notes: { text: string; kind?: 'host' | 'flag'; title?: string }[];
  off?: boolean;
  /** The app whose card controls the review offers: what it starts with can still be changed here. */
  id?: string;
  /** Something to do about this line, without leaving the review. */
  act?: { label: string; title: string; run: () => void };
}
export interface Review {
  title: string;
  sub: string;
  notices: { text: string; kind?: 'prod'; act?: { label: string; run: () => void } }[];
  groups: { verb: string; label: string; items: ReviewItem[] }[];
  ok: string;
  /** Marks the confirm button red: a protected environment, or a stop. */
  prod: boolean;
  /** Something has to be put right first: the confirm button is off. */
  blocked: boolean;
  confirm: () => void;
  /** Another way out than Cancel, when the review was opened by a step that can be taken back. */
  back?: { label: string; run: () => void };
}
const VERBS = [
  ['starts', 'Starts'],
  ['restarts', 'Restarts'],
  ['stops', 'Stops and reverts'],
  ['keeps', 'Keeps running'],
] as const;
const newRunId = () => (Date.now().toString(36) + Math.random().toString(36).slice(2, 8)).replace(/[^a-z0-9]/g, '');
const name = board.nameOf;
const several = (count: number, one: string) => `${String(count)} ${one}${count === 1 ? '' : 's'}`;

class Runs {
  /** The review on screen, waiting to be confirmed. */
  review = $state.raw<Review | null>(null);
  /** The apps the user chose to run with no cable, in the review: it stops asking. */
  onItsOwn = $state<Record<string, true>>({});
  /** The apps the user left out of the run under review: their cards stay on the board. */
  leftOut = $state<Record<string, true>>({});

  /** What the board asks for, as the agent and the plan read it; with `restart`, only what runs, with that card's settings and cables from the board. */
  graph(restart?: string) {
    const was = live.status?.live;
    const keep = (id: string) => !restart || id === restart || Object.hasOwn(was?.nodes ?? {}, id);
    const mine = board.nodes
      .filter(({ id }) => !this.leftOut[id])
      .map(({ id, data }) => {
        const app = board.app(id);
        return {
          id,
          branch: (data.run !== 'mock' && data.branch) || null,
          run: data.run as RunIn,
          ...(data.hideTunnels && board.tunnelsOf(id).length > 0 && { tunnels: false as const }),
          ...(data.showQueues && board.queuesOf(id).length > 0 && { queues: true as const }),
          ...(data.watch && data.run === 'cli' && { watch: true as const }),
          ...(board.switchesOver(id) && { changes: data.changes ?? ('set-aside' as const) }),
          ...(data.platform && data.run === 'cli' && !!app?.platforms.length && { platform: data.platform }),
          ...(data.run !== 'mock' && data.note.trim() && { note: data.note.trim() }),
          ...(board.localLibraries(id).length > 0 && { libraries: board.localLibraries(id) }),
        };
      });
    const asked = board.edges
      .filter(({ source, target }) => !this.leftOut[source] && !this.leftOut[target])
      .map(({ source, target }) => ({ from: source, to: target }));
    // The rest stays as it runs: their settings and cables as last applied.
    const nodes = restart
      ? mine.flatMap(node =>
          node.id === restart
            ? [node]
            : keep(node.id)
              ? [{ ...(was?.nodes?.[node.id] as typeof node), id: node.id }]
              : [],
        )
      : mine;
    const edges = restart
      ? [
          ...(Array.isArray(was?.edges) ? (was.edges as { from: string; to: string }[]) : []).filter(
            edge => edge.from !== restart && keep(edge.to),
          ),
          ...asked.filter(edge => edge.from === restart && keep(edge.to)),
        ]
      : asked;
    // A mock calls nothing.
    const deployed = nodes
      .filter(node => node.run !== 'mock')
      .flatMap(({ id }) =>
        (board.app(id)?.calls ?? [])
          .filter(to => !edges.some(edge => edge.from === id && edge.to === to))
          .map(to => ({ from: id, to })),
      );
    const queues = restart
      ? Object.fromEntries(Object.entries(was?.queues ?? {}).filter(([, where]) => where === 'local'))
      : Object.fromEntries(
          board.infra.flatMap(card => (card.type === 'queue' && card.data.local ? [[card.data.queue, 'local']] : [])),
        );
    // A restart keeps the databases as they run; a run takes the board's.
    const databases = restart
      ? Object.fromEntries(Object.entries(was?.databases ?? {}).filter(([, where]) => where === 'local'))
      : board.databases;
    return {
      env: board.env,
      mode: 'auto',
      nodes,
      edges,
      deployed,
      ...(Object.keys(queues).length && { queues }),
      ...(Object.keys(databases).length && { databases }),
    };
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
      databasesOf: id => board.databasesOf(id),
      current: id => board.app(id)?.current,
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

  #describe(graph: ReturnType<Runs['graph']> & { mode: string; note?: string }): string {
    const env = graph.env.toUpperCase();
    const calls = (from: string, to: string) => board.app(from)?.known.includes(to);
    return [
      `ENV ${env}`,
      `MODE ${graph.mode === 'manual' ? 'manual: give me a checklist, change nothing' : 'auto: apply the changes and start everything'}`,
      ...(graph.note ? [`NOTE ${graph.note}`] : []),
      ...Object.keys(graph.queues ?? {}).map(queue => `QUEUE ${board.queueName(queue)}: local, in the AWS emulator`),
      ...Object.keys(graph.databases ?? {}).map(
        database => `DATABASE ${board.databaseName(database)}: local, the user's own on this Mac`,
      ),
      ...graph.nodes.flatMap(node => {
        const platform = board.apps
          .find(app => app.id === node.id)
          ?.platforms.find(([value]) => value === node.platform);
        if (node.run === 'mock') return [`MOCK ${name(node.id)}: Koppler answers its mock responses from the stack`];
        const how = [node.run === 'ide' ? 'IDE' : 'CLI', node.run === 'cli' ? platform?.[1].split(' ')[0] : undefined];
        return [
          `LOCAL ${name(node.id)} [${how.filter(Boolean).join(', ')}] on ${node.branch ?? 'current branch'}`,
          ...(node.note ? [`  note: ${node.note}`] : []),
        ];
      }),
      ...graph.edges.map(({ from, to }) => {
        const found = board.app(from)?.calls.includes(to);
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
    if ((await send('prompt', { ...prompt, text }))?.ok) {
      toasts.show(sent);
      return true;
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
        ...((verb === 'starts' || verb === 'restarts') && { id: step.id }),
        notes: [
          ...(step.why.length ? [{ text: step.why.join('; ') }] : []),
          ...(verb === 'starts' || verb === 'restarts' ? extra(step.id) : []),
        ],
      })),
    }));
  }

  /** Run: shows what the board would change, and sends it once confirmed. */
  /**
   * Run: the review of what the board asks for, sent when confirmed. With a note it goes to the agent first; as a
   * checklist the agent changes nothing and lists the steps.
   */
  #asked: { note?: string; manual?: boolean; restart?: string } = {};
  /** The review again, after something it shows was changed from inside it. */
  again(): void {
    this.#again = true;
    this.start(this.#asked);
  }
  #again = false;

  start({ note, manual = false, restart }: { note?: string; manual?: boolean; restart?: string } = {}): void {
    // A new review starts with every app on the board; one shown again keeps what was left out of it.
    if (!this.#again) this.leftOut = {};
    this.#again = false;
    this.#asked = { manual, ...(note && { note }), ...(restart && { restart }) };
    const asked = this.graph(restart);
    const graph = {
      ...asked,
      // One app asked to start again: it keeps its cables and settings, as the rest keeps running.
      nodes: asked.nodes.map(node => (node.id === restart ? { ...node, restart: true as const } : node)),
      mode: manual ? 'manual' : 'auto',
      ...(note && { note }),
    };
    if (!graph.nodes.length) {
      toasts.show('Add at least one app first', 'warning');
      return;
    }
    const steps = this.#plan(graph);
    const env = graph.env.toUpperCase();
    const first = board.envs[0]?.toUpperCase() ?? '';
    // A note is for the agent: such a run goes to it first, since Koppler cannot act on free text.
    const byAgent = !!note || graph.nodes.some(node => 'note' in node);
    const missing = this.#missing();
    const borrowed = board.nodes.filter(node => board.borrowsTunnels(node.id)).map(node => node.id);
    const tunnels = board.plan;
    const skipped = board.nodes.filter(node => node.data.hideTunnels && board.tunnelsOf(node.id).length);
    // What stands in the way has a list of what to do about it.
    const whatToDo = {
      label: 'What to do',
      run: () => {
        this.review = null;
        void dialogs.checklist?.open();
      },
    };
    const notes = (id: string): ReviewItem['notes'] => {
      const node = board.nodes.find(one => one.id === id);
      const app = board.app(id);
      if (!node || !app) return [];
      const onCurrent = !node.data.branch || node.data.branch === app.current;
      const changes = several(app.dirty, 'change').replace(/^(\d+) /, '$1 uncommitted ');
      return [
        // With a branch to pick below, the branch is not said twice.
        ...(new Set([app.current, ...app.branches]).size > 1
          ? []
          : [{ text: node.data.branch || app.current || 'current branch', kind: 'host' as const }]),
        ...(app.dirty && onCurrent ? [{ text: `With your ${changes}`, kind: 'flag' as const }] : []),

        // The remembered code changes this run applies: for this environment, or for a cable the app has here.
        ...(live.status?.recipes?.[id] ?? [])
          .filter(
            ({ when }) =>
              when?.always ||
              when?.env === graph.env ||
              graph.edges.some(edge => edge.from === id && edge.to === when?.calls),
          )
          .map(recipe => {
            const ran = recipe.here
              ? `${recipe.here.ok ? 'works on my machine' : 'failed here'}, last run ${recipe.here.at}`
              : 'not run here yet';
            return { text: `Remembered change: ${recipe.why} (${ran})`, title: recipe.file };
          }),
        ...(node.data.run === 'ide' ? [{ text: 'You start it; the agent only prepares it' }] : []),
        ...(node.data.run === 'mock' ? [{ text: 'A mock: its responses from the stack answer in its place' }] : []),
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
      title: manual ? `Checklist for ${env}` : `Run on ${env}`,
      sub: manual
        ? 'You get a checklist of these steps to do yourself. The agent changes nothing.'
        : byAgent
          ? 'The agent does exactly this, with your note, and asks before anything else.'
          : 'Koppler does this as soon as you send it; the agent only steps in for what it cannot do alone.',
      // What blocks the run comes first, so the reason the button is off is the first thing read.
      notices: [
        ...(borrowed.length
          ? [
              {
                text: `The stack has no ${env} sign-in or tunnel for ${borrowed.map(name).join(', ')}. Koppler will not use another environment's.`,
                kind: 'prod' as const,
                act: whatToDo,
              },
            ]
          : []),
        ...(missing.length && board.protected
          ? [{ text: `Store first, then send: ${missing.join(', ')}.`, kind: 'prod' as const, act: whatToDo }]
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
        ...(note ? [{ text: `Your note: ${note}` }] : []),
        ...(agent === 'none' && (byAgent || manual)
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
                verb: 'deployed',
                label: `Calls ${board.protected ? env : `deployed ${env}`}`,
                items: Object.entries(called).map(([to, from]) => {
                  const callee = board.app(to);
                  const can = callee?.cloned && !callee.outside && callee.answers;
                  return {
                    name: name(to),
                    notes: [{ text: `from ${from.map(name).join(', ')}` }],
                    ...(can && {
                      act: {
                        label: 'Run locally',
                        title: `Run it locally too, and point ${from.map(name).join(', ')} at it`,
                        run: () => {
                          board.add(to);
                          for (const caller of from) board.connect(caller, to);
                          this.again();
                        },
                      },
                    }),
                  };
                }),
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
      ok: manual ? 'Get the checklist' : steps.nothing ? 'Run anyway' : board.protected ? `Run on ${env}` : 'Run',
      prod: board.protected,
      blocked: borrowed.length > 0 || (board.protected && missing.length > 0),
      confirm: () => {
        const confirmed = Object.fromEntries(VERBS.map(([verb]) => [verb, steps[verb]]));
        const text =
          'Set up and run this stack using the koppler-run skill.\n' +
          this.#describe(graph) +
          '\nPLAN the user confirmed on the canvas (do exactly this; check it first with koppler plan):\n' +
          describe(steps, { name })
            .map(line => `  ${line}`)
            .join('\n');
        // What is confirmed is the board as it was reviewed.
        board.commit();
        const layout = board.saved();
        void save(layout);
        const data = { ...graph, id: newRunId(), plan: confirmed, layout };
        void this.deliver(
          text,
          { tag: 'koppler', data },
          byAgent || manual ? 'Sent. Waiting for the agent' : 'Sent. Koppler is starting it',
        );
      },
    };
  }

  /** Hands what the stack misses for an environment to the agent, which proposes the additions and waits for a yes. */
  askFacts(env: string, gaps: string[]): Promise<boolean> {
    const text = [
      'Find the missing facts for this environment in the stack, using the koppler-run skill.',
      `ENV ${env.toUpperCase()}`,
      'MISSING:',
      ...gaps.map(gap => `  ${gap}`),
      "Read each app's repo (infrastructure files such as Terraform tfvars, workflow files) and the user's local tunnel aliases. Never read or print a secret value.",
      'Propose the additions (apps.<id>.envs.<env>.prereqs, .secrets with fetch steps), wait for the user to confirm, then make them with koppler stack set; never write stack.json.',
    ].join('\n');
    const waiting = (live.status?.agent?.state ?? 'none') === 'none';
    return this.deliver(
      text,
      { tag: 'koppler-facts', data: { env, gaps } },
      waiting ? 'Saved. The agent gets it when one connects.' : 'Sent to the agent',
    );
  }

  /** Asks the agent to fill in an app's settings from its repo: it proposes, waits for a yes, and leaves locked ones alone. */
  askFill(id: string, empty: string[], locked: string[]): Promise<boolean> {
    const text = [
      "Fill in this app's settings in the stack from its repo, using the koppler-run skill.",
      `APP ${name(id)} (${id})`,
      `EMPTY ${empty.join(', ') || 'none'}`,
      `LOCKED ${locked.join(', ') || 'none'} (never change these)`,
      "Read the app's repo (launch settings, package files, infrastructure, README) to find each fact; leave a field empty when it does not apply. Never read or print a secret value.",
      'Propose what you would set, and why, wait for the user to confirm, then make each change with koppler stack set apps.' +
        id +
        '.<field>; never write stack.json.',
    ].join('\n');
    const waiting = (live.status?.agent?.state ?? 'none') === 'none';
    return this.deliver(
      text,
      { tag: 'koppler-facts', data: { env: board.env, app: id, gaps: empty } },
      waiting ? 'Saved. The agent gets it when one connects.' : 'Sent to the agent',
    );
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

  /** Asks the server to do something that needs no answer but done or not. */
  async #ask<T>(route: string): Promise<T | null> {
    const answer = await send(route);
    if (!answer?.ok) return null;
    return answer.status === 204 ? ({} as T) : ((await answer.json().catch(() => null)) as T | null);
  }

  /** What Koppler started, by the name it runs under. */
  get started(): string[] {
    return (live.status?.running ?? []).filter(one => one !== 'canvas');
  }
  /** The temporary changes the last run left, until a Stop reverts them. */
  get left() {
    const last = [...(live.status?.runs ?? [])].reverse().find(one => one.state === 'done' || one.state === 'failed');
    return last && last.kind !== 'stop' ? (last.changes ?? []) : [];
  }

  /** Stops every app and tunnel now; branches and code changes stay until a Stop and revert. */
  stopApps(): void {
    // An app from the IDE only has Koppler's log follower here: the app itself keeps running in the IDE.
    const fromIde = (id: string) => live.status?.apps?.[id]?.running?.some(one => one.source === 'ide');
    const items = this.started.map(one => ({
      name: board.apps.some(app => app.id === one)
        ? name(one)
        : one.startsWith('tunnel-')
          ? `Tunnel ${one.slice(7)}`
          : one,
      notes: fromIde(one) ? [{ text: 'Its log only; the app keeps running in your IDE' }] : [],
    }));
    this.review = {
      title: 'Stop apps, keep changes',
      sub: 'Koppler stops these now. Branches and code changes stay; Stop and revert undoes them later.',
      notices: [],
      groups: [{ verb: 'stops', label: 'Stops', items }],
      ok: 'Stop apps',
      prod: true,
      blocked: false,
      confirm: () => {
        void this.#ask<{ stopped: string[] }>('stop-apps').then(done => {
          const count = done?.stopped.length ?? 0;
          if (done)
            toasts.show(
              `Stopped ${String(count)} ${count === 1 ? 'process' : 'processes'}. Your changes stay until you revert.`,
            );
          else toasts.show('Could not reach the canvas server.', 'warning');
        });
      },
    };
  }

  /** Run alone: one app and its tunnels on a board of its own, straight to the review, which leads back. */
  alone(id: string): void {
    const before = board.alone(id);
    this.start();
    if (!before || !this.review) return;
    this.review = {
      ...this.review,
      back: {
        label: `Back to ${before.name}`,
        run: () => {
          openBoard(before);
        },
      },
    };
  }

  /** Stops one app; its branch and code changes stay. */
  async stopApp(id: string): Promise<void> {
    const done = await post<{ stopped: string[] }>('stop-apps', { app: id });
    if ('stopped' in done && done.stopped.length)
      toasts.show(`Stopped ${name(id)}. Its changes stay until you revert.`);
    else toasts.show(`Could not stop ${name(id)}.`, 'warning');
  }

  /** Stops the agent's listener and the canvas server; what runs keeps running. */
  shutDown(): void {
    const listening = ['listening', 'busy'].includes(live.status?.agent?.state ?? 'none');
    const command = live.status?.start ?? 'koppler canvas';
    this.review = {
      title: 'Shut down Koppler',
      sub: 'This page stops updating until you start the canvas again.',
      notices: this.started.length
        ? [{ text: `Keeps running: ${this.started.join(', ')}. Stop and revert stops those.` }]
        : [],
      groups: [
        {
          verb: 'stops',
          label: 'Stops',
          items: [
            ...(listening
              ? [
                  {
                    name: 'The agent listener',
                    notes: [{ text: 'The agent stops getting runs until it connects again' }],
                  },
                ]
              : []),
            { name: 'The canvas server', notes: [] },
          ],
        },
      ],
      ok: 'Shut down',
      prod: true,
      blocked: false,
      confirm: () => {
        void this.#ask('shutdown').then(done => {
          if (!done) {
            toasts.show('Could not reach the canvas server.', 'warning');
            return;
          }
          toasts.show(`Koppler is shut down. Start it again with ${command}.`, 'message', {
            label: 'Copy command',
            run: () => void navigator.clipboard.writeText(command).catch(() => undefined),
          });
        });
      },
    };
  }

  /** Stop: what Koppler started is stopped and its temporary changes are undone. */
  stop(): void {
    const { started, left } = this;
    const others = started.filter(one => !board.app(one));
    const running = started.length > 0;
    this.stopReview({
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
      stops: running,
      also: left.length
        ? [
            {
              verb: 'stops',
              label: 'Revert',
              items: [...new Set(left.map(change => change.app))].map(app => ({
                name: name(app),
                notes: left
                  .filter(change => change.app === app)
                  .map(change => ({ text: `${change.title}${change.file ? ` (${change.file})` : ''}` })),
              })),
            },
          ]
        : [],
      ok: running ? 'Stop and revert' : 'Revert',
      text: 'Stop and revert this stack using the koppler-run skill: stop every process the agent started (apps, tunnels, background tasks; leave anything started from an IDE or by me) and revert every temporary code change (do-not-commit edits and added launch profiles). Report what was stopped and reverted.',
      sent: 'Stopping and reverting',
    });
  }

  /**
   * The review of a Stop and revert: what stops (unless `stops` is false), what else is listed, and what the agent is
   * told once it is confirmed. `data` goes with the request, such as the stack to switch to afterwards.
   */
  stopReview({
    stops = true,
    also = [],
    text,
    sent,
    data = {},
    ...shown
  }: Pick<Review, 'title' | 'sub' | 'notices' | 'ok'> & {
    stops?: boolean;
    also?: Review['groups'];
    text: string;
    sent: string;
    data?: object;
  }): void {
    const steps = this.#plan({ env: board.env, nodes: {}, edges: [] });
    this.review = {
      ...shown,
      groups: [...(stops ? this.#groups(steps).filter(group => group.verb === 'stops') : []), ...also],
      prod: true,
      blocked: false,
      confirm: () => {
        void this.deliver(text, { tag: 'koppler-stop', data: { action: 'stop', id: newRunId(), ...data } }, sent);
      },
    };
  }
  /** Whether anything Koppler would stop runs: nothing to stop and revert before leaving this stack. */
  get idle(): boolean {
    return !this.#plan({ env: board.env, nodes: {}, edges: [] }).stops.length && !this.started.length;
  }
  /** Does what the open review says; the review closes first, so what it does can open another. */
  confirm(): void {
    const review = this.review;
    this.review = null;
    review?.confirm();
  }
}
export const runs = new Runs();
