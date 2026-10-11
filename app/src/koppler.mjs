#!/usr/bin/env node
// The koppler command: starts apps, tunnels and the canvas as detached processes that outlive the agent session, stops
// and reverts them, and everything around a run. `koppler --help` lists the commands (COMMANDS, at the end).
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { execFileSync, spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { init as initStack, removeApp, stacksCommand, sync, updateClones, useCommand } from './sync.mjs';
import { discardChanges, linkStack, linkedStatus, proposeChanges, updateStack } from './linked.mjs';
import { discoverCommand } from './discover.mjs';
import { sayCommand } from './messages.mjs';
import { switchCommand } from './engine/branch.ts';
import { down } from './engine/down.ts';
import { readActions } from './engine/actions.ts';
import { appStart, secretTest } from './engine/app-start.ts';
import { wire, wireInfo } from './engine/wire.ts';
import { recipesCommand } from './recipes.mjs';
import { queryCommand } from './query.mjs';
import { findCommand } from './research.mjs';
import { investigate } from './investigate.mjs';
import { deployed } from './deployed.mjs';
import { appliedCommand as applied, historyCommand, planCommand, runningNames, appendRun, runRecord, runs as runHistory } from './engine/runs.ts';
import * as tunnelPlan from './core/ports.ts';
import * as kinds from './core/kinds.ts';
import { needs as needsFor } from './needs.mjs';
import { APPROVE, approved, missingTunnels, startsFromStack } from './engine/checks.ts';
import { APP, BIN, LOGS, TEMP } from './paths.ts';
import { confirm, fail, flagValue, positional, table } from './cli/output.ts';
import { alive, listener, NAME, parseRun, readRecord, records, sh, sleep, startProcess, stopOne, uptime } from './engine/processes.ts';
import { redact, scrub } from './scrub.ts';
import * as kp from './core/plan.ts';
import { readData } from './data.ts';

// A first-time setup ends with the full picture: ports, conflicts and calls of every app.
// With --pick, or on a stack that has no apps yet, init ends on the canvas, where the user ticks the clones that belong to the stack.
const init = async args => {
  // A new, empty stack: a name and its deployed environments; its apps are picked next.
  const named = flagValue(args, '--new');
  if (args.includes('--new')) {
    const { createStack } = await import('./sync.mjs');
    const r = createStack({ name: named ?? '', envs: flagValue(args, '--envs') ?? '' });
    if (r.error) fail(r.error);
    console.log(`Created ${named} in ${r.stack}; it is the stack in use.`);
    args = args.filter((a, i) => !['--new', '--envs'].includes(a) && !['--new', '--envs'].includes(args[i - 1])).concat('--pick');
  }
  const pick = args.includes('--pick');
  const offline = args.includes('--no-fetch');
  initStack(args.filter(a => a !== '--pick' && a !== '--no-fetch')); console.log('');
  if (!offline) { await updateClones(); console.log(''); }
  investigate([], { afterSync: true });
  const registry = readData('registry');
  if (!registry || !(pick || (!Object.keys(registry.apps).length && process.stdout.isTTY))) return;
  if (registry.setup && !pick && !process.stdout.isTTY) return;
  console.log(registry.setup ? '\nName your stack and choose its apps on the canvas.' : `\nChoose which of your repos Koppler should run in ${registry.name ?? 'this stack'} on the canvas.`);
  await canvas(['--pick']);
};
const here = path.dirname(fileURLToPath(import.meta.url));


async function run(args, extra = {}) {
  let opts;
  try { opts = { ...parseRun(args), ...extra }; } catch (e) { fail(`${e.message}\nusage: koppler run <app> | koppler run <name> [--cwd <dir>] [--port <n>] [--bind <address>] [--restart] -- <command...>`); }
  // Only a stack app started by id gets its stored secrets; an arbitrary command never does.
  if (!opts.command.length) {
    const app = appStart(opts.name, opts) ?? fail(`${opts.name} is not an app in the stack; to run a command: koppler run ${opts.name} -- <command>`);
    Object.assign(opts, { cwd: app.cwd, command: app.command, port: opts.port ?? app.port, onStop: app.onStop ?? [], env: app.env, holdsSecrets: true });
    if (app.device) console.log(`device: ${app.device.name} (${app.device.platform})`);
  }
  if (opts.dryRun) {
    console.log(`would run in ${opts.cwd ?? process.cwd()}${opts.port ? `, port ${opts.port}` : ''}:\n  ${opts.command.map(a => /\s/.test(a) ? JSON.stringify(a) : a).join(' ')}`);
    for (const c of opts.onStop ?? []) console.log(`on stop: ${c.join(' ')}`);
    return;
  }
  await startProcess(opts);
}


async function stop(args) {
  // --apps: every app, API and tunnel Koppler runs, but not the canvas; code changes and branches stay as they are.
  const all = args.includes('--all'), apps = args.includes('--apps');
  const names = args.filter(a => !a.startsWith('-'));
  if (!all && !apps && !names.length) fail('usage: koppler stop <name...> | --apps | --all [--yes]');
  for (const n of names) if (!NAME.test(n)) fail(`${n} is not a name Koppler gives its processes`);
  const targets = all ? records() : apps ? records().filter(r => r.name !== 'canvas') : names.map(n => readRecord(n) ?? fail(`${n} is not started by koppler`));
  if (!targets.length) return console.log('nothing to stop');
  if ((all || apps) && !await confirm(`Stop ${targets.map(r => r.name).join(', ')}?`, args)) fail('nothing stopped (in a script, add --yes)');
  for (const line of await Promise.all(targets.map(stopOne))) console.log(line);
}


// What a bug report needs, ready to paste into a public issue: versions, then the tails of the canvas debug log, the
// latest run log and each named log, all scrubbed of secrets and of everything that names the user or their stack.
async function debugReport(names) {
  const { stacksHere } = await import('./sync.mjs');
  const registries = [readData('registry'), readData('state'), ...stacksHere().map(s => { try { return JSON.parse(fs.readFileSync(path.join(s.dir, 'stack.json'), 'utf8')); } catch { return null; } })];
  const tailOf = (file, n) => { try { return fs.readFileSync(file, 'utf8').trimEnd().split('\n').slice(-n).join('\n'); } catch { return null; } };
  const newest = dir => { try { return fs.readdirSync(dir).filter(f => /^up-.*\.log$/.test(f)).map(f => path.join(dir, f)).sort((a, b) => fs.statSync(b).mtimeMs - fs.statSync(a).mtimeMs)[0]; } catch { return null; } };
  const commit = (() => { try { return execFileSync('git', ['-C', here, 'rev-parse', '--short', 'HEAD'], { encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] }).trim(); } catch { return null; } })();
  const parts = [`Koppler ${commit ?? 'installed copy'}, Node ${process.version}, ${os.type()} ${os.release()}`];
  const add = (title, text) => text && parts.push(`## ${title}\n\n\`\`\`text\n${text}\n\`\`\``);
  // A board's name says nothing about a bug and may name a project, even one no stack lists any more.
  const unnamed = line => { try { const o = JSON.parse(line); if (o.board?.name) o.board.name = 'board'; return JSON.stringify(o); } catch { return line; } };
  add('Canvas debug log', tailOf(path.join(TEMP, 'debug.jsonl'), 40)?.split('\n').map(unnamed).join('\n'));
  const run = newest(TEMP);
  add(`Latest run (${run ? path.basename(run) : ''})`, run && tailOf(run, 60));
  for (const n of names) add(`${n} log`, NAME.test(n) ? tailOf(path.join(LOGS, `${n}.log`), 80) ?? 'no log' : 'not a log name');
  console.log(scrub(parts.join('\n\n'), registries));
}


// The tunnels a set of apps needs, with shared, moved and loopback-aliased ones worked out (default: the apps on the canvas).
function ports(args) {
  const registry = readData('registry') ?? fail('no stack loaded (koppler init)');
  const json = args.includes('--json'), envAt = args.indexOf('--env');
  const env = envAt >= 0 ? args[envAt + 1] : registry.envs[0];
  if (!registry.envs.includes(env)) fail(`unknown env ${env}; the stack has ${registry.envs.join(', ')}`);
  let ids = args.filter((a, i) => !a.startsWith('--') && (envAt < 0 || i !== envAt + 1));
  if (!ids.length) ids = Object.keys(readData('state')?.nodes ?? {});
  for (const id of ids) if (!registry.apps[id]) fail(`${id} is not an app in the stack`);
  for (const id of ids) if (registry.apps[id].outside) fail(`${registry.apps[id].name ?? id} does not run on this Mac: ${registry.apps[id].outside}`);
  // An app with no tunnels for this environment never gets the first environment's: that would reach the wrong database.
  const noTunnel = missingTunnels(registry, env).filter(id => ids.includes(id));
  if (noTunnel.length) fail(`${noTunnel.map(id => registry.apps[id].name).join(', ')}: the stack has no ${env.toUpperCase()} tunnel. Add it to stack.json (apps.<id>.envs.${env}.prereqs) before running on ${env.toUpperCase()}; never use another environment's.`);
  const prereqsOf = id => { const a = registry.apps[id]; return env !== registry.envs[0] && a.envs?.[env]?.prereqs ? a.envs[env].prereqs : a.prereqs ?? []; };
  const entries = ids.flatMap(id => prereqsOf(id).filter(p => p.tunnel && p.port).map(p => ({ app: id, tunnel: p.tunnel, port: p.port, env: p.env, what: p.what, connectsAs: p.connectsAs })));
  const appPorts = ids.map(id => Number(new URL(registry.apps[id].url ?? 'http://x').port)).filter(Boolean);
  const plan = tunnelPlan.planTunnels(entries, appPorts).map(t => ({ ...t, steps: tunnelPlan.planSteps(t) }));
  if (json) return console.log(JSON.stringify(plan, null, 2));
  if (!plan.length) return console.log(`no tunnels needed for ${ids.join(', ') || 'these apps'}`);
  const name = id => registry.apps[id].name;
  for (const line of tunnelPlan.describePlan(plan, name)) console.log(line);
  for (const t of plan) {
    console.log(`\n${t.host} -> ${t.bind}:${t.port}  (for ${t.apps.map(name).join(', ')})`);
    for (const c of t.steps.sudo) console.log(`  you run: ${c}`);
    for (const c of t.steps.undo) console.log(`  undo:    ${c}`);
    console.log(`  tunnel:  koppler run ${t.steps.name} --port ${t.port}${t.needsAlias ? ` --bind ${t.bind}` : ''} --restart -- ${t.steps.tunnel}`);
    for (const s of t.steps.settings) console.log(`  setting: ${s.env}=${s.value} in ${name(s.app)}'s -LOCAL profile`);
  }
}

// Everything a run needs, started in one go: its tunnels, then its apps with the ones called first, each waited for.
// With --run <id> it carries out that confirmed Send: stops and restarts, branches as chosen on the cards, remembered changes,
// each cable's local address passed to its caller, then starts. What it cannot do alone is listed for the agent (exit 3).
// Records a board as a run, with its plan against what runs now, as a Run from the canvas would; returns its id.
async function recordRun(registry, board, label) {
  const { planFor } = await import('./engine/runs.ts');
  const id = Date.now().toString(36) + Math.random().toString(36).slice(2, 8);
  const data = { id, env: board.env, mode: 'auto', nodes: Object.entries(board.nodes).map(([node, n]) => ({ id: node, ...n })), edges: board.edges, queues: board.queues };
  const plan = planFor({ ...data, nodes: board.nodes });
  const record = runRecord({ tag: 'koppler', data: { ...data, plan } }) ?? fail(`could not start ${label}`);
  appendRun(record);
  const list = (word, xs) => xs.length ? `${word} ${xs.map(x => registry.apps[x.id]?.name ?? x.id).join(', ')}` : null;
  console.log(`Running ${label} on ${board.env.toUpperCase()} (run ${id}); the canvas shows it.`);
  const said = [list('starts', plan.starts), list('restarts', plan.restarts), list('stops', plan.stops)].filter(Boolean);
  if (said.length) console.log(`It ${said.join(', ')}.`);
  return id;
}

async function up(args) {
  const registry = readData('registry') ?? fail('no stack loaded (koppler init)');
  // Every run is recorded like a Run from the canvas, so the canvas, the history and Stop all know it: a saved board
  // (--board), or apps from the terminal or chat, added to what already runs on that environment.
  if (args.includes('--board')) {
    const want = flagValue(args, '--board') ?? fail('usage: koppler up --board "<board or preset name>" [--env <env>]');
    const boards = [...(readData('state')?.presets ?? []), ...(registry.presets ?? [])];
    const b = boards.find(p => p.name === want) ?? boards.find(p => p.name?.toLowerCase() === want.toLowerCase()) ?? fail(`no board called ${want}; koppler use --boards lists them`);
    return up(['--run', await recordRun(registry, { env: envOf(registry, args), nodes: b.nodes ?? {}, edges: b.edges ?? [], queues: b.queues ?? {} }, b.name)]);
  }
  if (!args.includes('--run')) {
    const ids = positional(args, ['--env', '--cable']);
    if (!ids.length) fail('usage: koppler up <app...> [--cable <caller>:<callee>]... [--env <env>] | --board "<name>" | --run <id>');
    for (const id of ids) if (!registry.apps[id]) fail(`${id} is not an app in the stack`);
    for (const id of ids) if (registry.apps[id].outside) fail(`${registry.apps[id].name ?? id} does not run on this Mac: ${registry.apps[id].outside}`);
    const env = envOf(registry, args), { live } = await import('./engine/runs.ts'), now = live();
    const kept = now?.env === env ? now : { nodes: {}, edges: [], queues: {} };
    const cables = args.flatMap((a, i) => args[i - 1] === '--cable' ? [a] : []).map(c => {
      const [from, to] = c.split(':');
      if (!registry.apps[from] || !registry.apps[to]) fail(`usage: --cable <caller>:<callee>, both apps in the stack (got ${c})`);
      if (!ids.includes(from) && !kept.nodes[from] || !ids.includes(to) && !kept.nodes[to]) fail(`${c}: both ends must run; add them to the apps`);
      return { from, to };
    });
    const nodes = { ...kept.nodes, ...Object.fromEntries(ids.map(id => [id, kept.nodes[id] ?? { run: 'cli' }])) };
    const edges = [...(kept.edges ?? []), ...cables].filter((e, i, all) => all.findIndex(x => x.from === e.from && x.to === e.to) === i);
    return up(['--run', await recordRun(registry, { env, nodes, edges, queues: kept.queues ?? {} }, ids.map(id => registry.apps[id].name).join(', '))]);
  }
  const local = readData('local')?.apps ?? {};
  const flag = n => { const i = args.indexOf(`--${n}`); return i >= 0 ? args[i + 1] : undefined; };
  const runId = flag('run'), all = [...runHistory()];
  const board = runId ? all.find(r => r.id === runId) ?? fail(`no run ${runId} in the history`) : null;
  const env = board?.env ?? flag('env') ?? registry.envs[0];
  const latest = board ?? all.reverse().find(r => r.kind === 'run' && r.env === env) ?? null;
  const ids = board ? Object.keys(board.nodes).filter(id => registry.apps[id]) : args.filter((a, i) => !a.startsWith('--') && !['--env', '--run'].includes(args[i - 1]));
  if (!ids.length && !board) fail('usage: koppler up <app...> [--env <env>] | koppler up --run <id>');
  for (const id of ids) if (!registry.apps[id]) fail(`${id} is not an app in the stack`);
  // Checked before anything starts: a run never gets half-way and then stops at a command that needs the user's yes.
  const waiting = ids.filter(id => startsFromStack(registry, id, env));
  if (waiting.length && !approved(registry.source ?? '', registry)) fail(`${waiting.map(id => registry.apps[id].name ?? id).join(', ')}: started by a command from the stack that the user has not allowed yet, or that changed since. They review it in their own terminal: ${APPROVE}`);
  const node = id => latest?.nodes?.[id] ?? {}, edges = (latest?.edges ?? []).filter(e => ids.includes(e.from) && ids.includes(e.to));
  const running = name => { const r = readRecord(name); return r && alive(r); };
  // Each app's steps as the run goes, shown on its card (temp/progress.json); if the run stops on an error, the step it was on fails.
  const progressFile = path.join(TEMP, 'progress.json'), progress = { run: board?.id ?? null, env, at: new Date().toISOString(), apps: {} };
  const step = (id, label, state, detail) => {
    if (!board) return;
    const list = progress.apps[id] ||= [], s = list.find(x => x.label === label), next = { label, state, ...(detail && { detail: String(detail).slice(0, 300) }) };
    if (s) Object.assign(s, next); else list.push(next);
    fs.writeFileSync(progressFile, JSON.stringify(progress) + '\n', { mode: 0o600 });
  };
  process.on('exit', code => { if (!code || code === 3) return; for (const list of Object.values(progress.apps)) { const s = list.find(x => x.state === 'todo'); if (s) { s.state = 'failed'; s.detail = 'The run stopped here; the error is in the run log, and the agent takes over.'; } } if (board) fs.writeFileSync(progressFile, JSON.stringify(progress) + '\n', { mode: 0o600 }); });
  const prereqsFor = id => { const a = registry.apps[id]; return env !== registry.envs[0] && a.envs?.[env]?.prereqs ? a.envs[env].prereqs : a.prereqs ?? []; };
  for (const id of ids) {
    if (node(id).branch) step(id, 'Branch', 'todo', `Switch to ${node(id).branch}`);
    if (node(id).tunnels !== false && prereqsFor(id).some(p => p.tunnel && p.port)) step(id, 'Tunnels', 'todo');
    if (Object.keys(board?.queues ?? {}).some(q => registry.apps[id][`publishes`]?.[q] || registry.apps[id].reads?.[q])) step(id, 'Local queue', 'todo');
    step(id, 'Start', node(id).run === 'ide' ? 'user' : 'todo', node(id).run === 'ide' ? 'Start it in your IDE.' : null);
  }
  const left = [], skip = new Set(), setEnv = {}, logFile = path.join(TEMP, 'actions.json');
  if (board) {
    // What the plan stops or restarts goes first; its own code changes stay for the agent to revert.
    let actions; try { actions = readActions(logFile); } catch (e) { fail(e.message); }
    for (const { id } of [...(board.plan?.stops ?? []), ...(board.plan?.restarts ?? [])]) {
      const rec = readRecord(id); if (rec && alive(rec)) console.log(await stopOne(rec));
      if ((board.plan?.stops ?? []).some(x => x.id === id) && actions.some(a => a.app === id && a.kind !== 'process')) left.push(`revert ${registry.apps[id]?.name ?? id}'s changes (it left the board)`);
    }
    // Branches as the board asks, uncommitted changes as chosen on the card.
    const { switchTo } = await import('./engine/branch.ts');
    for (const id of ids) {
      const want = node(id).branch, repo = local[id]?.path;
      if (!want || !repo) continue;
      const r = switchTo({ app: id, repo, to: want, how: node(id).changes ?? null, logFile });
      if (r.error) { left.push(r.error); skip.add(id); step(id, 'Branch', 'failed', r.error); step(id, 'Start', 'failed', 'Not started: its branch could not be switched.'); } else { console.log(r.message); step(id, 'Branch', 'done', r.message); }
    }
    // Local libraries the board asks for, linked before the app starts.
    const libs = await import('./engine/libraries.ts');
    for (const id of ids.filter(id => !skip.has(id) && node(id).libraries?.length)) {
      const wanted = (local[id]?.libraries ?? []).filter(l => node(id).libraries.includes(l.name));
      try { libs.link(id, local[id].path, wanted, logFile); console.log(`${id}: local ${wanted.map(l => l.name).join(', ')}`); step(id, 'Libraries', 'done', `Local ${wanted.map(l => l.name).join(', ')}`); }
      catch (e) { left.push(`${registry.apps[id].name}: ${e.message}`); step(id, 'Libraries', 'failed', e.message); }
    }
    // Remembered changes that match this board.
    const { prepare: applyRemembered, recipesFor, matches } = await import('./recipes.mjs');
    // A code change the stack remembers is the stack's own doing: applied only once the user allowed it.
    const allowed = approved(registry.source ?? '', registry);
    const sharedChanges = ids.filter(id => registry.apps[id].localChanges?.length);
    if (!allowed && sharedChanges.length) left.push(`${sharedChanges.map(id => registry.apps[id].name).join(', ')}: the stack's code changes were not applied; the user has to allow them first, in their own terminal: ${APPROVE}`);
    const prepare = args => allowed ? applyRemembered(args) : applyRemembered({ ...args, registry: { ...registry, apps: Object.fromEntries(Object.entries(registry.apps).map(([id, a]) => [id, { ...a, localChanges: [] }])) } });
    const calls = Object.fromEntries(ids.map(a => [a, edges.filter(e => e.from === a).map(e => e.to)]));
    for (const r of prepare({ registry, apps: ids.filter(id => !skip.has(id)), env, calls, repoOf: a => local[a]?.path, logFile })) {
      if (r.state === 'applied') { console.log(`${r.app}: remembered change applied (${r.why})`); step(r.app, 'Remembered change', 'done', r.why); }
      if (r.state === 'moved' || r.state === 'missing') left.push(`${registry.apps[r.app].name}: remembered change "${r.why}" no longer fits (${r.detail})`);
      if (r.state === 'refused') left.push(`${registry.apps[r.app].name}: remembered change "${r.why}" was refused: ${r.detail}. Check it in stack.json`);
    }
    // Each cable: the caller gets its local callee's address at start, or a remembered change already points it there.
    for (const e of edges) {
      const info = wireInfo(registry, local, e.from, e.to, env, node(e.from).platform);
      const viaRecipe = recipesFor(registry, e.from).some(r => r.when?.calls === e.to && matches(r, { env, calls: [e.to] }));
      if (info.error) { if (!viaRecipe) left.push(info.error); continue; }
      if (info.how === 'env' && !kinds.of(registry.apps[e.from]).platforms) for (const name of [].concat(info.call.env)) (setEnv[e.from] ??= {})[name] = info.value;
      else if (!viaRecipe) left.push(`${registry.apps[e.from].name} -> local ${registry.apps[e.to].name}: point it at ${info.value} (${info.how === 'unknown' ? 'how it picks the address is not recorded yet' : `${info.how}${info.call.file ? ` in ${info.call.file}` : ''}`})`);
    }
  }
  // Tunnels first; the board's "no tunnels" choice is kept.
  const prereqsOf = id => { const a = registry.apps[id]; return env !== registry.envs[0] && a.envs?.[env]?.prereqs ? a.envs[env].prereqs : a.prereqs ?? []; };
  const entries = ids.filter(id => node(id).tunnels !== false && !skip.has(id)).flatMap(id => prereqsOf(id).filter(p => p.tunnel && p.port).map(p => ({ app: id, tunnel: p.tunnel, port: p.port, env: p.env, what: p.what, connectsAs: p.connectsAs })));
  const appPorts = ids.map(id => Number(new URL(registry.apps[id].url ?? 'http://x').port)).filter(Boolean);
  for (const t of tunnelPlan.planTunnels(entries, appPorts)) {
    const steps = tunnelPlan.planSteps(t);
    // A tunnel that moved takes its apps with it: each is started with the new address, so none dials whatever holds the old port.
    for (const s of steps.settings) {
      if (node(s.app).run === 'ide') left.push(`${registry.apps[s.app].name}: its ${t.what} tunnel moved to port ${t.port}; set ${[].concat(s.env).join(', ')}=${s.value} where you start it`);
      else for (const name of [].concat(s.env)) (setEnv[s.app] ??= {})[name] = s.value;
    }
    if (running(steps.name) || listener(t.port, t.bind)) { console.log(`${steps.name}: already open on ${t.port}`); continue; }
    const hosts = (() => { try { return fs.readFileSync('/etc/hosts', 'utf8'); } catch { return ''; } })();
    if (steps.sudo.length && !tunnelPlan.aliasReady(t, hosts, process.platform === 'darwin' ? sh('ifconfig', ['lo0']) : null)) fail(`${steps.name} needs its own local address first; in your terminal:\n  ${steps.sudo.join('\n  ')}\nthen run koppler up again`);
    await run([steps.name, '--port', String(t.port), '--bind', t.bind, '--restart', '--', ...steps.tunnelArgs]);
  }
  for (const id of new Set(entries.map(e => e.app))) step(id, 'Tunnels', 'done', `${entries.filter(e => e.app === id).map(e => e.what ?? e.tunnel).join(', ')} open`);
  // Queues switched to local: the emulator, each queue in it, and every app on one started with its local address.
  if (board?.queues) {
    const q = await import('./engine/queues.ts');
    const lq = q.localQueues(registry, board.queues, ids.filter(id => !skip.has(id)), env), urls = {};
    left.push(...lq.left);
    if (lq.queues.some(one => one.type !== 'kafka') && !running('queues')) await run(['queues', '--port', String(q.PORT), '--', ...q.EMULATOR], { onStop: [q.STOP_EMULATOR] });
    if (lq.queues.some(one => one.type === 'kafka') && !running('kafka')) await run(['kafka', '--port', String(q.KAFKA_PORT), '--', ...q.BROKER], { onStop: [q.STOP_BROKER] });
    for (const one of lq.queues) {
      // The port answers before the emulator or broker is ready; it takes a few seconds.
      for (let i = 0; i < 30 && !urls[one.id]; i++) { try { urls[one.id] = one.type === 'kafka' ? `${q.KAFKA}/${q.createTopic(one.queue)}` : q.createQueue(one.queue); } catch (e) { if (i === 29) left.push(`${one.name}: the local queue could not be created (${String(e.stderr || e.message).trim().split('\n').pop()})`); else await new Promise(r => setTimeout(r, 1000)); } }
      if (urls[one.id]) console.log(`queues: ${one.name} is local at ${urls[one.id]}`);
    }
    const qe = q.queueEnv(registry, lq.queues.filter(one => urls[one.id]), urls);
    left.push(...qe.left);
    for (const [id, vars] of Object.entries(qe.set)) Object.assign(setEnv[id] ??= {}, vars);
    for (const one of lq.queues) for (const a of one.apps) step(a.id, 'Local queue', urls[one.id] && qe.set[a.id] ? 'done' : 'failed', urls[one.id] ? `${one.name}: ${qe.set[a.id] ? 'local' : 'point it there yourself'}` : `${one.name} could not be created`);
  }
  // Apps the others call start first, so a caller finds its callee answering; a loop just starts in board order.
  const calls = id => edges.filter(e => e.from === id).map(e => e.to), order = [], seen = new Set();
  const visit = id => { if (seen.has(id)) return; seen.add(id); calls(id).forEach(visit); order.push(id); };
  ids.forEach(visit);
  const yours = [];
  for (const id of order) {
    if (skip.has(id)) continue;
    if (node(id).run === 'ide') { yours.push(registry.apps[id].name); continue; }
    if (running(id)) { console.log(`${id}: already running`); step(id, 'Start', 'done', 'Already running.'); continue; }
    await run([id, '--env', env, ...(node(id).platform ? ['--device', node(id).platform] : [])], setEnv[id] ? { setEnv: setEnv[id] } : {});
    step(id, 'Start', 'done', 'Running.');
  }
  if (yours.length) console.log(`Start ${yours.join(', ')} in your IDE.`);
  // What runs now is this board, even while something is left for the agent: the canvas shows it running straight away.
  if (board) { const { nodes, edges } = (await import('./engine/runs.ts')).runningPart(board); fs.writeFileSync(path.join(TEMP, 'live.json'), JSON.stringify({ id: board.id, at: new Date().toISOString(), env, nodes, edges, ...(board.queues && { queues: board.queues }) }, null, 2) + '\n', { mode: 0o600 }); }
  if (left.length) { console.log(`\nLeft for the agent:\n${left.map(l => `  - ${l}`).join('\n')}`); process.exit(3); }
  console.log(`Up on ${env.toUpperCase()}.`);
  if (board) await applied([board.id]);
}

const registryOrFail = () => readData('registry') ?? fail('no stack loaded (koppler init)');
const envOf = (registry, args) => {
  const env = flagValue(args, '--env') ?? registry.envs[0];
  if (!registry.envs.includes(env)) fail(`unknown env ${env}; the stack has ${registry.envs.join(', ')}`);
  return env;
};

// Tries each stored secret the apps declare and says only whether it works; the values stay in their store.
function secretTests(registry, ids, env) {
  return ids.flatMap(id => {
    const base = registry.apps[id] ?? fail(`${id} is not an app in the stack`);
    const app = env === registry.envs[0] ? base : { ...base, ...(base.envs?.[env] ?? {}) };
    return (app.secrets ?? []).filter(s => s.env).map(s => ({ app: id, name: s.env, env, ...secretTest(env === registry.envs[0] ? id : `${id}@${env}`, s) }));
  });
}

// Can these apps run here? The tools this stack needs, then what the user still has to do for the apps, then (asked
// for) whether each stored secret works, or whether every connection of what runs now answers.
async function doctor(args) {
  if (args.includes('--flow')) return flowCheck(args);
  const json = args.includes('--json'), registry = registryOrFail(), env = envOf(registry, args);
  const ids = positional(args, ['--env', '--no-tunnels']);
  const { checkTools, report } = await import('./engine/checks.ts');
  // Approving runs commands from a shared file on this Mac: only a person at the terminal can say yes, never --yes.
  const tools = await checkTools({ approve: args.includes('--approve'), confirm: question => confirm(question) });
  if (tools.error) fail(tools.error);
  const todo = ids.length ? needsFor(args.filter(a => a !== '--secrets' && a !== '--approve'), { skill: APP, fail, collect: json }) : null;
  const secrets = args.includes('--secrets') ? secretTests(registry, ids.length ? ids : Object.keys(registry.apps), env) : [];
  if (json) return console.log(JSON.stringify({ tools: tools.results, ...(todo ?? {}), ...(args.includes('--secrets') && { secrets }) }, null, 2));
  if (!ids.length) report(tools.results);
  for (const s of secrets) console.log(`${s.app} ${s.name} (${env.toUpperCase()}): ${s.message}`);
  if (tools.results.some(r => r.state === 'missing') || secrets.some(s => s.code === 1)) process.exitCode = 1;
}

// Every connection of what runs now, tested the way the canvas's Flow check does: each app answers, each cable reaches
// its local app, each tunnel reaches its database or cache.
async function flowCheck(args) {
  const registry = registryOrFail(), { live } = await import('./engine/runs.ts'), board = live();
  if (!board || !Object.keys(board.nodes ?? {}).length) return console.log('Nothing is running, so there is nothing to test.');
  const env = board.env ?? registry.envs[0], name = id => registry.apps[id]?.name ?? id;
  const ids = Object.keys(board.nodes).filter(id => registry.apps[id]);
  const prereqsOf = id => { const a = registry.apps[id]; return env !== registry.envs[0] && a.envs?.[env]?.prereqs ? a.envs[env].prereqs : a.prereqs ?? []; };
  const entries = ids.filter(id => board.nodes[id].tunnels !== false).flatMap(id => prereqsOf(id).filter(p => p.tunnel && p.port).map(p => ({ app: id, tunnel: p.tunnel, port: p.port, env: p.env, what: p.what, connectsAs: p.connectsAs })));
  const jobs = [
    ...ids.filter(id => registry.apps[id].url).map(id => ({ label: name(id), body: { env, node: id } })),
    ...(board.edges ?? []).map(e => ({ label: `${name(e.from)} to local ${name(e.to)}`, body: { env, from: e.from, to: e.to } })),
    ...tunnelPlan.planTunnels(entries).flatMap(t => t.apps.map(id => ({ label: `${name(id)} to ${t.what ?? t.host}`, body: { env, app: id, host: t.bind, port: t.port, original: t.original } }))),
  ];
  const { cableTest } = await import('./status-watch.mjs');
  const results = [];
  for (const j of jobs) results.push({ ...j, result: await cableTest(registry, j.body) });
  if (args.includes('--json')) console.log(JSON.stringify(results.map(r => ({ connection: r.label, ok: r.result.ok, text: r.result.text, detail: r.result.detail })), null, 2));
  else for (const r of results) console.log(`${r.result.ok ? 'ok     ' : r.result.unsure ? 'unsure ' : 'FAILED '} ${r.label}: ${r.result.text}${r.result.ok ? '' : ` (${r.result.detail})`}`);
  if (results.some(r => !r.result.ok && !r.result.unsure)) process.exitCode = 1;
}

// The canvas: started when it is not running, then opened in the browser.
async function canvas(args) {
  if (args.includes('--stop')) return stop(['canvas']);
  const rec = readRecord('canvas');
  if (!rec || !alive(rec)) await run(['canvas', '--port', String(Number(process.env.KOPPLER_PORT) || 4747), '--', process.execPath, path.join(here, 'status-watch.mjs')]);
  const urlFile = path.join(TEMP, 'canvas-url');
  for (let i = 0; i < 40 && !fs.existsSync(urlFile); i++) await sleep(250);
  if (!fs.existsSync(urlFile)) fail('the canvas did not start; see koppler logs canvas');
  // The address carries the page's access token, so it goes to the browser and is not printed.
  const url = fs.readFileSync(urlFile, 'utf8').trim() + (args.includes('--pick') ? '#pick' : '');
  if (args.includes('--no-open') || process.platform !== 'darwin') return console.log(`The canvas runs on port ${new URL(url).port}; its address is in ${urlFile}`);
  sh('open', [url]);
  console.log('The canvas is open in your browser.');
}

// A log, with secrets masked as on the card; `-f` follows it.
async function logs(args) {
  const [want] = positional(args, ['-n']), lines = Number(flagValue(args, '-n')) || 50;
  if (!want) fail('usage: koppler logs <name> [-f] [-n <lines>]');
  if (!NAME.test(want)) fail(`${want} is not a name Koppler gives its processes`);
  const file = path.join(LOGS, `${want}.log`);
  if (!fs.existsSync(file)) fail(`no log for ${want}; koppler status lists what runs`);
  process.stdout.write(redact(fs.readFileSync(file, 'utf8').trimEnd().split('\n').slice(-lines).join('\n')) + '\n');
  if (!args.includes('-f') && !args.includes('--follow')) return;
  let at = fs.statSync(file).size;
  fs.watchFile(file, { interval: 500 }, cur => {
    if (cur.size < at) at = 0;
    if (cur.size === at) return;
    const fd = fs.openSync(file, 'r'), buf = Buffer.alloc(cur.size - at);
    fs.readSync(fd, buf, 0, buf.length, at); fs.closeSync(fd); at = cur.size;
    process.stdout.write(redact(buf.toString('utf8')));
  });
}

// What runs; --apps adds every app in the stack with its clone; --debug is for a bug report.
function status(args = []) {
  if (args.includes('--debug')) return debugReport(positional(args));
  const json = args.includes('--json'), recs = records();
  const procs = recs.map(r => { const up = alive(r); return { name: r.name, state: up ? 'running' : 'exited', pid: r.pid, up: up ? uptime(r.startedAt) : null, port: r.port ?? null, open: !!(r.port && up && listener(r.port, r.bind)), command: r.command }; });
  const registry = args.includes('--apps') ? registryOrFail() : null, local = readData('local')?.apps ?? {};
  const apps = registry && Object.entries(registry.apps).map(([id, app]) => ({ id, name: app.name, kind: app.kind, clone: local[id] ? { branch: local[id].branch ?? null, changed: local[id].dirty ?? 0 } : null, state: procs.find(p => p.name === id)?.state ?? null }));
  if (json) return console.log(JSON.stringify({ processes: procs, ...(apps && { stack: registry.name ?? null, apps }) }, null, 2));
  if (apps) {
    console.log(`${registry.name ?? 'stack'}: ${registry.source ?? ''}`);
    table([['APP', 'NAME', 'KIND', 'CLONE', 'KOPPLER'], ...apps.map(a => [a.id, a.name, a.kind, a.clone ? `${a.clone.branch ?? 'detached'}${a.clone.changed ? ` (${a.clone.changed} changed)` : ''}` : 'missing', a.state ?? '-'])]);
    console.log('');
  }
  if (!procs.length) return console.log('nothing started by koppler');
  table([['NAME', 'STATE', 'PID', 'UP', 'PORT', 'COMMAND'], ...procs.map(p => [p.name, p.state, p.pid, p.up ?? '-', p.port ? `${p.port} ${p.open ? 'open' : 'closed'}` : '-', p.command.length > 70 ? p.command.slice(0, 67) + '...' : p.command])]);
}

// Secrets, in the user's own terminal: the values never pass through Koppler's output.
function secret(args) {
  const [action, ...rest] = args, script = { set: 'secret-set', list: 'secret-list', psql: 'secret-psql' }[action];
  if (action === 'remove') {
    const [store, name] = rest;
    if (!store || !name) fail('usage: koppler secret remove <app>[@<env>] <NAME>');
    return process.exit(spawnSync(path.join(BIN, 'secret-store'), ['remove', store, name], { stdio: 'inherit' }).status ?? 1);
  }
  if (!script) fail('usage: koppler secret set|list|remove|psql <app>[@<env>] [<NAME>]');
  // A protected environment's value is stored so that every read asks the user (the stack says which; else all but the first).
  const registry = readData('registry'), env = String(rest[0] ?? '').split('@')[1] ?? registry?.envs?.[0];
  const mark = registry ? { KOPPLER_SECRET_PROTECTED: kp.isProtected(registry, env) ? '1' : '0' } : {};
  process.exit(spawnSync(path.join(BIN, script), rest, { stdio: 'inherit', env: { ...process.env, ...mark } }).status ?? 1);
}

// Stacks on this Mac, or switch to one; --boards lists the boards of the stack in use (the team's presets and your own).
const use = args => {
  if (args.includes('--boards')) {
    const registry = registryOrFail(), own = readData('state')?.presets ?? [];
    const boards = [...(registry.presets ?? []).map(p => ({ name: p.name, from: 'team' })), ...own.map(p => ({ name: p.name, from: 'yours' }))];
    if (args.includes('--json')) return console.log(JSON.stringify(boards, null, 2));
    if (!boards.length) return console.log('No boards yet: build one on the canvas.');
    return boards.forEach(b => console.log(`${b.name}  (${b.from === 'team' ? 'team preset' : 'your board'})`));
  }
  if (!positional(args).length) return stacksCommand(args);
  if (runningNames().some(n => n !== 'canvas')) fail('something is still running; stop and revert it first (canvas, or koppler down), then switch');
  useCommand(positional(args));
};

// A stack shared on GitHub: link it, then see its changes, bring in GitHub's, drop yours, or propose yours.
const link = async args => {
  const url = positional(args)[0];
  if (url) {
    const r = await linkStack(url); if (r.error) fail(r.error);
    console.log(`USING ${r.name}, linked from ${url}`); sync([]);
    // A linked stack is someone else's file: say so when it brings commands of its own.
    const { stackCommands } = await import('./engine/checks.ts'), own = stackCommands(readData('registry'));
    if (own.length) console.log(`\nThis stack carries ${own.length} ${own.length === 1 ? 'command or code change' : 'commands and code changes'} of its own. None runs until you have reviewed them: ${APPROVE}`);
    return;
  }
  const dir = readData('registry')?.source?.replace(/\/stack\.json$/, '') ?? fail('no stack in use');
  const st = linkedStatus(dir) ?? fail('the stack in use is not linked to GitHub; link one with: koppler link <GitHub link to a stack.json>');
  if (args.includes('--update')) { const r = await updateStack(dir); if (r.error) fail(r.error); console.log(r.message); return sync([]); }
  if (args.includes('--discard')) { discardChanges(dir); console.log('Your changes are discarded; the copy matches the shared stack again.'); return sync([]); }
  if (args.includes('--pr')) { const r = await proposeChanges(dir); if (r.error) fail(r.error); return console.log(`Pull request: ${r.url}`); }
  console.log(`Linked from ${st.url} (fetched ${st.fetchedAt})`);
  console.log(st.changes.length ? `Changes not in the shared stack yet:\n${st.changes.map(c => `  ${c}`).join('\n')}${st.pr ? `\nPull request: ${st.pr}` : ''}` : 'No changes: this copy matches the shared stack.');
};

// Everything the repos say about the stack's apps: the report (ports, tunnels, calls, conflicts, gaps), then what could
// be added to stack.json; --deployed adds the infrastructure drafts, --find looks up repos by name first.
const discover = async args => {
  const names = flagValue(args, '--find');
  if (names !== undefined) return findCommand([...names.split(/[,\s]+/).filter(Boolean), ...args.filter(a => a === '--no-github')]);
  if (!args.includes('--no-fetch')) { await updateClones(); console.log(''); }
  investigate([]);
  console.log('');
  discoverCommand(args.filter(a => a === '--apply'));
  if (args.includes('--deployed')) { console.log(''); await deployed(positional(args, ['--find'])); }
};

// What the newest Send does; with apps, the tunnels they need; with --wire, what one cable changes.
const plan = args => {
  if (args.includes('--wire')) return wire(args.filter(a => a !== '--wire'));
  return positional(args, ['--env']).length ? ports(args) : planCommand(args);
};

// A run's history; --done marks one finished, which makes its board what runs.
const history = args => {
  if (!args.includes('--done')) return historyCommand(args);
  const id = positional(args, ['--failed'])[0], reason = flagValue(args, '--failed');
  return applied([...(id ? [id] : []), ...(args.includes('--failed') ? ['--failed', reason] : [])]);
};

// Remembered code changes: list them, keep the last edit, or apply the ones that match the latest Send.
const recipes = args => {
  if (args.includes('--remember')) return recipesCommand('remember', args.filter(a => a !== '--remember'), { fail, temp: TEMP });
  if (args.includes('--apply')) return recipesCommand('prepare', args.filter(a => a !== '--apply'), { fail, temp: TEMP });
  return recipesCommand('recipes', args, { fail, temp: TEMP });
};

// Apps join the stack from their clones: a repo name or slug from `koppler sync`, or a folder.
const add = async args => {
  const wanted = positional(args);
  if (!wanted.length) fail('usage: koppler add <repo or folder>...  (koppler add --list shows the repos you can add)');
  const { addApps, candidateRepos } = await import('./sync.mjs');
  const config = JSON.parse(fs.readFileSync(path.join(process.env.KOPPLER_CONFIG_DIR || path.join(os.homedir(), '.config', 'koppler'), 'config.json'), 'utf8'));
  const index = readData('repos') ?? fail('no repos found yet: koppler init');
  const stack = JSON.parse(fs.readFileSync(path.join(config.stack, 'stack.json'), 'utf8'));
  const known = candidateRepos(index, stack, config.stack);
  const picks = wanted.map(w => known.find(c => c.slug === w || c.slug.split('/').pop() === w || c.path === path.resolve(w.replace(/^~(?=\/|$)/, os.homedir()))) ?? fail(`${w} is not one of your clones that is outside the stack; koppler sync --rescan finds new clones`));
  const r = addApps(picks.map(c => ({ slug: c.slug })));
  if (r.error) fail(r.error);
  console.log(r.added.length ? `Added ${r.added.join(', ')}; fill in how each runs with: koppler discover` : 'Nothing to add: they are in the stack already.');
  sync([]);
};

const remove = args => { const r = removeApp(positional(args)[0] ?? fail('usage: koppler remove <app>')); if (r.error) fail(r.error); console.log(`Removed ${r.name} from the stack (its clone stays).`); sync([]); };
const say = args => sayCommand(args);
const switchBranch = args => switchCommand(args, { temp: TEMP });
const query = args => queryCommand(args, { fail });
const listen = async args => (await import('./listen.mjs')).listen(args);

// Koppler's version: the package's, or the commit when it runs from a clone.
function version() {
  const pkg = (() => { try { return JSON.parse(fs.readFileSync(path.join(APP, 'package.json'), 'utf8')).version; } catch { return null; } })();
  const commit = sh('git', ['-C', here, 'rev-parse', '--short', 'HEAD']);
  return [pkg, commit && `(${commit})`].filter(Boolean).join(' ') || 'unknown';
}

// Every command: what it takes, what it does, and one example. People's commands come first in the help.
const COMMANDS = [
  { name: 'init', who: 'you', args: '[--new "<name>" --envs qa,prod] [--root <dir>]... [--stack <dir>] [--pick] [--no-fetch]', about: 'find your repos and the stack, or start a new stack', run: init, example: 'koppler init --new "Shop" --envs qa,prod' },
  { name: 'canvas', who: 'you', args: '[--stop] [--no-open]', about: 'start the canvas if needed and open it', run: canvas, example: 'koppler canvas' },
  { name: 'use', who: 'you', args: '[stack] [--boards] [--json]', about: 'list the stacks on this Mac (* is in use), switch to one, or list its boards', run: use, example: 'koppler use "Shop"' },
  { name: 'link', who: 'you', args: '<GitHub link to a stack.json> | --update | --discard | --pr', about: 'use a stack shared on GitHub; then bring in its changes, drop yours, or propose yours', run: link, example: 'koppler link https://github.com/acme/stacks/blob/main/shop/stack.json' },
  { name: 'doctor', who: 'you', args: '[app...] [--env <env>] [--secrets] [--flow] [--approve] [--json]', about: 'can it run here: tools, what you still have to do, secrets, connections', run: doctor, example: 'koppler doctor orders-api --env prod' },
  { name: 'secret', who: 'you', args: 'set|list|remove|psql <app>[@<env>] [<NAME>] [--stdin]', about: 'store and manage secrets; values never show', run: secret, example: 'koppler secret set orders-api@prod DB_URL' },
  { name: 'status', who: 'you', args: '[--apps] [--debug [name...]] [--json]', about: 'what Koppler runs; --apps adds the stack\'s apps; --debug gives scrubbed logs for a bug report', run: status, example: 'koppler status --apps' },
  { name: 'logs', who: 'you', args: '<name> [-f] [-n <lines>]', about: 'show or follow a log, secrets masked', run: logs, example: 'koppler logs orders-api -f' },
  { name: 'stop', who: 'you', args: '<name...> | --apps | --all [--yes]', about: 'stop by name; --apps every app and tunnel, --all the canvas too', run: stop, example: 'koppler stop orders-api' },
  { name: 'history', who: 'you', args: '[--json] | --done [<id>] [--failed "<why>"]', about: 'recent Sends and Stops; --done marks a run finished', run: history, example: 'koppler history' },
  { name: 'query', who: 'you', args: '<app> [--env <env>] [--secret <NAME>] "<sql>"', about: 'read-only query with the app\'s stored connection (on PROD: in your own terminal)', run: query, example: 'koppler query orders-api "select count(*) from orders"' },
  { name: 'sync', who: 'agent', args: '[--stack <dir>] [--rescan]', about: 'reload the stack and your clones', run: sync, example: 'koppler sync --rescan' },
  { name: 'discover', who: 'agent', args: '[app...] [--deployed] [--apply] [--find "<names>"] [--no-fetch]', about: 'what the repos say: ports, tunnels, calls, deployed addresses, gaps', run: discover, example: 'koppler discover --deployed' },
  { name: 'add', who: 'agent', args: '<repo or folder>...', about: 'add apps to the stack from their clones', run: add, example: 'koppler add acme/orders-api' },
  { name: 'remove', who: 'agent', args: '<app>', about: 'take an app out of the stack (its clone stays)', run: remove, example: 'koppler remove orders-api' },
  { name: 'plan', who: 'agent', args: '[app...] [--env <env>] [--wire <caller> <callee>] [--json]', about: 'what the newest Send does; the tunnels apps need; what one cable changes', run: plan, example: 'koppler plan orders-api payments-api --env qa' },
  { name: 'up', who: 'agent', args: '<app...> [--cable <caller>:<callee>]... [--env <env>] | --board "<name>" | --run <id>', about: 'start a run, recorded like Run on the canvas: tunnels, local queues, then apps, callees first', run: up, example: 'koppler up orders-api payments-api --cable orders-api:payments-api --env qa' },
  { name: 'down', who: 'agent', args: '[--run <stop id>]', about: 'stop and revert: stop what Koppler runs, undo every change, branches back', run: down, example: 'koppler down' },
  { name: 'run', who: 'agent', args: '<app> [--env <env>] [--device ios|android|phone|<id>] [--lan] [--dry-run] | <name> [--cwd <dir>] [--port <n>] [--bind <address>] [--restart] -- <command...>', about: 'start one stack app, or any command, detached and logged', run, example: 'koppler run orders-api --env qa' },
  { name: 'switch', who: 'agent', args: '<app> <branch> [--set-aside | --take-along] | <app> --back', about: 'switch a clone to the board\'s branch, and back', run: switchBranch, example: 'koppler switch orders-api feature/refunds --set-aside' },
  { name: 'recipes', who: 'agent', args: '[app] | --remember <app> --why "<why>" [--when ...] | --apply <app...>', about: 'remembered code changes: list, keep the last edit, apply the matching ones', run: recipes, example: 'koppler recipes orders-api' },
  { name: 'listen', who: 'agent', args: '--take | --as <id> | --stop', about: 'wait for Sends from the canvas (one agent session at a time)', run: listen, example: 'koppler listen --take' },
  { name: 'say', who: 'agent', args: '[--file <json>] | --answered <id>', about: 'show a question or result on the canvas', run: say, example: 'koppler say --file reply.json' },
];
const byName = Object.fromEntries(COMMANDS.map(c => [c.name, c]));

function help(cmd) {
  if (cmd) return console.log(`usage: koppler ${cmd.name} ${cmd.args}\n\n${cmd.about[0].toUpperCase()}${cmd.about.slice(1)}.\n\nExample:\n  ${cmd.example}`);
  const width = Math.max(...COMMANDS.map(c => c.name.length)) + 2;
  const section = (title, who) => [title, ...COMMANDS.filter(c => c.who === who).map(c => `  ${c.name.padEnd(width)}${c.about}`)].join('\n');
  console.log([
    'Koppler runs the part of your stack you need on this Mac, wired together; the rest keeps calling a deployed environment.',
    '', 'usage: koppler <command> [options]', '', section('For you', 'you'), '', section('For the agent', 'agent'), '',
    'koppler help <command>, or koppler <command> --help, shows its options and an example. koppler --version prints the version.',
    '', 'Environment: KOPPLER_STATE (state folder, default ~/.local/state/koppler), KOPPLER_CONFIG_DIR (default ~/.config/koppler),',
    '  KOPPLER_PORT (canvas, default 4747), KOPPLER_SECRETS (a folder for secrets instead of the Keychain).',
  ].join('\n'));
}

// The closest command to a typo, if one is close enough.
function closest(word) {
  const distance = (a, b) => { const d = Array.from({ length: a.length + 1 }, (_, i) => [i, ...Array(b.length).fill(0)]); for (let j = 1; j <= b.length; j++) d[0][j] = j; for (let i = 1; i <= a.length; i++) for (let j = 1; j <= b.length; j++) d[i][j] = Math.min(d[i - 1][j] + 1, d[i][j - 1] + 1, d[i - 1][j - 1] + (a[i - 1] === b[j - 1] ? 0 : 1)); return d[a.length][b.length]; };
  const best = COMMANDS.map(c => [c.name, distance(word, c.name)]).sort((a, b) => a[1] - b[1])[0];
  return best && best[1] <= 2 ? best[0] : COMMANDS.find(c => c.name.startsWith(word))?.name ?? null;
}

if (process.argv[1] && fs.realpathSync(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const [cmd, ...args] = process.argv.slice(2), own = args.includes('--') ? args.slice(0, args.indexOf('--')) : args;
  if (!cmd || cmd === 'help' || cmd === '--help' || cmd === '-h') {
    if (cmd === 'help' && args[0] && !byName[args[0]]) fail(`usage: no command "${args[0]}"; koppler --help lists them`);
    help(byName[args[0]]); process.exit(0);
  }
  if (cmd === '--version' || cmd === '-V' || cmd === 'version') { console.log(`koppler ${version()}`); process.exit(0); }
  if (!byName[cmd]) {
    const near = closest(cmd);
    console.error(`koppler: unknown command "${cmd}".${near ? ` Did you mean ${near}?` : ''}\nkoppler --help lists the commands.`);
    process.exit(2);
  }
  if (own.includes('--help') || own.includes('-h')) { help(byName[cmd]); process.exit(0); }
  // A failure says what went wrong in one line; KOPPLER_DEBUG=1 adds where, for a bug report.
  try { await byName[cmd].run(args); } catch (e) {
    console.error(`koppler: ${e?.message ?? e}`);
    if (process.env.KOPPLER_DEBUG) console.error(e?.stack);
    process.exit(1);
  }
}
