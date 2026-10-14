// `koppler shell <app>`: a shell in the app's clone with the settings its run starts it with (where the apps it calls
// answer), never its secrets. `--query` opens psql on its database instead, through the stored connection.
import { spawnSync } from 'node:child_process';
import path from 'node:path';
import { appOn, storeOf } from '../core/stack.ts';
import { readClones, readStack } from '../data.ts';
import { live } from '../engine/history.ts';
import { readRecord } from '../engine/processes.ts';
import { fail } from '../failure.ts';
import { CODE } from '../paths.ts';
import { flagValue, positional } from './output.ts';

const USAGE = 'usage: koppler shell <app> [--env <env>] [--query]';

export function shellCommand(args: string[]): void {
  const [id = ''] = positional(args, ['--env']);
  const stack = readStack() ?? fail('no stack loaded (koppler init)');
  const app = (Object.hasOwn(stack.apps, id) ? stack.apps[id] : undefined) ?? fail(USAGE);
  const env = flagValue(args, '--env') ?? live()?.env ?? stack.envs[0] ?? '';
  if (!stack.envs.includes(env)) fail(`unknown env ${env}; the stack has ${stack.envs.join(', ')}`);
  if (args.includes('--query')) {
    const secret = (appOn(stack, id, env)?.secrets ?? []).find(one => one.env && one.type === 'postgres');
    if (!secret?.env)
      fail(
        `${app.name} has no Postgres connection among its secrets on ${env.toUpperCase()}; for one query: koppler query ${id} --env ${env} "<sql>"`,
      );
    const store = storeOf(stack, id, env);
    const ran = spawnSync(process.execPath, [path.join(CODE, 'koppler.mjs'), 'secret', 'psql', store, secret.env], {
      stdio: 'inherit',
    });
    process.exit(ran.status ?? 1);
  }
  const repo = readClones()[id]?.path ?? fail(`${id} is not cloned (koppler sync --rescan after cloning)`);
  // Only what the run gave it beside its own environment: the addresses of what it calls, never a stored value.
  const given = readRecord(id)?.start?.setEnv ?? {};
  const names = Object.keys(given);
  console.log(
    `${app.name}, in ${repo}${names.length ? `, with ${names.join(', ')} as its run sets them` : ''}. Its secrets are not here. Type exit to leave.`,
  );
  const shell = process.env['SHELL'] || '/bin/sh';
  const ran = spawnSync(shell, ['-i'], {
    cwd: repo,
    stdio: 'inherit',
    env: { ...process.env, ...given, KOPPLER_APP: id, KOPPLER_ENV: env },
  });
  process.exit(ran.status ?? 0);
}
