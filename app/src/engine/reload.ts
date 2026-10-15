// `koppler reload <app> [--restart]`: hot reload a Flutter app Koppler runs, through the signals `flutter run` takes.
import fs from 'node:fs';
import { positional } from '../cli/output.ts';
import { fail, Failure } from '../failure.ts';
import { flutterPid } from './app-start.ts';
import { NAME } from './processes.ts';

/** Sends hot reload (or with `restart`, hot restart) to the app's `flutter run`; says what it did. */
export function hotReload(app: string, restart: boolean): string {
  if (!NAME.test(app)) throw new Failure(`${app} is not an app`);
  let pid: number;
  try {
    pid = Number(fs.readFileSync(flutterPid(app), 'utf8').trim());
  } catch {
    throw new Failure(
      `${app} is not a Flutter app Koppler runs: start it with Koppler (Started by Koppler) to reload it`,
    );
  }
  try {
    process.kill(pid, restart ? 'SIGUSR2' : 'SIGUSR1');
  } catch {
    throw new Failure(`${app} no longer runs`);
  }
  return `${restart ? 'Hot restarted' : 'Hot reloaded'} ${app}`;
}

export function reloadCommand(args: string[]): void {
  const [app] = positional(args);
  if (!app) fail('usage: koppler reload <app> [--restart]');
  console.log(hotReload(app, args.includes('--restart')));
}
