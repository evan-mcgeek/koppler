// `koppler run`: one process, started detached and kept track of. A stack app is started by its id, with its stored
// secrets; anything else is a command of the caller's own, which never gets them.
import { fail } from '../failure.ts';
import { appStart } from './app-start.ts';
import { alive, parseRun, readRecord, startProcess, type RunOptions } from './processes.ts';
import { EMULATOR, PORT, STOP_EMULATOR } from './queues.ts';
import { noTraces, traceEnv, traceView, tracing } from './traces.ts';
import { showBrowserConsole } from './browser-console.ts';
import { readClones, readStack } from '../data.ts';

const USAGE =
  'usage: koppler run <app> | koppler run <name> [--cwd <dir>] [--port <n>] [--bind <address>] [--keep-alive] -- <command...>';
const shown = (word: string) => (/\s/.test(word) ? JSON.stringify(word) : word);

export async function run(args: string[], extra: Partial<RunOptions> = {}): Promise<void> {
  let options: RunOptions;
  try {
    options = { ...parseRun(args), ...extra };
  } catch (error) {
    fail(`${(error as Error).message}\n${USAGE}`);
  }
  if (!options.command.length) {
    const { name } = options;
    const app =
      appStart(name, options) ??
      fail(`${name} is not an app in the stack; to run a command: koppler run ${name} -- <command>`);
    const port = options.port ?? app.port;
    Object.assign(options, { command: app.command, onStop: app.onStop ?? [], env: app.env, holdsSecrets: true });
    if (app.cwd !== undefined) options.cwd = app.cwd;
    else delete options.cwd;
    if (port !== undefined) options.port = port;
    if (app.ready) options.ready = app.ready;
    if (app.once) options.once = app.once;
    const shown = readStack()?.apps[name]?.browserConsole;
    const repo = readClones()[name]?.path;
    if (shown && repo) console.log(`${name}: ${showBrowserConsole(name, repo, shown.file)}`);
    // While traces are collected, the app sends its own there, under its id; what the run sets for it comes on top.
    if (tracing()) {
      options.setEnv = { ...traceEnv(name), ...options.setEnv };
      const why = noTraces(readStack()?.apps[name] ?? {}, repo);
      console.log(why ? `${name}: sends no traces: ${why}` : `${name}: traces at ${traceView(name)}`);
    }
    if (app.device) console.log(`device: ${app.device.name} (${app.device.platform})`);
  }
  if (options.dryRun) {
    const port = options.port ? `, port ${String(options.port)}` : '';
    console.log(`would run in ${options.cwd ?? process.cwd()}${port}:\n  ${options.command.map(shown).join(' ')}`);
    for (const command of options.onStop ?? []) console.log(`on stop: ${command.join(' ')}`);
    return;
  }
  // A Lambda runs in the AWS emulator that holds the local queues: it is started first when it is not running.
  const record = readRecord('queues');
  if (readStack()?.apps[options.name]?.kind === 'lambda' && !(record && alive(record)))
    await run(['queues', '--port', String(PORT), '--', ...EMULATOR], { onStop: [STOP_EMULATOR] });
  await startProcess(options);
}
