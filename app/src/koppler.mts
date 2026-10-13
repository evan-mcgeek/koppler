#!/usr/bin/env node
// The koppler command: starts apps, tunnels and the canvas as detached processes that outlive the agent session, stops
// and reverts them, and everything around a run. `koppler --help` lists the commands (COMMANDS, at the end).
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { doctor, ports, secret } from './cli/doctor.ts';
import { flagValue, positional } from './cli/output.ts';
import { fail, Failure } from './failure.ts';
import { canvas, logs, status, stop } from './cli/running.ts';
import { readData, readStack } from './data.ts';
import { switchCommand } from './engine/branch.ts';
import { APPROVE, stackCommands } from './engine/checks.ts';
import { deployed } from './engine/deployed.ts';
import { discoverCommand } from './engine/discover.ts';
import { down } from './engine/down.ts';
import { investigate } from './engine/investigate.ts';
import { discardChanges, linkStack, linkedStatus, proposeChanges, updateStack } from './engine/linked.ts';
import { listen } from './engine/listen.ts';
import { sayCommand } from './engine/messages.ts';
import { sh } from './engine/processes.ts';
import { queryCommand } from './engine/query.ts';
import { recipesCommand } from './engine/recipes.ts';
import { findCommand } from './engine/research.ts';
import { run } from './engine/run.ts';
import { appliedCommand, historyCommand, planCommand, runningNames, sessionCommand } from './engine/runs.ts';
import {
  addApps,
  candidateRepos,
  createStack,
  init as initStack,
  removeApp,
  stacksCommand,
  sync,
  updateClones,
  useCommand,
} from './engine/sync.ts';
import { up } from './engine/up.ts';
import { wire } from './engine/wire.ts';
import { APP, CODE, TEMP } from './paths.ts';

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
  console.log('');
  if (!args.includes('--no-fetch')) {
    await updateClones();
    console.log('');
  }
  investigate({ afterSync: true });
  const stack = readStack();
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
  if (args.includes('--update')) {
    const updated = await updateStack(dir);
    if (updated.error !== undefined) fail(updated.error);
    console.log(updated.message);
    sync([]);
  } else if (args.includes('--discard')) {
    discardChanges(dir);
    console.log('Your changes are discarded; the copy matches the shared stack again.');
    sync([]);
  } else if (args.includes('--pr')) {
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
    deployed(positional(args, ['--find']));
  }
}

/** What the newest Send does; with apps, the tunnels they need; with --wire, what one cable changes. */
function plan(args: string[]): void {
  if (args.includes('--wire')) wire(without(args, '--wire'));
  else if (positional(args, ['--env']).length) ports(args);
  else planCommand(args);
}

/** A run's history; --done marks one finished, which makes its board what runs. */
async function history(args: string[]): Promise<void> {
  if (args.includes('--session')) {
    await sessionCommand();
    return;
  }
  if (!args.includes('--done')) {
    historyCommand(args);
    return;
  }
  const [id] = positional(args, ['--failed']);
  // Without a reason the flag still goes along, so the command asks for one.
  const failed = args.includes('--failed') ? ['--failed', flagValue(args, '--failed')] : [];
  await appliedCommand([...(id ? [id] : []), ...failed] as string[]);
}

/** Remembered code changes: list them, keep the last edit, or apply the ones that match the latest Send. */
function recipes(args: string[]): void {
  if (args.includes('--remember')) recipesCommand('remember', without(args, '--remember'));
  else if (args.includes('--apply')) recipesCommand('prepare', without(args, '--apply'));
  else recipesCommand('recipes', args);
}

/** Apps join the stack from their clones: a repo name or slug from `koppler sync`, or a folder. */
function add(args: string[]): void {
  const wanted = positional(args);
  if (!wanted.length) fail('usage: koppler add <repo or folder>...  (koppler add --list shows the repos you can add)');
  const configDir = process.env['KOPPLER_CONFIG_DIR'] || path.join(os.homedir(), '.config', 'koppler');
  const config = JSON.parse(fs.readFileSync(path.join(configDir, 'config.json'), 'utf8')) as { stack: string };
  const index = (readData('repos') ?? fail('no repos found yet: koppler init')) as Parameters<typeof candidateRepos>[0];
  const stack = JSON.parse(fs.readFileSync(path.join(config.stack, 'stack.json'), 'utf8')) as Parameters<
    typeof candidateRepos
  >[1];
  const known = candidateRepos(index, stack, config.stack);
  const picks = wanted.map(want => {
    const folder = path.resolve(want.replace(/^~(?=\/|$)/, os.homedir()));
    const is = (slug: string) => slug === want || slug.split('/').pop() === want;
    return (
      known.find(candidate => is(candidate.slug) || candidate.path === folder) ??
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
  const commit = sh('git', ['-C', CODE, 'rev-parse', '--short', 'HEAD']);
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
    args: '[start] [--board "<name>"] [--no-open] | stop',
    about: 'start the canvas if needed and open it, on a board when one is named; stop stops it',
    run: canvas,
    example: 'koppler canvas stop && koppler canvas start',
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
    name: 'link',
    who: 'you',
    args: '<GitHub link to a stack.json> | --update | --discard | --pr',
    about: 'use a stack shared on GitHub; then bring in its changes, drop yours, or propose yours',
    run: link,
    example: 'koppler link https://github.com/acme/stacks/blob/main/shop/stack.json',
  },
  {
    name: 'doctor',
    who: 'you',
    args: '[app...] [--env <env>] [--secrets] [--flow] [--approve] [--json]',
    about: 'can it run here: tools, what you still have to do, secrets, connections',
    run: doctor,
    example: 'koppler doctor orders-api --env prod',
  },
  {
    name: 'secret',
    who: 'you',
    args: 'set|list|remove|psql <app>[@<env>] [<NAME>] [--stdin]',
    about: 'store and manage secrets; values never show',
    run: secret,
    example: 'koppler secret set orders-api@prod DB_URL',
  },
  {
    name: 'status',
    who: 'you',
    args: '[--apps] [--debug [name...]] [--json]',
    about: "what Koppler runs; --apps adds the stack's apps; --debug gives scrubbed logs for a bug report",
    run: status,
    example: 'koppler status --apps',
  },
  {
    name: 'logs',
    who: 'you',
    args: '<name> [-f] [-n <lines>]',
    about: 'show or follow a log, secrets masked',
    run: logs,
    example: 'koppler logs orders-api -f',
  },
  {
    name: 'stop',
    who: 'you',
    args: '<name...> | --apps | --all [--yes]',
    about: 'stop by name; --apps every app and tunnel, --all the canvas too',
    run: stop,
    example: 'koppler stop orders-api',
  },
  {
    name: 'history',
    who: 'you',
    args: '[--json] | --session | --done [<id>] [--failed "<why>"]',
    about: 'recent Sends and Stops; --session gathers what happened since the last Stop; --done marks a run finished',
    run: history,
    example: 'koppler history',
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
    name: 'sync',
    who: 'agent',
    args: '[--stack <dir>] [--rescan]',
    about: 'reload the stack and your clones',
    run: sync,
    example: 'koppler sync --rescan',
  },
  {
    name: 'discover',
    who: 'agent',
    args: '[app...] [--deployed] [--apply] [--find "<names>"] [--no-fetch]',
    about: 'what the repos say: ports, tunnels, calls, deployed addresses, gaps',
    run: discover,
    example: 'koppler discover --deployed',
  },
  {
    name: 'add',
    who: 'agent',
    args: '<repo or folder>...',
    about: 'add apps to the stack from their clones',
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
    args: '[app...] [--env <env>] [--wire <caller> <callee>] [--json]',
    about: 'what the newest Send does; the tunnels apps need; what one cable changes',
    run: plan,
    example: 'koppler plan orders-api payments-api --env qa',
  },
  {
    name: 'up',
    who: 'agent',
    args: '<app...> [--cable <caller>:<callee>]... [--env <env>] | --board "<name>" | --run <id>',
    about: 'start a run, recorded like Run on the canvas: tunnels, local queues, then apps, callees first',
    run: up,
    example: 'koppler up orders-api payments-api --cable orders-api:payments-api --env qa',
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
    args: '<app> [--env <env>] [--device ios|android|phone|<id>] [--lan] [--dry-run] | <name> [--cwd <dir>] [--port <n>] [--bind <address>] [--restart] -- <command...>',
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
      switchCommand(args, { temp: TEMP });
    },
    example: 'koppler switch orders-api feature/refunds --set-aside',
  },
  {
    name: 'recipes',
    who: 'agent',
    args: '[app] | --remember <app> --why "<why>" [--when ...] | --apply <app...>',
    about: 'remembered code changes: list, keep the last edit, apply the matching ones',
    run: recipes,
    example: 'koppler recipes orders-api',
  },
  {
    name: 'listen',
    who: 'agent',
    args: '--take | --as <id> | --stop',
    about: 'wait for Sends from the canvas (one agent session at a time)',
    run: listen,
    example: 'koppler listen --take',
  },
  {
    name: 'say',
    who: 'agent',
    args: '[--file <json>] | --answered <id>',
    about: 'show a question or result on the canvas',
    run: sayCommand,
    example: 'koppler say --file reply.json',
  },
];
const named = (name: string | undefined) => COMMANDS.find(command => command.name === name);

function help(command?: Command): void {
  if (command) {
    const about = command.about.charAt(0).toUpperCase() + command.about.slice(1);
    console.log(`usage: koppler ${command.name} ${command.args}\n\n${about}.\n\nExample:\n  ${command.example}`);
    return;
  }
  const width = Math.max(...COMMANDS.map(one => one.name.length)) + 2;
  const section = (title: string, who: Command['who']) =>
    [title, ...COMMANDS.filter(one => one.who === who).map(one => `  ${one.name.padEnd(width)}${one.about}`)].join(
      '\n',
    );
  const lines = [
    'Koppler runs the part of your stack you need on this Mac, wired together; the rest keeps calling a deployed environment.',
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
    '  KOPPLER_PORT (canvas, default 4747), KOPPLER_SECRETS (a folder for secrets instead of the Keychain).',
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
  else await command.run(args);
}

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
