#!/usr/bin/env node
// The koppler command: starts apps, tunnels and the canvas as detached processes that outlive the agent session, stops
// and reverts them, and everything around a run. `koppler --help` lists the commands (COMMANDS, at the end).
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { doctor, ports, secret } from './cli/doctor.ts';
import { confirm, flagValue, positional } from './cli/output.ts';
import { actionsCommand, stepCommand } from './cli/records.ts';
import { fail, Failure } from './failure.ts';
import { canvas, logs, restart, status, stop } from './cli/running.ts';
import { readData, readStack } from './data.ts';
import { switchCommand } from './engine/branch.ts';
import { APPROVE, stackCommands } from './engine/checks.ts';
import { deployed } from './engine/deployed.ts';
import { awsCheck } from './engine/aws-check.ts';
import { discoverCommand } from './engine/discover.ts';
import { down } from './engine/down.ts';
import { investigate } from './engine/investigate.ts';
import { discardChanges, linkStack, linkedStatus, proposeChanges, updateStack } from './engine/linked.ts';
import { boardCommand } from './engine/boards.ts';
import { askToConnect, listen } from './engine/listen.ts';
import { lockedPaths, setLock } from './engine/locks.ts';
import { sayCommand } from './engine/messages.ts';
import { alive, readRecord, sh } from './engine/processes.ts';
import { writeJson } from './json-files.ts';
import { queryCommand } from './engine/query.ts';
import { recipesCommand } from './engine/recipes.ts';
import { dbCommand } from './engine/local-databases.ts';
import { findCommand } from './engine/research.ts';
import { run } from './engine/run.ts';
import { appliedCommand, historyCommand, planCommand, runningNames, sessionCommand } from './engine/runs.ts';
import { updateClones } from './engine/clones.ts';
import { readIndex } from './engine/config.ts';
import { candidateRepos } from './engine/repos.ts';
import { addApps, addOutside, editStack, stackSource, readStackAt, removeApp } from './engine/stack-file.ts';
import { createStack, currentStack } from './engine/stacks.ts';
import { init as initStack, stacksCommand, sync, useCommand } from './engine/sync.ts';
import { up } from './engine/up.ts';
import { wait } from './cli/wait.ts';
import { pin } from './engine/run-logs.ts';
import { runs } from './engine/history.ts';
import { mcp } from './cli/mcp.ts';
import { agentCommand } from './cli/agent.ts';
import { doCommand } from './engine/app-commands.ts';
import { watchCommand } from './engine/watch.ts';
import { shellCommand } from './cli/shell.ts';
import { reloadCommand } from './engine/reload.ts';
import { tracesCommand } from './engine/traces.ts';
import { checkStackFile, proposeStack, stackSchema } from './engine/stack-share.ts';
import { wire } from './engine/wire.ts';
import { APP, CODE, configDir, tempDir } from './paths.ts';

const without = (args: string[], ...flags: string[]) => args.filter(arg => !flags.includes(arg));

/**
 * A first-time setup ends with the full picture: ports, conflicts and calls of every app. With --pick, or on a stack
 * that has no apps yet, init ends on the canvas, where the user ticks the clones that belong to the stack.
 */
async function init(given: string[]): Promise<void> {
  let args = given;
  // A new, empty stack: a name and its deployed environments; its apps are picked next.
  if (args.includes('--new')) {
    const named = flagValue(args, '--new');
    const created = createStack({ name: named ?? '', envs: flagValue(args, '--envs') ?? '' });
    if (created.error !== undefined) fail(created.error);
    console.log(`Created ${String(named)} in ${created.stack}; it is the stack in use.`);
    const own = ['--new', '--envs'];
    args = [...args.filter((arg, at) => !own.includes(arg) && !own.includes(args[at - 1] ?? '')), '--pick'];
  }
  const pick = args.includes('--pick');
  initStack(without(args, '--pick', '--no-fetch'));
  const stack = readStack();
  // With no app in the stack yet there is no clone to update and nothing to report.
  if (stack && !stack.setup && Object.keys(stack.apps).length) {
    console.log('');
    if (!args.includes('--no-fetch')) {
      await updateClones();
      console.log('');
    }
    investigate({ afterSync: true });
  }
  const terminal = process.stdout.isTTY;
  if (!stack || !(pick || (!Object.keys(stack.apps).length && terminal))) return;
  if (stack.setup && !pick && !terminal) return;
  console.log(
    stack.setup
      ? '\nName your stack and choose its apps on the canvas.'
      : `\nChoose which of your repos Koppler should run in ${stack.name ?? 'this stack'} on the canvas.`,
  );
  await canvas(['--pick']);
}

const loaded = () => readStack() ?? fail('no stack loaded (koppler init)');

/** After changes made outside the canvas: the stack and clones read again, and an open canvas shows them. */
function refresh(args: string[]): void {
  if (!args.includes('--no-sync')) sync(without(args, '--no-sync'));
  writeJson(path.join(tempDir(), 'refresh.json'), { at: new Date().toISOString() });
  const canvas = readRecord('canvas');
  console.log(
    canvas && alive(canvas)
      ? 'The open canvas reads the stack and its board again.'
      : 'No canvas is open; it shows the changes when it opens.',
  );
}

/** Stacks on this Mac, or switch to one; --boards lists the boards of the stack in use (the team's presets and your own). */
function use(args: string[]): void {
  if (args.includes('--boards')) {
    const own = (readData('state')?.['presets'] ?? []) as { name: string }[];
    const boards = [
      ...(loaded().presets ?? []).map(preset => ({ name: preset.name, from: 'team' })),
      ...own.map(preset => ({ name: preset.name, from: 'yours' })),
    ];
    if (args.includes('--json')) console.log(JSON.stringify(boards, null, 2));
    else if (!boards.length) console.log('No boards yet: build one on the canvas.');
    else
      for (const board of boards)
        console.log(`${board.name}  (${board.from === 'team' ? 'team preset' : 'your board'})`);
    return;
  }
  const wanted = positional(args);
  if (!wanted.length) {
    stacksCommand(args);
    return;
  }
  if (runningNames().some(name => name !== 'canvas'))
    fail('something is still running; stop and revert it first (canvas, or koppler down), then switch');
  useCommand(wanted);
}

const NOT_LINKED =
  'the stack in use is not linked to GitHub; link one with: koppler link <GitHub link to a stack.json>';
/** A stack shared on GitHub: link it, then see its changes, bring in GitHub's, drop yours, or propose yours. */
async function link(args: string[]): Promise<void> {
  const [url] = positional(args);
  if (url) {
    const linked = await linkStack(url);
    if (linked.error !== undefined) fail(linked.error);
    console.log(`USING ${String(linked.name)}, linked from ${url}`);
    sync([]);
    // A linked stack is someone else's file: say so when it brings commands of its own.
    const own = stackCommands(readStack()).length;
    if (own)
      console.log(
        `\nThis stack carries ${String(own)} ${own === 1 ? 'command or code change' : 'commands and code changes'} of its own. None runs until you have reviewed them: ${APPROVE}`,
      );
    return;
  }
  const dir = readStack()?.source?.replace(/\/stack\.json$/, '') ?? fail('no stack in use');
  const linked = linkedStatus(dir) ?? fail(NOT_LINKED);
  if (args[0] === 'update') {
    const updated = await updateStack(dir);
    if (updated.error !== undefined) fail(updated.error);
    console.log(updated.message);
    sync([]);
  } else if (args[0] === 'discard') {
    discardChanges(dir);
    console.log('Your changes are discarded; the copy matches the shared stack again.');
    sync([]);
  } else if (args[0] === 'pr') {
    const proposed = await proposeChanges(dir);
    if (proposed.error !== undefined) fail(proposed.error);
    console.log(`Pull request: ${proposed.url}`);
  } else {
    console.log(`Linked from ${linked.url} (fetched ${String(linked.fetchedAt)})`);
    const changes = linked.changes.map(change => `  ${change}`).join('\n');
    const request = linked.pr ? `\nPull request: ${linked.pr}` : '';
    console.log(
      linked.changes.length
        ? `Changes not in the shared stack yet:\n${changes}${request}`
        : 'No changes: this copy matches the shared stack.',
    );
  }
}

/**
 * Everything the repos say about the stack's apps: the report (ports, tunnels, calls, conflicts, gaps), then what could
 * be added to stack.json; --deployed adds the infrastructure drafts, --find looks up repos by name first.
 */
async function discover(args: string[]): Promise<void> {
  const names = flagValue(args, '--find');
  if (names !== undefined) {
    await findCommand([...names.split(/[,\s]+/).filter(Boolean), ...args.filter(arg => arg === '--no-github')]);
    return;
  }
  if (!args.includes('--no-fetch')) {
    await updateClones();
    console.log('');
  }
  investigate();
  console.log('');
  discoverCommand(args.filter(arg => arg === '--apply'));
  if (args.includes('--deployed')) {
    console.log('');
    deployed(positional(args, ['--find', '--env']));
    if (args.includes('--aws')) {
      const stack = readStack() ?? fail('no stack loaded (koppler init)');
      const env = flagValue(args, '--env') ?? stack.envs[0] ?? '';
      if (!stack.envs.includes(env)) fail(`--env is one of ${stack.envs.join(', ')}`);
      awsCheck(stack, env);
    }
  }
}

/** What the newest Send does; with apps, the tunnels they need; with --wire, what one cable changes. */
function plan(args: string[]): void {
  if (args.includes('--wire')) wire(without(args, '--wire'));
  else if (positional(args, ['--env']).length) ports(args);
  else planCommand(args);
}

/** A run's history; done marks one finished, which makes its board what runs. */
async function history([sub, ...rest]: string[]): Promise<void> {
  if (sub === 'session') {
    await sessionCommand();
    return;
  }
  if (sub === 'pin' || sub === 'unpin') {
    const [id = ''] = rest;
    if (!runs().some(run => run.id === id)) fail(`no run ${id}; koppler history lists them`);
    pin(id, sub === 'pin');
    console.log(
      sub === 'pin' ? `Kept: run ${id}'s logs stay until you unpin it.` : `Run ${id}'s logs go with the oldest again.`,
    );
    return;
  }
  if (sub !== 'done') {
    historyCommand([sub, ...rest].filter(arg => arg !== undefined));
    return;
  }
  const args = rest;
  const [id] = positional(args, ['--failed']);
  // Without a reason the flag still goes along, so the command asks for one.
  const why = flagValue(args, '--failed');
  const failed = args.includes('--failed') ? ['--failed', ...(why ? [why] : [])] : [];
  await appliedCommand([...(id ? [id] : []), ...failed]);
}

/** Remembered code changes: list them, keep the last edit, or apply the ones that match the latest Send. */
function recipes(args: string[]): void {
  if (args.includes('--remember')) recipesCommand('remember', without(args, '--remember'));
  else if (args.includes('--apply')) recipesCommand('prepare', without(args, '--apply'));
  else recipesCommand('recipes', args);
}

/** Apps join the stack from their clones: a repo name or slug from `koppler sync`, or a folder. */
function add(args: string[]): void {
  const outside = flagValue(args, '--outside');
  if (outside !== undefined) {
    const values = (flag: string) => args.filter((_, at) => args[at - 1] === flag);
    const added = addOutside({
      name: outside,
      url: flagValue(args, '--url'),
      why: flagValue(args, '--why'),
      calledBy: values('--called-by').flatMap(value => value.split(',').map(id => id.trim())),
      sendsTo: values('--sends-to').flatMap(value => value.split(',').map(id => id.trim())),
    });
    if (added.error !== undefined) fail(added.error);
    console.log(
      `Added ${outside} (${added.added}) as an outside system; its card shows next to the apps that call it.`,
    );
    sync([]);
    return;
  }
  const wanted = positional(args);
  if (!wanted.length) fail('usage: koppler add <repo or folder>...  (koppler add --list shows the repos you can add)');
  const config = JSON.parse(fs.readFileSync(path.join(configDir(), 'config.json'), 'utf8')) as { stack: string };
  // The clones as the last scan found them, at their full paths: not the picker's copy, which shows them as ~/...
  const index = readIndex() ?? fail('no repos found yet: koppler init');
  const stack = JSON.parse(fs.readFileSync(path.join(config.stack, 'stack.json'), 'utf8')) as Parameters<
    typeof candidateRepos
  >[1];
  const known = candidateRepos(index, stack, config.stack);
  const picks = wanted.map(want => {
    const full = (given: string) => path.resolve(given.replace(/^~(?=\/|$)/, os.homedir()));
    const folder = full(want);
    const is = (slug: string) => slug === want || slug.split('/').pop() === want;
    return (
      known.find(candidate => is(candidate.slug) || full(candidate.path) === folder) ??
      fail(`${want} is not one of your clones that is outside the stack; koppler sync --rescan finds new clones`)
    );
  });
  const added = addApps(picks.map(({ slug }) => ({ slug })));
  if (added.error !== undefined) fail(added.error);
  console.log(
    added.added.length
      ? `Added ${added.added.join(', ')}; fill in how each runs with: koppler discover`
      : 'Nothing to add: they are in the stack already.',
  );
  sync([]);
}

/** One field of the stack in use: read it, set it or take it out, checked against the stack's rules. */
async function stackCommand(args: string[]): Promise<void> {
  const [what, at, ...rest] = args;
  if (what === 'schema') {
    console.log(JSON.stringify(stackSchema(), null, 2));
    return;
  }
  if (what === 'check') {
    const file =
      at ??
      path.join(currentStack() ?? fail('no stack in use: give the file, koppler stack check stack.json'), 'stack.json');
    const problems = checkStackFile(file);
    if (problems.length)
      fail(
        `${file}: ${String(problems.length)} ${problems.length === 1 ? 'problem' : 'problems'}\n${problems.map(one => `  ${one}`).join('\n')}`,
      );
    console.log(`${file}: OK`);
    return;
  }
  if (what === 'propose') {
    await proposeStack();
    return;
  }
  if (what === 'get') {
    const read = readStackAt(at ?? '');
    if (read.error !== undefined) fail(read.error);
    if (read.value === undefined) fail(`nothing at ${at ?? ''}`);
    console.log(JSON.stringify(read.value, null, 2));
    return;
  }
  if (what === 'locks') {
    const source = stackSource() ?? fail('no stack in use');
    const locked = lockedPaths(source);
    console.log(locked.length ? locked.join('\n') : 'No field is locked.');
    return;
  }
  if (what === 'lock' || what === 'unlock') {
    const source = stackSource() ?? fail('no stack in use');
    if (!at) fail(`usage: koppler stack ${what} <path>`);
    // Only the person at the terminal unlocks: an agent or a script cannot answer, and --yes is not taken.
    if (what === 'unlock' && !(await confirm(`Unlock ${at}, so commands and the agent can change it again?`)))
      fail(`${at} stays locked; unlocking needs your yes in a terminal, or the lock on the canvas`);
    const done = setLock(source, at, what === 'lock');
    if (done.error !== undefined) fail(done.error);
    console.log(`${what === 'lock' ? 'LOCKED' : 'UNLOCKED'} ${at}`);
    return;
  }
  if ((what !== 'set' && what !== 'unset') || !at || (what === 'set' && !rest.length))
    fail(
      'usage: koppler stack get [<path>] | set <path> <value> | unset <path> | lock <path> | unlock <path> | locks | check [<file>] | schema | propose',
    );
  const raw = rest.join(' ');
  // Typed in a terminal, 5001 may be a port or a name: whichever keeps the stack valid, JSON first.
  const values = (() => {
    if (what === 'unset') return undefined;
    try {
      return [JSON.parse(raw) as unknown, raw];
    } catch {
      return [raw];
    }
  })();
  const changed = editStack(at, values);
  if (changed.error !== undefined) fail(changed.error);
  console.log(what === 'unset' ? `UNSET ${at}` : `SET ${at} = ${JSON.stringify(changed.value)}`);
  sync([]);
}

function remove(args: string[]): void {
  const removed = removeApp(positional(args)[0] ?? fail('usage: koppler remove <app>'));
  if (removed.error !== undefined) fail(removed.error);
  console.log(`Removed ${removed.name} from the stack (its clone stays).`);
  sync([]);
}

/** Koppler's version: the package's, or the commit when it runs from a clone. */
function version(): string {
  let packaged: string | undefined;
  try {
    packaged = (JSON.parse(fs.readFileSync(path.join(APP, 'package.json'), 'utf8')) as { version?: string }).version;
  } catch {
    // An unreadable package file: the commit alone says which Koppler this is.
  }
  // Only Koppler's own clone: an install inside another repo (Homebrew's folder) would name that repo's commit.
  const [top, head] = sh('git', ['-C', CODE, 'rev-parse', '--show-toplevel', '--short', 'HEAD']).split('\n');
  const own = top && fs.realpathSync(top) === fs.realpathSync(path.dirname(APP));
  const commit = own ? head : '';
  return [packaged, commit && `(${commit})`].filter(Boolean).join(' ') || 'unknown';
}

interface Command {
  name: string;
  /** Who it is for: the person, or the agent working for them. */
  who: 'you' | 'agent';
  args: string;
  about: string;
  run: (args: string[]) => unknown;
  example: string;
  /** Each way to call it, with what that does: shown by its --help. */
  forms?: [string, string][];
}
/** Every command: what it takes, what it does, and one example. People's commands come first in the help. */
const COMMANDS: Command[] = [
  {
    name: 'init',
    who: 'you',
    args: '[--new "<name>" --envs qa,prod] [--root <dir>]... [--stack <dir>] [--pick] [--no-fetch]',
    about: 'find your repos and the stack, or start a new stack',
    run: init,
    example: 'koppler init --new "Shop" --envs qa,prod',
  },
  {
    name: 'canvas',
    who: 'you',
    args: '[start] [--board "<name>"] [--no-open] [--new-address] | stop',
    about: 'start the canvas if needed and open it, on a board when one is named; stop stops it',
    run: canvas,
    example: 'koppler canvas stop && koppler canvas start',
    forms: [
      ['[start] [--board "<name>"] [--no-open]', 'start it if needed and open it in the browser, on that board'],
      ['--new-address', 'give the canvas a new address: every address given out before stops working'],
      ['stop', 'stop the canvas; apps and tunnels keep running'],
    ],
  },
  {
    name: 'use',
    who: 'you',
    args: '[stack] [--boards] [--json]',
    about: 'list the stacks on this Mac (* is in use), switch to one, or list its boards',
    run: use,
    example: 'koppler use "Shop"',
  },
  {
    name: 'db',
    who: 'you',
    args: '[local <database> <host:port[/database]> | local <database> --clear]',
    about: "the stack's databases, and where each runs on this Mac when switched to Local",
    run: dbCommand,
    example: 'koppler db local orders-db localhost:5432/orders',
    forms: [
      ['', 'list the databases, the apps that use them and their local addresses'],
      ['local <database> <host:port[/database]>', 'keep where it runs on this Mac (never in the stack)'],
      ['local <database> --clear', 'forget its local address'],
    ],
  },
  {
    name: 'link',
    who: 'you',
    args: '[<GitHub link to a stack.json> | update | discard | pr]',
    about: 'use a stack shared on GitHub; then bring in its changes, drop yours, or propose yours',
    run: link,
    example: 'koppler link https://github.com/acme/stacks/blob/main/shop/stack.json',
    forms: [
      ['<GitHub link to a stack.json>', 'use that stack: a local copy you can change'],
      ['', 'where the copy came from, and your changes not in the shared stack yet'],
      ['update', "bring in the shared stack's changes"],
      ['discard', 'drop your changes; the copy matches the shared stack again'],
      ['pr', 'open a pull request with your changes'],
    ],
  },
  {
    name: 'doctor',
    who: 'you',
    args: '[app...] [--env <env>] [--no-tunnels <app,...>] [--secrets] [--flow] [--approve] [--json]',
    about: 'can it run here: tools, what you still have to do, secrets, connections',
    run: doctor,
    example: 'koppler doctor orders-api --env prod',
  },
  {
    name: 'secret',
    who: 'you',
    args: 'set|list|remove|psql <app>[@<env>] [<NAME>] [--stdin] [--pgpass]',
    about: 'store and manage secrets; values never show',
    run: secret,
    example: 'koppler secret set orders-api@prod DB_URL',
    forms: [
      ['set <app>[@<env>] <NAME> [--stdin]', 'store a secret, typed hidden or read from stdin'],
      ['list <app>[@<env>]', 'which secrets are stored, never their values'],
      ['remove <app>[@<env>] <NAME>', 'delete a stored secret'],
      [
        'psql <app>[@<env>] <NAME> [--pgpass]',
        "open psql with the app's stored connection; --pgpass writes a pgpass file for another client",
      ],
    ],
  },
  {
    name: 'status',
    who: 'you',
    args: '[--apps] [--debug [name...]] [--json] | step <app> "<label>" done|todo|user|failed [--detail "<what>"] [--copy "<command>"] [--port <n>] [--log <file>] | step <app> --clear',
    forms: [
      [
        '[--apps] [--debug [name...]] [--json]',
        "what Koppler runs; --apps adds the stack's apps; --debug gives scrubbed logs for a bug report",
      ],
      [
        'step <app> "<label>" done|todo|user|failed [--detail "<what>"] [--copy "<command>"] [--port <n>] [--log <file>]',
        "set one step of an app's checklist on its card (the agent does this)",
      ],
      ['step <app> --clear', "take the agent's steps off an app's card"],
    ],
    about: "what Koppler runs; --apps adds the stack's apps; --debug gives scrubbed logs for a bug report",
    run: args => {
      if (args[0] === 'step') stepCommand(args.slice(1));
      else return status(args);
    },
    example: 'koppler status --apps',
  },
  {
    name: 'logs',
    who: 'you',
    args: '<name> [-f] [-n <lines>] [--run <id>] | --all [-f] [--since run|1h|all] [--lines <n>] [--except <app,app>]',
    about:
      'show or follow a log, secrets masked; --run shows the one a past run kept; --all shows every app on the board in one stream, in the order its lines came',
    run: logs,
    example: 'koppler logs orders-api -f',
  },
  {
    name: 'stop',
    who: 'you',
    args: '<name...> | --all [--yes]',
    forms: [
      ['<name...>', 'stop these processes (koppler status lists them)'],
      ['--all [--yes]', 'stop every app and tunnel, after asking; not the canvas'],
    ],
    about:
      'stop by name, or --all every app and tunnel; changes stay (down reverts them, canvas stop stops the canvas)',
    run: stop,
    example: 'koppler stop orders-api',
  },
  {
    name: 'restart',
    who: 'you',
    args: '<name>',
    about: 'stop an app or tunnel and start it again the way it was started',
    run: restart,
    example: 'koppler restart tunnel-db-qa-acme-example-5432',
  },
  {
    name: 'history',
    who: 'you',
    args: '[--json] | session | done [<id>] [--failed "<why>"] | pin|unpin <id>',
    about: 'recent runs and Stops; session gathers what happened since the last Stop; done marks a run finished',
    forms: [
      ['[--json]', 'recent runs and Stops and how each ended'],
      ['session', 'gather what happened since the last Stop, for a bug report'],
      ['done [<id>] [--failed "<why>"]', 'mark a run finished, or failed and why (the agent does this)'],
      ['pin|unpin <id>', "keep a run's app logs, which otherwise go with the oldest after 20 runs"],
    ],
    run: history,
    example: 'koppler history',
  },
  {
    name: 'reload',
    who: 'you',
    args: '<app> [--restart]',
    about: 'hot reload a Flutter app Koppler runs; --restart hot restarts it',
    run: reloadCommand,
    example: 'koppler reload mobile-app',
  },
  {
    name: 'shell',
    who: 'you',
    args: '<app> [--env <env>] [--query]',
    about: "a shell in an app's clone with its run's settings, never its secrets; --query opens psql on its database",
    run: shellCommand,
    example: 'koppler shell orders-api',
  },
  {
    name: 'traces',
    who: 'you',
    args: 'start|stop|open [<app>]',
    about: 'collect traces from the apps Koppler starts and follow one request across them (Jaeger in Docker)',
    run: tracesCommand,
    example: 'koppler traces open orders-api',
  },
  {
    name: 'query',
    who: 'you',
    args: '<app> [--env <env>] [--secret <NAME>] "<sql>"',
    about: "read-only query with the app's stored connection (on PROD: in your own terminal)",
    run: queryCommand,
    example: 'koppler query orders-api "select count(*) from orders"',
  },
  {
    name: 'refresh',
    who: 'agent',
    args: '[--no-sync]',
    about: 'after changes made outside the canvas: read the stack and clones again, and have an open canvas show them',
    run: refresh,
    example: 'koppler refresh',
  },
  {
    name: 'sync',
    who: 'agent',
    args: '[--stack <dir>] [--rescan] [--github]',
    about: 'reload the stack and your clones; --github reads the repos not cloned here from GitHub too',
    run: sync,
    example: 'koppler sync --rescan',
  },
  {
    name: 'discover',
    who: 'agent',
    args: '[app...] [--deployed [--aws [--env <env>]]] [--apply] [--find "<name,...>"] [--no-fetch] [--no-github]',
    about: 'what the repos say: ports, tunnels, calls, deployed addresses, gaps',
    run: discover,
    example: 'koppler discover --deployed',
  },
  {
    name: 'add',
    who: 'agent',
    args: '<repo or folder>... | --outside "<name>" [--called-by <app,...>] [--sends-to <app,...>] [--url <address>] [--why "<why>"]',
    forms: [
      ['<repo or folder>...', 'add apps to the stack from their clones'],
      [
        '--outside "<name>" [--called-by <app,...>] [--sends-to <app,...>] [--url <address>] [--why "<why>"]',
        'add a system that never runs here: called by the apps, or sending to them (a webhook)',
      ],
    ],
    about: 'add apps from their clones, or an outside system they call',
    run: add,
    example: 'koppler add acme/orders-api',
  },
  {
    name: 'remove',
    who: 'agent',
    args: '<app>',
    about: 'take an app out of the stack (its clone stays)',
    run: remove,
    example: 'koppler remove orders-api',
  },
  {
    name: 'plan',
    who: 'agent',
    args: '[app...] [--env <env>] [--wire <caller> <callee> [--device ios|android|phone|<id>]] [--json]',
    about: 'what the newest run does; the tunnels apps need; what one cable changes',
    run: plan,
    example: 'koppler plan orders-api payments-api --env qa',
  },
  {
    name: 'up',
    who: 'agent',
    args: '<app...> [--cable <caller>:<callee>]... [--env <env>] | --board "<name>" [--env <env>] | --run <id>',
    about: 'start a run, recorded like Run on the canvas: tunnels, local queues, then apps, callees first',
    run: up,
    example: 'koppler up orders-api payments-api --cable orders-api:payments-api --env qa',
  },
  {
    name: 'wait',
    who: 'agent',
    args: '<app...> --healthy|--up|--down [--timeout <seconds>] [--json]',
    about: 'wait until apps are healthy, up or down; fails on a timeout or an app that exits, naming each state',
    run: wait,
    example: 'koppler wait orders-api payments-api --healthy --timeout 180',
  },
  {
    name: 'do',
    who: 'agent',
    args: '<app> <command> [--arg <name>=<value>]... [--env <env>] [--yes]',
    about: "run one of an app's commands from the stack, such as seed or migrate, in its clone with its secrets",
    run: doCommand,
    example: 'koppler do orders-api seed --arg COUNT=50 --yes',
  },
  {
    name: 'watch',
    who: 'agent',
    args: '<app>',
    about: 'restart an app when a file in its clone changes (a run starts this for a card set to Restart on change)',
    run: watchCommand,
    example: 'koppler watch orders-api',
  },
  {
    name: 'down',
    who: 'agent',
    args: '[--run <stop id>]',
    about: 'stop and revert: stop what Koppler runs, undo every change, branches back',
    run: down,
    example: 'koppler down',
  },
  {
    name: 'run',
    who: 'agent',
    args: '<app> [--env <env>] [--device ios|android|phone|<id>] [--lan] [--no-test] [--dry-run] [--mock] | <name> [--cwd <dir>] [--port <n>] [--bind <address>] [--ready <url>] [--keep-alive] -- <command...>',
    about: 'start one stack app, or any command, detached and logged',
    run: args => run(args),
    example: 'koppler run orders-api --env qa',
  },
  {
    name: 'switch',
    who: 'agent',
    args: '<app> <branch> [--set-aside | --take-along] | <app> --back',
    about: "switch a clone to the board's branch, and back",
    run: args => {
      switchCommand(args, { temp: tempDir() });
    },
    example: 'koppler switch orders-api feature/refunds --set-aside',
  },
  {
    name: 'recipes',
    who: 'agent',
    args: '[app] | --remember <app> --why "<why>" [--when ...] [--any-os] [--private] | --apply <app...> [--env <env>]',
    about: 'remembered code changes: list, keep the last edit, apply the matching ones',
    run: recipes,
    example: 'koppler recipes orders-api',
  },
  {
    name: 'listen',
    who: 'agent',
    args: 'take | as <id> | stop',
    forms: [
      ['take', 'connect this session, taking over from any other; prints its id'],
      ['as <id>', 'listen again as that session'],
      ['stop', 'disconnect whichever session listens'],
    ],
    about: 'wait for requests from the canvas (one agent session at a time)',
    run: listen,
    example: 'koppler listen take',
  },
  {
    name: 'board',
    who: 'agent',
    args: 'new|edit "<name>" [--add <app,...>] [--remove <app,...>] [--cable <caller>:<callee>]... [--uncable <caller>:<callee>]... [--branch <app>=<branch>]... [--note <app>="<note>"]... [--arrange] [--propose] [--request "<words>"] [--phase "<name>"] [--step|--propose-step <from>:<to>[="<note>"]]... [--unstep <from>:<to>]...',
    forms: [
      [
        'new "<name>" [--add <app,...>] [--cable <caller>:<callee>]...',
        'make a board of your own, with its apps and cables',
      ],
      [
        'edit "<name>" [--add <app,...>] [--remove <app,...>]',
        'put apps on a board or take them off; the cards already there keep their places',
      ],
      ['edit "<name>" [--cable <caller>:<callee>]... [--uncable <caller>:<callee>]...', 'add or take off cables'],
      ['edit "<name>" [--branch <app>=<branch>]... [--note <app>="<note>"]...', "set an app's branch or note"],
      ['new|edit "<name>" ... --arrange', 'lay the board out afresh, as Arrange on the canvas does'],
      [
        'new|edit "<name>" [--request "<words>"] [--phase "<name>"] [--step <from>:<to>[="<note>"]]...',
        "make it a feature board: the request it came from, and the stack's links it uses as numbered steps, each in the phase named before it",
      ],
      [
        'edit "<name>" [--propose-step <from>:<to>[="<why>"]]... [--unstep <from>:<to>]...',
        'propose a step, dashed on the map until the user accepts it there, or take one off; a card is an app, queue:<id> or database:<id>',
      ],
      [
        'new|edit "<name>" ... --propose',
        'ask the user first, in the canvas inbox; nothing changes until they say yes',
      ],
      ['share "<name>"', "propose one of your boards to the team: a pull request on the stack's repo on GitHub"],
      [
        'open <file or link> [--no-open]',
        'open a board from a file or a GitHub link: it joins your boards and the canvas shows it; Reload reads it again',
      ],
      ['delete "<name>"', 'move one of your boards to Recently deleted, where the board picker can bring it back'],
    ],
    about: 'make, change or share a board, even one open on the canvas, which shows the change',
    run: boardCommand,
    example: 'koppler board edit "Checkout" --add orders-api --cable web:orders-api',
  },
  {
    name: 'stack',
    who: 'agent',
    args: 'get [<path>] | set <path> <value> | unset <path> | lock <path> | unlock <path> | locks | check [<file>] | schema | propose',
    forms: [
      ['get [<path>]', 'print a field of the stack in use, or the whole stack, as JSON'],
      ['set <path> <value>', 'set a field: text, or JSON for a number, a list or an object; checked before it is kept'],
      ['unset <path>', 'take a field out (an item of a list closes up)'],
      ['lock <path>', 'keep a field as it is: no command, canvas edit or agent changes it'],
      ['unlock <path>', 'let it change again; asks you in the terminal, so an agent cannot'],
      ['locks', 'list the locked fields'],
      ['check [<file>]', "every check the stack must pass, for the team repo's CI; fails with each problem"],
      ['schema', "the JSON Schema of stack.json, for an editor's $schema"],
      ['propose', "a pull request on the stack's repo with what this copy changed since its last commit"],
    ],
    about: 'read and change any field of the stack, the only way to change stack.json',
    run: stackCommand,
    example: 'koppler stack set apps.orders-api.ready \'{"path":"/health"}\'',
  },
  {
    name: 'actions',
    who: 'agent',
    args: "[--json] | add '<json>' | add --file <json file> | clear [--app <app>]",
    forms: [
      ['[--json]', 'the changes Stop will undo'],
      [
        "add '<json>' | add --file <json file>",
        'log a change, or a list of them, before making it; checked, and never a secret value',
      ],
      ['clear [--app <app>]', "empty the log once everything in it is undone, or drop one app's entries"],
    ],
    about: 'the action log: every temporary change, which Stop undoes; the only way to write it',
    run: actionsCommand,
    example: `koppler actions add '{"kind":"env-file","app":"orders-api","file":"/full/path/.env.local","lines":["A=1"],"created":true}'`,
  },
  {
    name: 'say',
    who: 'agent',
    args: '[--file <json>] | --answered <id> [--text "<what was answered>"]',
    about: 'show a question or result on the canvas',
    run: sayCommand,
    example: 'koppler say --file reply.json',
  },
  {
    name: 'mcp',
    who: 'agent',
    args: '',
    about: 'serve MCP on stdio: status, logs, doctor, plan, history, wait and say as tools for any agent',
    run: () => mcp(version()),
    example: 'claude mcp add koppler -- koppler mcp',
  },
  {
    name: 'agent',
    who: 'agent',
    args: 'init [--agent claude,copilot,vscode,opencode] [--dry-run]',
    about: 'link the skill into each agent on this Mac and register koppler mcp with it',
    run: agentCommand,
    example: 'koppler agent init',
  },
];
const named = (name: string | undefined) => COMMANDS.find(command => command.name === name);

function help(command?: Command): void {
  if (command) {
    const about = command.about.charAt(0).toUpperCase() + command.about.slice(1);
    const width = Math.max(0, ...(command.forms ?? []).map(([form]) => form.length)) + 2;
    const forms = (command.forms ?? []).map(([form, what]) => `  koppler ${command.name} ${form.padEnd(width)}${what}`);
    const usage = forms.length ? `usage:\n${forms.join('\n')}` : `usage: koppler ${command.name} ${command.args}`;
    console.log(`${usage}\n\n${about}.\n\nExample:\n  ${command.example}`);
    return;
  }
  const width = Math.max(...COMMANDS.map(one => one.name.length)) + 2;
  const section = (title: string, who: Command['who']) =>
    [title, ...COMMANDS.filter(one => one.who === who).map(one => `  ${one.name.padEnd(width)}${one.about}`)].join(
      '\n',
    );
  const lines = [
    'Koppler plugs your local code into the real stack: the apps you change run on this Mac, wired together; the rest keeps calling a deployed environment.',
    '',
    'usage: koppler <command> [options]',
    '',
    section('For you', 'you'),
    '',
    section('For the agent', 'agent'),
    '',
    'koppler help <command>, or koppler <command> --help, shows its options and an example. koppler --version prints the version.',
    '',
    'Environment: KOPPLER_STATE (state folder, default ~/.local/state/koppler), KOPPLER_CONFIG_DIR (default ~/.config/koppler),',
    '  KOPPLER_PORT (canvas, default 4747), KOPPLER_SECRETS (a folder for secrets instead of the Keychain),',
    '  KOPPLER_KEYCHAIN (a keychain file of its own), KOPPLER_TEMP and KOPPLER_LOGS (run state and logs, default inside KOPPLER_STATE).',
  ];
  console.log(lines.join('\n'));
}

/** How many single-letter edits turn one word into the other. */
function distance(a: string, b: string): number {
  let row = Array.from({ length: b.length + 1 }, (_, at) => at);
  for (let i = 1; i <= a.length; i++) {
    const next = [i];
    for (let j = 1; j <= b.length; j++) {
      const swap = (row[j - 1] ?? 0) + (a[i - 1] === b[j - 1] ? 0 : 1);
      next.push(Math.min((row[j] ?? 0) + 1, (next[j - 1] ?? 0) + 1, swap));
    }
    row = next;
  }
  return row[b.length] ?? 0;
}
/** The closest command to a typo, if one is close enough. */
function closest(word: string): string | null {
  const [best] = COMMANDS.map(command => ({ name: command.name, off: distance(word, command.name) })).sort(
    (a, b) => a.off - b.off,
  );
  if (best && best.off <= 2) return best.name;
  return COMMANDS.find(command => command.name.startsWith(word))?.name ?? null;
}

/** Runs what was asked for. The help, the version and a finished command return; anything else is thrown. */
async function main([name, ...args]: string[]): Promise<void> {
  const own = args.includes('--') ? args.slice(0, args.indexOf('--')) : args;
  if (!name || name === 'help' || name === '--help' || name === '-h') {
    if (name === 'help' && args[0] && !named(args[0]))
      fail(`usage: no command "${args[0]}"; koppler --help lists them`);
    help(named(args[0]));
    return;
  }
  if (name === '--version' || name === '-V' || name === 'version') {
    console.log(`koppler ${version()}`);
    return;
  }
  const command = named(name);
  if (!command) {
    const near = closest(name);
    throw new Failure(
      `unknown command "${name}".${near ? ` Did you mean ${near}?` : ''}\nkoppler --help lists the commands.`,
      2,
    );
  }
  if (own.includes('--help') || own.includes('-h')) help(command);
  else {
    await command.run(args);
    if (setsUpCanvas(name, args)) askToConnect();
  }
}
/** A command that starts the canvas or gives it another stack or board: an agent that ran it is asked to connect. */
const setsUpCanvas = (name: string, args: string[]) =>
  (name === 'canvas' && args[0] !== 'stop') ||
  name === 'init' ||
  (name === 'use' && !!positional(args).length && !args.includes('--boards')) ||
  (name === 'board' && ['new', 'open'].includes(args[0] ?? ''));

if (process.argv[1] && fs.realpathSync(process.argv[1]) === fileURLToPath(import.meta.url)) {
  // A failure says what went wrong in one line; KOPPLER_DEBUG=1 adds where, for a bug report.
  try {
    await main(process.argv.slice(2));
  } catch (error) {
    const { message, stack } = error as Partial<Error>;
    // A failure the command raised itself has said everything when its message is empty.
    if (!(error instanceof Failure) || message) console.error(`koppler: ${message ?? String(error)}`);
    if (error instanceof Failure) process.exit(error.code);
    if (process.env['KOPPLER_DEBUG']) console.error(stack);
    process.exit(1);
  }
}
