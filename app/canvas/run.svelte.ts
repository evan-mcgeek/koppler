// Run and Stop: what the board asks for, what that changes against what is running, the review of it, and the
// request the agent or Koppler gets once it is confirmed. The plan itself is core/plan.
import { describe, plan, type Plan } from '../src/core/plan.ts';
import { board } from './board.svelte.ts';
import { openBoard } from './boards.ts';
import { post, save } from './data.ts';
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
const name = (id: string) => board.apps.find(app => app.id === id)?.name ?? id;
const several = (count: number, one: string) => `${String(count)} ${one}${count === 1 ? '' : 's'}`;

class Runs {
  /** The review on screen, waiting to be confirmed. */
  review = $state.raw<Review | null>(null);

  /** What the board asks for, as the agent and the plan read it; with `restart`, only what runs, with that card's settings and cables from the board. */
  graph(restart?: string) {
    const was = live.status?.live;
    const keep = (id: string) => !restart || id === restart || Object.hasOwn(was?.nodes ?? {}, id);
    const mine = board.nodes.map(({ id, data }) => {
      const app = board.apps.find(one => one.id === id);
      return {
        id,
        branch: data.branch || null,
        run: data.run as 'cli' | 'ide',
        ...(data.hideTunnels && board.tunnelsOf(id).length > 0 && { tunnels: false as const }),
        ...(data.showQueues && board.queuesOf(id).length > 0 && { queues: true as const }),
        ...(board.switchesOver(id) && { changes: data.changes ?? ('set-aside' as const) }),
        ...(data.platform && data.run === 'cli' && !!app?.platforms.length && { platform: data.platform }),
        ...(data.note.trim() && { note: data.note.trim() }),
        ...(board.localLibraries(id).length > 0 && { libraries: board.localLibraries(id) }),
      };
    });
    const asked = board.edges.map(({ source, target }) => ({ from: source, to: target }));
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
    const deployed = nodes.flatMap(({ id }) =>
      (board.apps.find(app => app.id === id)?.calls ?? [])
        .filter(to => !edges.some(edge => edge.from === id && edge.to === to))
        .map(to => ({ from: id, to })),
    );
    const queues = restart
      ? Object.fromEntries(Object.entries(was?.queues ?? {}).filter(([, where]) => where === 'local'))
      : Object.fromEntries(
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

  #describe(graph: ReturnType<Runs['graph']> & { mode: string; note?: string }): string {
    const env = graph.env.toUpperCase();
    const calls = (from: string, to: string) => board.apps.find(app => app.id === from)?.known.includes(to);
    return [
      `ENV ${env}`,
      `MODE ${graph.mode === 'manual' ? 'manual: give me a checklist, change nothing' : 'auto: apply the changes and start everything'}`,
      ...(graph.note ? [`NOTE ${graph.note}`] : []),
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
    this.start(this.#asked);
  }

  start({ note, manual = false, restart }: { note?: string; manual?: boolean; restart?: string } = {}): void {
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
      const app = board.apps.find(one => one.id === id);
      if (!node || !app) return [];
      const onCurrent = !node.data.branch || node.data.branch === app.current;
      const changes = several(app.dirty, 'change').replace(/^(\d+) /, '$1 uncommitted ');
      return [
        // With a branch to pick below, the branch is not said twice.
        ...(new Set([app.current, ...app.branches]).size > 1
          ? []
          : [{ text: node.data.branch || app.current || 'current branch', kind: 'host' as const }]),
        ...(app.dirty && onCurrent ? [{ text: `With your ${changes}`, kind: 'flag' as const }] : []),
        ...(board.uncabled(id)
          ? [{ text: 'Not cabled to any app here: it runs on its own', kind: 'flag' as const }]
          : []),
        ...(app.dirty && !onCurrent
          ? [
              {
                text: `Your ${changes} on ${app.current}: ${node.data.changes === 'take-along' ? 'taken along' : 'set aside'}, back on Stop`,
                kind: 'flag' as const,
              },
            ]
          : []),
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
                verb: 'calls',
                label: `Calls ${board.protected ? env : `deployed ${env}`}`,
                items: Object.entries(called).map(([to, from]) => {
                  const callee = board.apps.find(app => app.id === to);
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
      'Propose the stack.json additions (apps.<id>.envs.<env>.prereqs, .secrets with fetch steps) and wait for the user to confirm before writing them.',
    ].join('\n');
    const waiting = (live.status?.agent?.state ?? 'none') === 'none';
    return this.deliver(
      text,
      { tag: 'koppler-facts', data: { env, gaps } },
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
    const token = location.pathname.split('/')[2] ?? '';
    try {
      const answer = await fetch(`/${route}?token=${encodeURIComponent(token)}`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: '{}',
      });
      if (!answer.ok) return null;
      return answer.status === 204 ? ({} as T) : ((await answer.json()) as T);
    } catch {
      return null;
    }
  }

  /** What Koppler started, by the name it runs under. */
  get started(): string[] {
    return (live.status?.running ?? []).filter(one => one !== 'canvas');
  }

  /** The stack being switched to from this page, until the page reloads with it. */
  switching = $state<string | null>(null);

  /** Another stack: at once when nothing runs here, else after the Stop and revert its review shows. */
  useStack(to: { dir: string; name: string }): void {
    const steps = this.#plan({ env: board.env, nodes: {}, edges: [] });
    if (!steps.stops.length && !this.started.length) {
      void this.#switch(to.dir);
      return;
    }
    this.review = {
      title: `Switch to ${to.name}`,
      sub: `${board.stack} still has something running. It is stopped and reverted first, then Koppler switches.`,
      notices: [{ text: `Your boards and history for ${board.stack} are kept and come back when you switch back.` }],
      groups: this.#groups(steps).filter(group => group.verb === 'stops'),
      ok: 'Stop, revert and switch',
      prod: true,
      blocked: false,
      confirm: () => {
        const text = `Stop and revert this stack using the koppler-run skill (stop every process the agent started, revert every temporary code change), then switch Koppler to the stack "${to.name}": koppler history --done <this run's id>, then koppler use "${to.dir}". Report what was stopped and reverted.`;
        void this.deliver(
          text,
          { tag: 'koppler-stop', data: { action: 'stop', id: newRunId(), switchTo: to.dir } },
          'Sent. Koppler switches once everything is stopped',
        );
      },
    };
  }
  /** Calls a stack action on the server that answers with a result or an error. */
  async #stack<T extends object>(action: string): Promise<T | null> {
    const said = await post<T>(action);
    if (!('error' in said)) return said;
    toasts.show(said.error, 'warning');
    return null;
  }
  /** Brings in what changed in the shared stack on GitHub. */
  async updateStack(): Promise<void> {
    const said = await this.#stack<{ updated?: boolean; message?: string }>('stack-update');
    if (said?.updated) location.reload();
    else if (said) toasts.show(said.message ?? 'Already up to date.');
  }
  /** What this copy of a linked stack has that the shared one does not: shared as a pull request, or dropped. */
  shareChanges(): void {
    const linked = live.status?.linked;
    if (!linked) return;
    const items = linked.changes.map(change => ({
      name: change.replace(/^./, first => first.toUpperCase()),
      notes: [],
    }));
    const groups = [{ verb: 'keeps', label: 'Changes', items }];
    this.review = {
      title: 'Changes not in the shared stack yet',
      sub: `What Koppler learned here, kept in your copy of ${board.stack}. The shared stack on GitHub stays as it is until a pull request is merged.`,
      notices: [
        ...(linked.pr
          ? [
              {
                text: `A pull request is already open: ${linked.pr}. Opening another replaces nothing; close the old one if you open a new one.`,
              },
            ]
          : []),
        {
          text: 'Opening a pull request pushes a new branch to the shared repo with your GitHub account, for your team to review. No secret values are in it.',
        },
      ],
      groups,
      ok: 'Open pull request',
      prod: false,
      blocked: false,
      confirm: () => {
        toasts.show('Opening the pull request…');
        void this.#stack<{ url?: string }>('stack-pr').then(said => {
          if (said)
            toasts.show('Pull request opened', 'message', {
              label: 'View',
              run: () => window.open(said.url, '_blank', 'noopener'),
            });
        });
      },
      back: {
        label: 'Discard my changes instead',
        run: () => {
          this.review = {
            title: 'Discard your changes',
            sub: `Your copy of ${board.stack} goes back to the shared stack as last fetched. What Koppler learned here is lost.`,
            notices: [],
            groups,
            ok: 'Discard',
            prod: true,
            blocked: false,
            confirm: () => {
              void this.#stack('stack-discard').then(said => {
                if (said) location.reload();
              });
            },
          };
        },
      },
    };
  }
  /** A new stack, or one from GitHub: asked for at once when nothing runs, else after a Stop and revert. */
  addStack(ask: () => void): void {
    const steps = this.#plan({ env: board.env, nodes: {}, edges: [] });
    if (!steps.stops.length && !this.started.length) {
      ask();
      return;
    }
    this.review = {
      title: 'Start a new stack',
      sub: `${board.stack} still has something running. It is stopped and reverted first; then choose Add a stack again.`,
      notices: [{ text: `Your boards and history for ${board.stack} are kept and come back when you switch back.` }],
      groups: this.#groups(steps).filter(group => group.verb === 'stops'),
      ok: 'Stop and revert',
      prod: true,
      blocked: false,
      confirm: () => {
        void this.deliver(
          'Stop and revert this stack using the koppler-run skill (stop every process the agent started, revert every temporary code change), so the user can start a new stack. Report what was stopped and reverted.',
          { tag: 'koppler-stop', data: { action: 'stop', id: newRunId() } },
          'Stopping and reverting',
        );
      },
    };
  }
  async #switch(dir: string): Promise<void> {
    this.switching = dir;
    const token = location.pathname.split('/')[2] ?? '';
    const said = await fetch(`/stack?token=${encodeURIComponent(token)}`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ use: dir }),
    })
      .then(answer => answer.json() as Promise<{ error?: string }>)
      .catch(() => ({ error: 'Could not reach the canvas server.' }));
    if (!said.error) {
      location.reload();
      return;
    }
    this.switching = null;
    toasts.show(said.error, 'warning');
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
