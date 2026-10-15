// `koppler do`: a command an app declares in the stack (Seed, Migrate), run in its clone with its secrets, once the
// user has allowed the stack's commands. From the canvas, its end is said in the inbox.
import path from 'node:path';
import { confirm, flagValue, positional } from '../cli/output.ts';
import { appOn, storeOf } from '../core/stack.ts';
import { readClones, readStack } from '../data.ts';
import { fail, Failure } from '../failure.ts';
import { BIN } from '../paths.ts';
import { loadsCode } from '../safe-env.ts';
import { APPROVE, approved } from './checks.ts';
import { live } from './history.ts';
import { appendMessage } from './messages.ts';
import { startProcess } from './processes.ts';

const USAGE = 'usage: koppler do <app> <command> [--arg <name>=<value>]... [--env <env>] [--yes]';

/** The values given with --arg, checked against what the command asks for. */
interface Asked {
  name: string;
  type?: string | undefined;
  choices?: string[] | undefined;
  required?: boolean | undefined;
}
function argsFor(asked: Asked[], args: string[]): Record<string, string> {
  const given: Record<string, string> = {};
  args.forEach((arg, at) => {
    if (args[at - 1] !== '--arg') return;
    const cut = arg.indexOf('=');
    if (cut < 1) fail(`--arg takes <name>=<value> (got ${arg})`);
    given[arg.slice(0, cut)] = arg.slice(cut + 1);
  });
  for (const name of Object.keys(given))
    if (!asked.some(one => one.name === name))
      fail(`it takes no ${name}; it takes ${asked.map(one => one.name).join(', ') || 'nothing'}`);
  const kept: Record<string, string> = {};
  for (const one of asked) {
    if (loadsCode(one.name)) fail(`${one.name} cannot be given: it would make the runtime load other code`);
    const value = given[one.name] ?? '';
    if (!value) {
      if (one.required) fail(`it needs ${one.name}: --arg ${one.name}=<value>`);
      continue;
    }
    if (one.type === 'number' && !/^-?\d+(\.\d+)?$/.test(value)) fail(`${one.name} is a number (got ${value})`);
    if (one.type === 'choice' && !(one.choices ?? []).includes(value))
      fail(`${one.name} is one of ${(one.choices ?? []).join(', ')} (got ${value})`);
    kept[one.name] = value;
  }
  return kept;
}

async function doIt(args: string[], canvas: boolean): Promise<{ app: string; label: string }> {
  const [id = '', key = ''] = positional(args, ['--env', '--arg']);
  if (!id || !key) fail(USAGE);
  const stack = readStack() ?? fail('no stack loaded (koppler init)');
  const app = Object.hasOwn(stack.apps, id) ? stack.apps[id] : undefined;
  if (!app) fail(`${id} is not an app in the stack`);
  const commands = app.commands ?? {};
  const command = Object.hasOwn(commands, key) ? commands[key] : undefined;
  if (!command) fail(`${app.name} has no command ${key}; it has ${Object.keys(commands).join(', ') || 'none'}`);
  const show = command.show ?? 'both';
  if (show === (canvas ? 'cli' : 'canvas'))
    fail(`${command.label} is offered ${show === 'canvas' ? 'on the canvas' : 'with koppler do'} only`);
  if (!approved(stack.source ?? '', stack))
    fail(
      `${command.label} is a command from the stack that you have not allowed yet, or that changed since. Review it in your own terminal: ${APPROVE}`,
    );
  const given = argsFor(command.args ?? [], args);
  if (command.confirm && !(await confirm(command.confirm, args)))
    fail(`not run: ${command.confirm} Pass --yes to run it.`);
  const env = flagValue(args, '--env') ?? live()?.env ?? stack.envs[0] ?? '';
  if (!stack.envs.includes(env)) fail(`unknown env ${env}; the stack has ${stack.envs.join(', ')}`);
  if ((appOn(stack, id, env) ?? app).outside) fail(`${app.name} does not run on this Mac`);
  const repo = readClones()[id]?.path ?? fail(`${id} is not cloned (koppler sync --rescan after cloning)`);
  await startProcess({
    name: `${id}-${key}`.slice(0, 64).replace(/-+$/, ''),
    command: [path.join(BIN, 'with-secrets'), storeOf(stack, id, env), '--', 'sh', '-c', command.run],
    cwd: repo,
    restart: false,
    env,
    holdsSecrets: true,
    setEnv: given,
    once: { timeout: command.timeout ?? 1800 },
  });
  return { app: app.name, label: command.label };
}

/** `koppler do`: runs it and waits for it; from the canvas (--from-canvas), says how it ended in the inbox. */
export async function doCommand(args: string[]): Promise<void> {
  const canvas = args.includes('--from-canvas');
  try {
    const { app, label } = await doIt(args, canvas);
    if (canvas) appendMessage({ kind: 'result', title: `${label} finished on ${app}` });
  } catch (error) {
    if (canvas && error instanceof Failure && error.message) {
      const [first = '', ...rest] = error.message.split('\n');
      appendMessage({
        kind: 'failure',
        title: first.slice(0, 120),
        ...(rest.length && {
          sections: [{ title: 'Its last lines', items: rest.slice(-12).map(line => line.slice(0, 400)) }],
        }),
      });
    }
    throw error;
  }
}
