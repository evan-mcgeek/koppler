// `koppler invoke`: one function of a SAM app, run once with an event, as `koppler run` would start the app.
import fs from 'node:fs';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { readStack } from '../data.ts';
import { appStart } from '../engine/app-start.ts';
import { live } from '../engine/history.ts';
import { readRecord } from '../engine/processes.ts';
import { fail } from '../failure.ts';
import { appEnv } from '../safe-env.ts';
import { flagValue, positional } from './output.ts';

const USAGE = 'usage: koppler invoke <app> <function> [--event <file>] [--env <env>]';

export function invoke(args: string[]): void {
  const [id, name] = positional(args, ['--event', '--env']);
  if (!id || !name) fail(USAGE);
  const app = readStack()?.apps[id] ?? fail(`${id} is not an app in the stack`);
  if (app.kind !== 'sam') fail(`${id} is not a SAM app: koppler invoke runs a function of a SAM app`);
  const given = flagValue(args, '--event');
  const event = given && path.resolve(given);
  if (event && !fs.existsSync(event)) fail(`no event file at ${event}`);
  // As `koppler shell`: the running board's environment, and the settings the running app was started with.
  const env = flagValue(args, '--env') ?? live()?.env ?? undefined;
  const setEnv = readRecord(id)?.start?.setEnv ?? {};
  const start = appStart(id, { name: id, command: [], restart: false, setEnv, ...(env && { env }) }) ?? fail(USAGE);
  // The same start as `koppler run`, secrets included, with the runner told to invoke instead of serve.
  const at = start.command.findIndex(word => word.endsWith('sam-local.mjs'));
  const config = start.command[at + 2];
  if (at < 0 || config === undefined)
    fail(`${id} has a start of its own in the stack, so it has no functions to invoke`);
  const [program = '', ...rest] = [
    ...start.command.slice(0, at + 1),
    'invoke',
    name,
    config,
    ...(event ? [event] : []),
  ];
  const ran = spawnSync(program, rest, { cwd: start.cwd, stdio: 'inherit', env: { ...appEnv().env, ...setEnv } });
  process.exitCode = ran.status ?? 1;
}
