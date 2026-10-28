// `koppler reload <app> [--restart]`: hot reload a Flutter app Koppler runs, through the signals `flutter run` takes.
import fs from 'node:fs';
import { positional } from '../cli/output.ts';
import { fail, Failure } from '../failure.ts';
import { flutterPid } from './app-start.ts';
import { alive, NAME, readRecord } from './processes.ts';

/** The process id of the app's `flutter run`, written once the app is on the device. */
function flutterRunPid(app: string): number | null {
  try {
    return Number(fs.readFileSync(flutterPid(app), 'utf8').trim()) || null;
  } catch {
    return null;
  }
}

/** Whether the app's `flutter run` is there to take a hot reload. */
export function reloadable(app: string): boolean {
  const pid = flutterRunPid(app);
  if (!pid) return false;
  try {
    process.kill(pid, 0);
    return true;
  } catch {
    return false;
  }
}

/** Sends hot reload (or with `restart`, hot restart) to the app's `flutter run`; says what it did. */
export function hotReload(app: string, restart: boolean): string {
  if (!NAME.test(app)) throw new Failure(`${app} is not an app`);
  const pid = flutterRunPid(app);
  if (!pid) {
    const record = readRecord(app);
    throw new Failure(
      record && alive(record)
        ? `${app} is still starting: hot reload works once flutter run has put it on the device`
        : `${app} is not a Flutter app Koppler runs: start it with Koppler (Started by Koppler) to reload it`,
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
