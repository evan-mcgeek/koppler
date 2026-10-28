// The mobile app has no port: Koppler looks for its process on booted iOS simulators and connected Android devices, and
// follows the log of one the user started from their IDE.
import { execFile } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { readClones, readStack } from '../data.ts';
import { runningNames } from '../engine/runs.ts';
import { live } from '../engine/history.ts';
import { CODE, stateDir } from '../paths.ts';

/** A mobile app found running on a simulator, emulator or phone. */
export interface MobileApp {
  platform?: 'ios' | 'android';
  device?: string;
  deviceId: string;
  pid: number;
  flavor?: string | null;
  /** Started by Koppler (`cli`) or from the IDE. */
  source?: 'ide' | 'cli';
}
/** How the stack names a mobile app on each platform. */
interface MobileIds {
  iosBundleId?: string | undefined;
  androidPackage?: string | undefined;
}

const MOBILE_INTERVAL_MS = 5000;
const run = (command: string, args: string[]) =>
  new Promise<string>(resolve => {
    execFile(command, args, { timeout: 4000, maxBuffer: 4 * 1024 * 1024 }, (error, stdout) => {
      resolve(error ? '' : stdout);
    });
  });
const flavorIn = (command: string) => /--flavor[= ](\S+)/.exec(command)?.[1] ?? null;

export async function findMobileApp({ iosBundleId, androidPackage }: MobileIds): Promise<MobileApp[]> {
  const found: MobileApp[] = [];
  if (iosBundleId) {
    let booted: { name: string; udid: string }[] = [];
    try {
      const listed = JSON.parse(await run('xcrun', ['simctl', 'list', 'devices', 'booted', '-j'])) as {
        devices: Record<string, typeof booted>;
      };
      booted = Object.values(listed.devices).flat();
    } catch {
      // No Xcode, or no simulator booted.
    }
    for (const simulator of booted) {
      const services = await run('xcrun', ['simctl', 'spawn', simulator.udid, 'launchctl', 'list']);
      const line = services.split('\n').find(one => one.includes(`UIKitApplication:${iosBundleId}[`));
      const pid = Number(line?.split(/\s+/)[0]);
      if (pid > 0) found.push({ platform: 'ios', device: simulator.name, deviceId: simulator.udid, pid });
    }
  }
  if (androidPackage) {
    const devices = (await run('adb', ['devices'])).split('\n').slice(1);
    const serials = devices
      .map(line => line.split('\t'))
      .flatMap(([id, state]) => (id && state?.trim() === 'device' ? [id] : []));
    for (const serial of serials) {
      const shell = (...args: string[]) => run('adb', ['-s', serial, 'shell', ...args]);
      const pid = Number((await shell('pidof', androidPackage)).trim().split(/\s+/)[0]);
      if (pid > 0) {
        const model = (await shell('getprop', 'ro.product.model')).trim();
        found.push({ platform: 'android', device: model || serial, deviceId: serial, pid });
      }
    }
  }
  const processes = (await run('ps', ['-Ao', 'command='])).split('\n');
  const runs = processes.filter(line => line.includes('flutter_tools') && / run( |$)/.test(line));
  for (const app of found) {
    const mine = runs.find(line => line.includes(app.deviceId)) ?? (runs.length === 1 ? runs[0] : undefined);
    if (!mine) continue;
    app.flavor = flavorIn(mine);
    app.source = mine.includes('--machine') ? 'ide' : 'cli';
  }
  return found;
}

const recordOf = (id: string): { command?: string } | null => {
  try {
    return JSON.parse(fs.readFileSync(path.join(stateDir(), 'procs', `${id}.json`), 'utf8')) as {
      command?: string;
    } | null;
  } catch {
    return null;
  }
};
/** An app Koppler launched keeps no `flutter run` attached, so its flavor and device come from Koppler's own record of the start. */
export function fromKoppler(id: string, found: MobileApp[], record = recordOf(id)): MobileApp[] {
  const command = record?.command ?? '';
  return found.map(app =>
    app.flavor || !command.includes(app.deviceId) ? app : { ...app, flavor: flavorIn(command), source: 'cli' },
  );
}

/** What was found for each mobile app at the last look. */
export const mobileState: Record<string, MobileApp[]> = {};
let checkedAt = 0;
/** Looks for the stack's mobile apps among `ids` again, at most every five seconds. */
export async function refreshMobile(ids: string[]): Promise<void> {
  if (Date.now() - checkedAt < MOBILE_INTERVAL_MS) return;
  checkedAt = Date.now();
  const apps = readStack()?.apps ?? {};
  for (const id of ids) {
    const mobile = apps[id]?.mobile as MobileIds | undefined;
    if (mobile) mobileState[id] = fromKoppler(id, await findMobileApp(mobile));
  }
  followIdeLogs();
}

const following = new Map<string, string>();
/**
 * A mobile app on the applied board that runs from the IDE: Koppler follows its output with `flutter logs` on that
 * device, so its card shows the app's own log instead of an older run's. Started once per device; Stop and revert
 * stops it too.
 */
function followIdeLogs(): void {
  const stack = readStack();
  const board = live()?.nodes ?? {};
  const running = runningNames();
  const clones = readClones();
  for (const [id, found] of Object.entries(mobileState)) {
    const ide = found.find(app => app.source === 'ide');
    const repo = clones[id]?.path;
    if (!ide || !board[id] || !repo || running.includes(id) || following.get(id) === ide.deviceId) continue;
    following.set(id, ide.deviceId);
    const fvm = (stack?.apps[id]?.['flutter'] as { fvm?: unknown } | undefined)?.fvm;
    const logs = [...(fvm ? ['fvm', 'flutter'] : ['flutter']), 'logs', '-d', ide.deviceId];
    const koppler = [path.join(CODE, 'koppler.mjs'), 'run', id, '--cwd', repo, '--keep-alive', '--', ...logs];
    execFile(process.execPath, koppler, { timeout: 30000 }, () => undefined);
  }
}
