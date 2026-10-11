#!/usr/bin/env node
// The koppler command: starts apps, tunnels and the canvas as detached processes that outlive the agent session, stops
// and reverts them, and everything around a run. `koppler --help` lists the commands (COMMANDS, at the end).
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { init as initStack, removeApp, stacksCommand, sync, updateClones, useCommand } from './sync.mjs';
import { discardChanges, linkStack, linkedStatus, proposeChanges, updateStack } from './linked.mjs';
import { discoverCommand } from './discover.mjs';
import { sayCommand } from './messages.mjs';
import { switchCommand } from './engine/branch.ts';
import { down } from './engine/down.ts';
import { secretTest } from './engine/app-start.ts';
import { wire } from './engine/wire.ts';
import { run } from './engine/run.ts';
import { canvas, logs, status, stop } from './cli/running.ts';
import { up } from './engine/up.ts';
import { recipesCommand } from './engine/recipes.ts';
import { queryCommand } from './query.mjs';
import { findCommand } from './research.mjs';
import { investigate } from './investigate.mjs';
import { deployed } from './deployed.mjs';
import { appliedCommand as applied, historyCommand, planCommand, runningNames } from './engine/runs.ts';
import * as tunnelPlan from './core/ports.ts';
import { needs as needsFor } from './engine/needs.ts';
import { APPROVE, missingTunnels } from './engine/checks.ts';
import { APP, BIN, TEMP } from './paths.ts';
import { confirm, envOf, fail, flagValue, positional } from './cli/output.ts';
import { sh } from './engine/processes.ts';
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

const registryOrFail = () => readData('registry') ?? fail('no stack loaded (koppler init)');

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
  if (args.includes('--remember')) return recipesCommand('remember', args.filter(a => a !== '--remember'));
  if (args.includes('--apply')) return recipesCommand('prepare', args.filter(a => a !== '--apply'));
  return recipesCommand('recipes', args);
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
