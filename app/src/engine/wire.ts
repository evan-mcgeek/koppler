// A cable from one app to another: where the caller must point to reach the local callee, and how it picks that
// address (a setting, a line in an env file, an edit).
import path from 'node:path';
import { flagValue } from '../cli/output.ts';
import { fail } from '../failure.ts';
import { browserChecks, envFileChange, localAddress } from '../core/addresses.ts';
import { frameworkOf, type PackageJson } from '../core/frameworks.ts';
import { of as kindOf } from '../core/kinds.ts';
import { launchProfile } from '../core/launch.ts';
import type { App, Call } from '../core/stack.ts';
import { readClones, readStack, type Clone, type Registry } from '../data.ts';
import { readJson } from '../json-files.ts';
import { httpUrlOf, profilesOf } from './app-start.ts';
import { lanIp, resolveDevice } from './devices.ts';

type Clones = Record<string, Clone | null | undefined>;
/** What a cable comes to. */
export interface Wiring {
  from: string;
  to: string;
  how: string | undefined;
  /** The device a mobile caller runs on, in words. */
  device: string | null;
  /** The settings that carry the address, and the launch profile they go into. */
  env?: string | string[] | undefined;
  profile?: string;
  /** The file (and key in it) to edit, or the env file to add `lines` to. */
  file?: string;
  key?: string | undefined;
  lines?: string[];
  /** The address the caller is pointed at. */
  value: string;
  /** The callee has to listen on the network, for a phone. */
  needsLan: boolean;
  found: string | undefined;
  /** Settings the callee needs so a browser front end may call it. */
  cors: { app: 'callee'; env: string; value: string; profile: string }[];
  warnings: string[];
  note: string | undefined;
  /** The call as the stack records it. */
  call: Call;
}
export type Wired = (Wiring & { error?: undefined }) | { error: string };

const deviceWords = (device: { name: string; platform: string; physical: boolean }) =>
  `${device.name} (${device.physical ? 'phone' : device.platform === 'ios' ? 'iOS simulator' : 'Android emulator'})`;

/** Where a browser front end is served, when the stack does not say: its framework's usual port. */
function browserUrl(caller: App, clone: Clone | null | undefined): string | null {
  if (caller.url) return caller.url;
  if (!kindOf(caller).browser || !clone) return null;
  const pkg = readJson(path.join(clone.path, 'package.json')) as PackageJson | null;
  return `http://localhost:${String(frameworkOf(pkg)?.port ?? 3000)}`;
}

/** Where `from` must point to reach the local `to`, and how it picks that address; an error when it cannot be told. */
export function wireInfo(
  stack: Registry,
  clones: Clones,
  from: string,
  to: string,
  env: string,
  deviceSpec?: string,
): Wired {
  const caller = stack.apps[from];
  const callee = stack.apps[to];
  if (!caller) return { error: `${from} is not an app in the stack` };
  if (!callee) return { error: `${to} is not an app in the stack` };
  const found = stack.found?.[from]?.[to];
  const call: Call | undefined = caller.consumes?.[to] ?? (found ? { how: 'unknown', found } : undefined);
  if (!call)
    return { error: `${from} does not call ${to} as far as the stack knows (koppler sync finds unrecorded calls)` };

  const device = kindOf(caller).platforms ? resolveDevice(deviceSpec, caller) : null;
  const phone = !!device?.physical;
  const httpUrl = phone && clones[to] ? httpUrlOf(callee, clones[to].path, env) : null;
  const address = localAddress(callee, device, { lanIp: phone ? lanIp() : null, httpUrl, like: call.deployed });
  if (address.error !== undefined) return { error: `${from} -> ${to}: ${address.error}` };
  // A stack may pin an address per simulator or emulator; a phone always gets the worked-out one.
  const pinned =
    typeof call.value === 'string' ? call.value : phone || !device ? undefined : call.value?.[device.platform];
  const value = pinned ?? (call.path ? address.url.replace(/\/$/, '') + call.path : address.url);

  // A browser front end also needs the API to allow its origin (CORS), and no https page calling an http API. Each
  // browser caller of the same API gets a number, for settings written as `Origins__{n}`.
  const browserCallers = Object.entries(stack.apps).filter(([, app]) => kindOf(app).browser && app.consumes?.[to]);
  const slot = browserCallers
    .map(([id]) => id)
    .sort()
    .indexOf(from);
  const browser = kindOf(caller).browser
    ? browserChecks(callee, browserUrl(caller, clones[from]), Math.max(slot, 0))
    : { settings: [], warnings: [] };
  const profileFor = (app: App, id: string) => launchProfile(app, profilesOf(app, clones[id]?.path), env).local;
  return {
    from,
    to,
    how: call.how,
    device: device ? deviceWords(device) : null,
    ...(call.how === 'env' && { env: call.env, profile: profileFor(caller, from) }),
    ...(call.file && { file: call.file, key: call.key }),
    ...(call.how === 'env-file' && envFileChange(call, value)),
    value,
    needsLan: address.needsLan,
    found: call.found,
    cors: browser.settings.map(setting => ({ ...setting, profile: profileFor(callee, to) })),
    warnings: browser.warnings,
    note: [address.note, call.note].filter(Boolean).join(' ') || undefined,
    call,
  };
}

function print(caller: App, callee: App, wiring: Wiring): void {
  const { call, value } = wiring;
  console.log(`${caller.name} -> local ${callee.name}${wiring.device ? ` on ${wiring.device}` : ''}: ${value}`);
  const settings = [call.env ?? []]
    .flat()
    .map(name => `${name}=${value}`)
    .join(', ');
  if (call.how === 'env') console.log(`  set in ${wiring.profile ?? ''}: ${settings}`);
  else if (call.how === 'edit')
    console.log(`  edit ${call.file ?? ''}: ${call.key ?? ''} (mark it "koppler: do not commit")`);
  else if (call.how === 'secret')
    console.log(`  set over its secret when it starts: ${call.key ?? ''}=${value} (Stop takes it back)`);
  else if (call.how === 'env-file')
    console.log(
      `  write to ${wiring.file ?? ''} (git-ignored, read on top of .env): ${(wiring.lines ?? []).join(', ')}`,
    );
  else {
    const where = call.found ? `; found at ${call.found}` : '';
    console.log(
      `  how ${caller.name} picks this address is not recorded yet${where}: confirm in its repo, then record it with koppler stack set apps.<caller>.consumes.<callee>.how <how>`,
    );
  }
  if (wiring.needsLan) console.log(`  ${callee.name} must listen on the network: koppler run ${wiring.to} --lan`);
  for (const setting of wiring.cors)
    console.log(`  allow the browser origin in ${callee.name}'s ${setting.profile}: ${setting.env}=${setting.value}`);
  for (const warning of wiring.warnings) console.log(`  warning: ${warning}`);
  if (wiring.note) console.log(`  note: ${wiring.note}`);
}

const USAGE = 'usage: koppler plan --wire <caller> <callee> [--device ios|android|phone|<id>] [--json]';
/** `koppler plan --wire <caller> <callee>`: what one cable changes, in words or as JSON. */
export function wire(args: string[]): void {
  const stack = readStack() ?? fail('no stack loaded (koppler init)');
  const [from, to] = args.filter(
    (arg, at) => !arg.startsWith('--') && !['--device', '--env'].includes(args[at - 1] ?? ''),
  );
  const caller = from ? stack.apps[from] : undefined;
  if (!from || !to || !caller) fail(USAGE);
  const wired = wireInfo(
    stack,
    readClones(),
    from,
    to,
    flagValue(args, '--env') ?? stack.envs[0] ?? '',
    flagValue(args, '--device'),
  );
  if (wired.error !== undefined) fail(wired.error);
  const callee = stack.apps[to];
  if (!callee) fail(USAGE);
  if (args.includes('--json')) console.log(JSON.stringify({ ...wired, call: undefined }, null, 2));
  else print(caller, callee, wired);
}
