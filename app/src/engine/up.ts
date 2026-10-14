// `koppler up`: everything a run needs, started in one go: its tunnels, then its apps with the ones called first, each
// waited for. Every run is recorded like a Run from the canvas, so the canvas, the history and Stop all know it.
// With --run <id> it carries out that confirmed Send: stops and restarts, branches as chosen on the cards, remembered
// changes, each cable's local address passed to its caller, then starts. What it cannot do alone is listed for the
// agent (exit 3).
import fs from 'node:fs';
import path from 'node:path';
import { envOf, flagValue, positional } from '../cli/output.ts';
import { fail, Failure } from '../failure.ts';
import { of as kindOf } from '../core/kinds.ts';
import type { BoardNode, Edge } from '../core/plan.ts';
import { aliasReady, planSteps, planTunnels, type TunnelNeed } from '../core/ports.ts';
import { signInOf, type SignIn } from '../core/sign-in.ts';
import type { Prereq } from '../core/stack.ts';
import { readClones, readData, readStack, type Clone, type Registry } from '../data.ts';
import { tempDir } from '../paths.ts';
import { readActions, type Action } from './actions.ts';
import { switchTo, type Carry } from './branch.ts';
import { APPROVE, approved, missingTunnels, startsFromStack } from './checks.ts';
import { link } from './libraries.ts';
import { isDone } from './needs.ts';
import { alive, listener, readRecord, records, sh, sleep, stopOne } from './processes.ts';
import * as localQueue from './queues.ts';
import { matches, prepare, recipesFor } from './recipes.ts';
import { run } from './run.ts';
import { appliedCommand, planFor, runningPart } from './runs.ts';
import { appendRun, live, runRecord, runs, type Run } from './history.ts';
import { wireInfo } from './wire.ts';
import { writeJson } from '../json-files.ts';
import { appOn } from '../core/stack.ts';

type StepState = 'todo' | 'user' | 'done' | 'failed';
interface ProgressStep {
  label: string;
  state: StepState;
  detail?: string;
}
/** One run being carried out. */
interface Up {
  stack: Registry;
  clones: Record<string, Clone | null | undefined>;
  env: string;
  ids: string[];
  /** The confirmed Send, when there is one. */
  board: Run | null;
  node: (id: string) => Partial<BoardNode>;
  edges: Edge[];
  /** What Koppler could not do alone, for the agent. */
  left: string[];
  /** Apps that must not start: something they need failed. */
  skip: Set<string>;
  /** Callers not started yet: a cable of theirs still needs a change in their code. */
  waits: Set<string>;
  /** Settings each app is started with. */
  setEnv: Record<string, Record<string, string>>;
  logFile: string;
  /** Shows a step on the app's card as the run goes. */
  step: (id: string, label: string, state: StepState, detail?: string | null) => void;
}

const USAGE = 'usage: koppler up <app...> [--cable <caller>:<callee>]... [--env <env>] | --board "<name>" | --run <id>';
const running = (name: string) => {
  const record = readRecord(name);
  return !!record && alive(record);
};
const nameOf = (stack: Registry, id: string) => stack.apps[id]?.name ?? id;
const prereqsOf = (stack: Registry, id: string, env: string): Prereq[] => {
  return appOn(stack, id, env)?.prereqs ?? [];
};
/** The tunnels an app needs on an environment, as the stack states them. */
export const tunnelsOf = (stack: Registry, id: string, env: string): TunnelNeed[] =>
  prereqsOf(stack, id, env).flatMap(({ tunnel, port, env: setting, what, connectsAs }) =>
    tunnel && port ? [{ app: id, tunnel, port, env: setting, what, connectsAs }] : [],
  );
const settingsFor = (up: Up, id: string) => (up.setEnv[id] ??= {});

interface Asked {
  env: string;
  nodes: Record<string, Partial<BoardNode>>;
  edges: Edge[];
  queues: Record<string, unknown>;
}
/** Records what was asked for as a run, the way a Run from the canvas is, and returns its id. */
function recordRun(stack: Registry, asked: Asked, label: string): string {
  const id = Date.now().toString(36) + Math.random().toString(36).slice(2, 8);
  const nodes = Object.entries(asked.nodes).map(([node, chosen]) => ({ id: node, ...chosen }));
  const data = { id, env: asked.env, mode: 'auto', nodes, edges: asked.edges, queues: asked.queues };
  const plan = planFor({ ...data, nodes: asked.nodes });
  appendRun(runRecord({ tag: 'koppler', data: { ...data, plan } }) ?? fail(`could not start ${label}`));
  console.log(`Running ${label} on ${asked.env.toUpperCase()} (run ${id}); the canvas shows it.`);
  const said = (['starts', 'restarts', 'stops'] as const).flatMap(word =>
    plan[word].length ? [`${word} ${plan[word].map(step => nameOf(stack, step.id)).join(', ')}`] : [],
  );
  if (said.length) console.log(`It ${said.join(', ')}.`);
  return id;
}

/** `--board "<name>"`: a saved board or a preset of the stack. */
function boardNamed(stack: Registry, args: string[]): string {
  const want = flagValue(args, '--board') ?? fail('usage: koppler up --board "<board or preset name>" [--env <env>]');
  const own = (readData('state')?.['presets'] ?? []) as Partial<Asked & { name: string }>[];
  const boards = [...own, ...((stack.presets ?? []) as typeof own)];
  const board =
    boards.find(one => one.name === want) ??
    boards.find(one => one.name?.toLowerCase() === want.toLowerCase()) ??
    fail(`no board called ${want}; koppler use --boards lists them`);
  const asked = {
    env: envOf(stack, args),
    nodes: board.nodes ?? {},
    edges: board.edges ?? [],
    queues: board.queues ?? {},
  };
  return recordRun(stack, asked, board.name ?? want);
}

/** Apps from the terminal or chat, added to what already runs on that environment. */
function appsNamed(stack: Registry, args: string[]): string {
  const ids = positional(args, ['--env', '--cable']);
  if (!ids.length) fail(USAGE);
  for (const id of ids) if (!stack.apps[id]) fail(`${id} is not an app in the stack`);
  for (const id of ids) {
    const outside = stack.apps[id]?.outside;
    if (outside) fail(`${nameOf(stack, id)} does not run on this Mac: ${String(outside)}`);
  }
  const env = envOf(stack, args);
  const now = live();
  const kept: Partial<Omit<Asked, 'env'>> = now?.env === env ? now : {};
  const known = kept.nodes ?? {};
  const cables = args.flatMap((arg, at): Edge[] => {
    if (args[at - 1] !== '--cable') return [];
    const [from = '', to = ''] = arg.split(':');
    if (!stack.apps[from] || !stack.apps[to])
      fail(`usage: --cable <caller>:<callee>, both apps in the stack (got ${arg})`);
    const runs = (id: string) => ids.includes(id) || !!known[id];
    if (!runs(from) || !runs(to)) fail(`${arg}: both ends must run; add them to the apps`);
    return [{ from, to }];
  });
  const nodes = { ...known, ...Object.fromEntries(ids.map(id => [id, known[id] ?? { run: 'cli' as const }])) };
  const edges = [...(kept.edges ?? []), ...cables].filter(
    (edge, at, all) => all.findIndex(other => other.from === edge.from && other.to === edge.to) === at,
  );
  const label = ids.map(id => nameOf(stack, id)).join(', ');
  return recordRun(stack, { env, nodes, edges, queues: kept.queues ?? {} }, label);
}

/** Each app's steps as the run goes, shown on its card; if the run stops on an error, the step it was on fails. */
function progressOf(board: Run | null, env: string): Up['step'] {
  const file = path.join(tempDir(), 'progress.json');
  const progress = {
    run: board?.id ?? null,
    env,
    at: new Date().toISOString(),
    apps: {} as Record<string, ProgressStep[]>,
  };
  const save = () => {
    writeJson(file, progress);
  };
  process.on('exit', code => {
    if (!code || code === 3) return;
    for (const list of Object.values(progress.apps)) {
      const open = list.find(step => step.state === 'todo');
      if (!open) continue;
      open.state = 'failed';
      open.detail = 'The run stopped here; the error is in the run log, and the agent takes over.';
    }
    if (board) save();
  });
  return (id, label, state, detail) => {
    if (!board) return;
    const list = (progress.apps[id] ??= []);
    const next = { label, state, ...(detail && { detail: detail.slice(0, 300) }) };
    const known = list.find(step => step.label === label);
    if (known) Object.assign(known, next);
    else list.push(next);
    save();
  };
}

function announce(up: Up): void {
  const { stack, env, board, node, step } = up;
  for (const id of up.ids) {
    const app = stack.apps[id];
    const branch = node(id).branch;
    if (branch) step(id, 'Branch', 'todo', `Switch to ${branch}`);
    if (node(id).tunnels !== false && tunnelsOf(stack, id, env).length) step(id, 'Tunnels', 'todo');
    if (Object.keys(board?.queues ?? {}).some(queue => app?.publishes?.[queue] || app?.reads?.[queue]))
      step(id, 'Local queue', 'todo');
    const ide = node(id).run === 'ide';
    step(id, 'Start', ide ? 'user' : 'todo', ide ? 'Start it in your IDE.' : null);
  }
}

/** What the plan stops or restarts goes first; its own code changes stay for the agent to revert. */
async function stopFirst(up: Up, board: Run): Promise<void> {
  let actions: Action[];
  try {
    actions = readActions(up.logFile);
  } catch (error) {
    fail((error as Error).message);
  }
  const { stops = [], restarts = [] } = board.plan ?? {};
  for (const { id } of [...stops, ...restarts]) {
    const record = readRecord(id);
    if (record && alive(record)) console.log(await stopOne(record));
    const leaves = stops.some(step => step.id === id);
    if (leaves && actions.some(action => action.app === id && action.kind !== 'process'))
      up.left.push(`revert ${nameOf(up.stack, id)}'s changes (it left the board)`);
  }
}

/** Branches as the board asks, uncommitted changes as chosen on the card. */
function switchBranches(up: Up): void {
  for (const id of up.ids) {
    const { branch, changes } = up.node(id);
    const repo = up.clones[id]?.path;
    if (!branch || !repo) continue;
    const switched = switchTo({ app: id, repo, to: branch, how: (changes ?? null) as Carry, logFile: up.logFile });
    if (switched.error === undefined) {
      console.log(switched.message);
      up.step(id, 'Branch', 'done', switched.message);
      continue;
    }
    up.left.push(switched.error);
    up.skip.add(id);
    up.step(id, 'Branch', 'failed', switched.error);
    up.step(id, 'Start', 'failed', 'Not started: its branch could not be switched.');
  }
}

/** Local libraries the board asks for, linked before the app starts. */
function linkLibraries(up: Up): void {
  for (const id of up.ids) {
    const asked = up.node(id).libraries ?? [];
    if (up.skip.has(id) || !asked.length) continue;
    const clone = up.clones[id];
    const wanted = (clone?.libraries ?? []).filter(library => asked.includes(library.name));
    const names = wanted.map(library => library.name).join(', ');
    try {
      if (!clone) throw new Error('it is not cloned');
      link(id, clone.path, wanted, up.logFile);
      console.log(`${id}: local ${names}`);
      up.step(id, 'Libraries', 'done', `Local ${names}`);
    } catch (error) {
      const { message } = error as Error;
      up.left.push(`${nameOf(up.stack, id)}: ${message}`);
      up.step(id, 'Libraries', 'failed', message);
    }
  }
}

/** Remembered changes that match this board. */
function applyRemembered(up: Up): void {
  const { stack, ids, env, edges, left } = up;
  // A code change the stack remembers is the stack's own doing: applied only once the user allowed it.
  const allowed = approved(stack.source ?? '', stack);
  const shared = ids.filter(id => stack.apps[id]?.localChanges?.length);
  if (!allowed && shared.length)
    left.push(
      `${shared.map(id => nameOf(stack, id)).join(', ')}: the stack's code changes were not applied; the user has to allow them first, in their own terminal: ${APPROVE}`,
    );
  const withoutShared = Object.fromEntries(
    Object.entries(stack.apps).map(([id, app]) => [id, { ...app, localChanges: [] }]),
  );
  const applied = prepare({
    registry: allowed ? stack : { ...stack, apps: withoutShared },
    apps: ids.filter(id => !up.skip.has(id)),
    env,
    calls: Object.fromEntries(ids.map(id => [id, edges.filter(edge => edge.from === id).map(edge => edge.to)])),
    repoOf: id => up.clones[id]?.path,
    logFile: up.logFile,
  });
  for (const { app, state, why, detail } of applied) {
    const change = `${nameOf(stack, app)}: remembered change "${String(why)}"`;
    if (state === 'applied') {
      console.log(`${app}: remembered change applied (${String(why)})`);
      up.step(app, 'Remembered change', 'done', why);
    }
    if (state === 'moved' || state === 'missing') left.push(`${change} no longer fits (${String(detail)})`);
    if (state === 'refused') left.push(`${change} was refused: ${String(detail)}. Check it in stack.json`);
  }
}

/**
 * Whether the caller's code already points at that address: a change the agent logged for it holds the address, or the
 * file the stack names does.
 */
// ponytail: the address is looked for as text, so port 5001 also matches 50010; compare whole addresses if that bites
function pointsAt(up: Up, app: string, address: string, file: string | undefined): boolean {
  const has = (text: string | string[] | undefined) => [text ?? []].flat().some(part => part.includes(address));
  const logged = readActions(up.logFile).some(
    action =>
      action.app === app &&
      ((action.kind === 'edit' && has(action.after)) || (action.kind === 'env-file' && has(action.lines))),
  );
  const repo = up.clones[app]?.path;
  if (logged || !repo || !file) return logged;
  try {
    return has(fs.readFileSync(path.join(repo, file), 'utf8'));
  } catch {
    return false;
  }
}

/** Each cable: the caller gets its local callee's address at start, or a remembered change already points it there. */
function wireCables(up: Up): void {
  const { stack, env, left } = up;
  for (const { from, to } of up.edges) {
    const wired = wireInfo(stack, up.clones, from, to, env, up.node(from).platform);
    const viaRecipe = recipesFor(stack, from).some(
      recipe => recipe.when?.calls === to && matches(recipe, { env, calls: [to] }),
    );
    if (wired.error !== undefined) {
      if (!viaRecipe) left.push(wired.error);
      continue;
    }
    if (wired.how === 'env' && !kindOf(stack.apps[from]).platforms)
      for (const name of [wired.call.env ?? []].flat()) settingsFor(up, from)[name] = wired.value;
    else if (!viaRecipe && !pointsAt(up, from, wired.value, wired.file ?? wired.call.file)) {
      const where = wired.call.file ? ` in ${wired.call.file}` : '';
      const how =
        wired.how === 'unknown' ? 'how it picks the address is not recorded yet' : `${String(wired.how)}${where}`;
      const caller = nameOf(stack, from);
      // Started now, the caller would call the deployed app and need a restart once the change is made.
      const then = running(from)
        ? `${caller} runs without it: restart it after the change`
        : up.node(from).run === 'ide'
          ? `start ${caller} in your IDE after the change`
          : `${caller} is not started until then: log the change, then run this again`;
      left.push(`${caller} -> local ${nameOf(stack, to)}: point it at ${wired.value} (${how}); ${then}`);
      up.waits.add(from);
    }
  }
}

/** Tunnels first; the board's "no tunnels" choice is kept. */
async function openTunnels(up: Up): Promise<void> {
  const { stack, ids, env, node } = up;
  const needs = ids
    .filter(id => node(id).tunnels !== false && !up.skip.has(id))
    .flatMap(id => tunnelsOf(stack, id, env));
  const appPorts = ids.map(id => Number(new URL(stack.apps[id]?.url ?? 'http://x').port)).filter(Boolean);
  for (const tunnel of planTunnels(needs, appPorts)) {
    const steps = planSteps(tunnel);
    const port = String(tunnel.port);
    // A tunnel that moved takes its apps with it: each is started with the new address, so none dials whatever holds
    // the old port.
    for (const { app, env: setting, value } of steps.settings) {
      if (node(app).run === 'ide')
        up.left.push(
          `${nameOf(stack, app)}: its ${tunnel.what} tunnel moved to port ${port}; set ${setting}=${value} where you start it`,
        );
      else settingsFor(up, app)[setting] = value;
    }
    if (running(steps.name)) {
      console.log(`${steps.name}: already open on ${port}`);
      continue;
    }
    // Something else on the port may lead to another environment's database: it is never taken for this tunnel.
    const holder = listener(tunnel.port, tunnel.bind);
    if (holder) {
      const ours = records().find(record => record.port === tunnel.port && alive(record))?.name;
      fail(
        `port ${port} is held by ${ours ?? `${holder.command ?? 'another program'} (pid ${String(holder.pid)})`}, not by ${steps.name}: it may reach another environment's ${tunnel.what.toLowerCase()}. ${ours ? `Stop it (koppler stop ${ours})` : 'Close it'}, then run again.`,
      );
    }
    if (
      steps.sudo.length &&
      !aliasReady(tunnel, hostsFile(), process.platform === 'darwin' ? sh('ifconfig', ['lo0']) : null)
    )
      fail(
        `${steps.name} needs its own local address first; in your terminal:\n  ${steps.sudo.join('\n  ')}\nthen run koppler up again`,
      );
    await run([steps.name, '--port', port, '--bind', tunnel.bind, '--restart', '--', ...steps.tunnelArgs]);
  }
  for (const id of new Set(needs.map(need => need.app))) {
    const mine = needs.filter(need => need.app === id).map(need => need.what ?? need.tunnel);
    up.step(id, 'Tunnels', 'done', `${mine.join(', ')} open`);
  }
}
const hostsFile = () => {
  try {
    return fs.readFileSync('/etc/hosts', 'utf8');
  } catch {
    return '';
  }
};

/** Why a queue could not be made, as the program that makes it said it. */
const lastLine = (error: unknown) => {
  const { stderr, message } = error as { stderr?: string; message: string };
  return (stderr || message).trim().split('\n').pop() ?? '';
};
/** The port answers before the emulator or broker is ready; it takes a few seconds. */
async function created(queue: localQueue.LocalQueue, left: string[]): Promise<string | undefined> {
  for (let attempt = 1; attempt <= 30; attempt++) {
    try {
      return queue.type === 'kafka'
        ? `${localQueue.KAFKA}/${localQueue.createTopic(queue.queue)}`
        : localQueue.createQueue(queue.queue);
    } catch (error) {
      if (attempt === 30) left.push(`${queue.name}: the local queue could not be created (${lastLine(error)})`);
      else await sleep(1000);
    }
  }
  return undefined;
}

/** Queues switched to local: the emulator, each queue in it, and every app on one started with its local address. */
async function startQueues(up: Up, chosen: Record<string, string>): Promise<void> {
  const { stack, left } = up;
  const local = localQueue.localQueues(
    stack,
    chosen,
    // Only an app switched onto its queues is given a local one.
    up.ids.filter(id => !up.skip.has(id) && up.node(id).queues === true),
    up.env,
  );
  left.push(...local.left);
  const kafka = (queue: localQueue.LocalQueue) => queue.type === 'kafka';
  if (local.queues.some(queue => !kafka(queue)) && !running('queues'))
    await run(['queues', '--port', String(localQueue.PORT), '--', ...localQueue.EMULATOR], {
      onStop: [localQueue.STOP_EMULATOR],
    });
  if (local.queues.some(kafka) && !running('kafka'))
    await run(['kafka', '--port', String(localQueue.KAFKA_PORT), '--', ...localQueue.BROKER], {
      onStop: [localQueue.STOP_BROKER],
    });
  const urls: Record<string, string> = {};
  for (const queue of local.queues) {
    const url = await created(queue, left);
    if (!url) continue;
    urls[queue.id] = url;
    console.log(`queues: ${queue.name} is local at ${url}`);
  }
  const settings = localQueue.queueEnv(
    stack,
    local.queues.filter(queue => urls[queue.id]),
    urls,
  );
  left.push(...settings.left);
  for (const [id, set] of Object.entries(settings.set)) Object.assign(settingsFor(up, id), set);
  for (const queue of local.queues)
    for (const { id } of queue.apps) {
      const pointed = !!settings.set[id];
      if (urls[queue.id])
        up.step(
          id,
          'Local queue',
          pointed ? 'done' : 'failed',
          `${queue.name}: ${pointed ? 'local' : 'point it there yourself'}`,
        );
      else up.step(id, 'Local queue', 'failed', `${queue.name} could not be created`);
    }
}

/** Apps the others call start first, so a caller finds its callee answering; a loop just starts in board order. */
async function startApps(up: Up): Promise<void> {
  const { ids, env, edges, node, step } = up;
  const order: string[] = [];
  const seen = new Set<string>();
  const visit = (id: string) => {
    if (seen.has(id)) return;
    seen.add(id);
    for (const edge of edges) if (edge.from === id) visit(edge.to);
    order.push(id);
  };
  ids.forEach(visit);
  const yours: string[] = [];
  for (const id of order) {
    if (up.skip.has(id)) continue;
    const { run: runIn, platform } = node(id);
    if (runIn === 'ide') yours.push(nameOf(up.stack, id));
    else if (running(id)) {
      console.log(`${id}: already running`);
      step(id, 'Start', 'done', 'Already running.');
    } else if (up.waits.has(id))
      step(id, 'Start', 'todo', 'Waits for a change in its code that points it at a local app.');
    else {
      const setEnv = up.setEnv[id];
      await run([id, '--env', env, ...(platform ? ['--device', platform] : [])], setEnv ? { setEnv } : {});
      step(id, 'Start', 'done', 'Running.');
    }
  }
  if (yours.length) console.log(`Start ${yours.join(', ')} in your IDE.`);
}

/** Carries a run out. Without a confirmed Send (`board`), only tunnels and apps start, and nothing is recorded. */
async function carryOut(stack: Registry, args: string[]): Promise<void> {
  const runId = flagValue(args, '--run');
  const all = runs();
  const board = runId ? (all.find(one => one.id === runId) ?? fail(`no run ${runId} in the history`)) : null;
  const env = board?.env ?? flagValue(args, '--env') ?? stack.envs[0] ?? '';
  const latest = board ?? all.findLast(one => one.kind === 'run' && one.env === env);
  const ids = board
    ? Object.keys(board.nodes).filter(id => stack.apps[id])
    : args.filter((arg, at) => !arg.startsWith('--') && !['--env', '--run'].includes(args[at - 1] ?? ''));
  if (!ids.length && !board) fail('usage: koppler up <app...> [--env <env>] | koppler up --run <id>');
  for (const id of ids) if (!stack.apps[id]) fail(`${id} is not an app in the stack`);
  // An app with no tunnels of its own on this environment never gets the first environment's: that would reach the
  // wrong database. Checked before anything starts, like every other refusal.
  const wantsTunnels = (id: string) => (board?.nodes[id] as { tunnels?: boolean } | undefined)?.tunnels !== false;
  const noTunnel = missingTunnels(stack, env).filter(id => ids.includes(id) && wantsTunnels(id));
  if (noTunnel.length)
    fail(
      `${noTunnel.map(id => nameOf(stack, id)).join(', ')}: the stack has no ${env.toUpperCase()} tunnel, and another environment's is never used. Set it with koppler stack set apps.<id>.envs.${env}.prereqs, or turn Tunnels off on the card.`,
    );
  // Checked before anything starts: a run never gets half-way and then stops at a command that needs the user's yes.
  const waiting = ids.filter(id => startsFromStack(stack, id, env));
  if (waiting.length && !approved(stack.source ?? '', stack))
    fail(
      `${waiting.map(id => nameOf(stack, id)).join(', ')}: started by a command from the stack that the user has not allowed yet, or that changed since. They review it in their own terminal: ${APPROVE}`,
    );
  // An app started on a sign-in that has expired crashes with an error of its own: said here instead, before
  // anything starts. A sign-in of the stack's own is checked by its command, which the user must have allowed.
  const signIns = new Map<string, { signIn: SignIn; apps: string[] }>();
  for (const id of ids)
    for (const need of prereqsOf(stack, id, env)) {
      const signIn = signInOf(stack, need);
      if (signIn)
        signIns.set(signIn.id, { signIn, apps: [...(signIns.get(signIn.id)?.apps ?? []), nameOf(stack, id)] });
    }
  const mayRun = approved(stack.source ?? '', stack);
  const own = [...signIns.values()].filter(({ signIn }) => 'shell' in signIn.check);
  if (own.length && !mayRun)
    fail(
      `${own.flatMap(one => one.apps).join(', ')}: the sign-in is checked by a command from the stack that the user has not allowed yet, or that changed since. They review it in their own terminal: ${APPROVE}`,
    );
  const holds = ({ check, account }: SignIn) =>
    isDone('shell' in check ? { shell: check.shell } : { sso: check.argv.at(-1) ?? '', ...(account && { account }) }, {
      approved: mayRun,
    });
  const expired = [...signIns.values()].filter(({ signIn }) => holds(signIn) === false);
  if (expired.length) {
    const apps = [...new Set(expired.flatMap(one => one.apps))];
    fail(
      `Sign in first: ${apps.join(', ')} ${apps.length === 1 ? 'needs' : 'need'} ${expired.map(one => one.signIn.what).join(' and ')} at start, and the sign-in has expired${expired.some(one => one.signIn.account) ? ' or is on another account' : ''}. In your own terminal:\n${expired.map(one => `  ${one.signIn.login}`).join('\n')}\nthen run again`,
    );
  }
  // What a sign-in of the stack's gives its apps is passed to them at start.
  const given = Object.fromEntries(
    ids.map(id => [
      id,
      Object.assign(
        {},
        ...prereqsOf(stack, id, env).map(need => (need.signIn ? signInOf(stack, need)?.env : {})),
      ) as Record<string, string>,
    ]),
  );
  const up: Up = {
    stack,
    clones: readClones(),
    env,
    ids,
    board,
    node: id => latest?.nodes[id] ?? {},
    edges: (latest?.edges ?? []).filter(edge => ids.includes(edge.from) && ids.includes(edge.to)),
    left: [],
    skip: new Set(),
    waits: new Set(),
    setEnv: Object.fromEntries(Object.entries(given).filter(([, env]) => Object.keys(env).length)),
    logFile: path.join(tempDir(), 'actions.json'),
    step: progressOf(board, env),
  };
  announce(up);
  if (board) {
    await stopFirst(up, board);
    switchBranches(up);
    linkLibraries(up);
    applyRemembered(up);
    wireCables(up);
  }
  await openTunnels(up);
  if (board?.queues) await startQueues(up, board.queues);
  await startApps(up);
  // What runs now is this board, even while something is left for the agent: the canvas shows it running straight away.
  if (board) {
    const { nodes, edges } = runningPart(board);
    const now = {
      id: board.id,
      at: new Date().toISOString(),
      env,
      nodes,
      edges,
      ...(board.queues && { queues: board.queues }),
    };
    writeJson(path.join(tempDir(), 'live.json'), now);
  }
  if (up.left.length) {
    console.log(`\nLeft for the agent:\n${up.left.map(line => `  - ${line}`).join('\n')}`);
    throw new Failure('', 3);
  }
  console.log(`Up on ${env.toUpperCase()}.`);
  if (board) await appliedCommand([board.id]);
}

export async function up(args: string[]): Promise<void> {
  const stack = readStack() ?? fail('no stack loaded (koppler init)');
  if (args.includes('--board')) await carryOut(stack, ['--run', boardNamed(stack, args)]);
  else if (args.includes('--run')) await carryOut(stack, args);
  else await carryOut(stack, ['--run', appsNamed(stack, args)]);
}
