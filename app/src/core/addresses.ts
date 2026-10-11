// Pointing a caller at an app that runs on this machine: the address a device reaches it at, what a browser front end
// needs from the API it calls, and the lines for a local env file.
import type { App } from './stack.ts';

/** Where a mobile app runs: a simulator or emulator on this machine, or a real phone. */
export interface Device {
  platform?: string;
  physical?: boolean;
}

/**
 * The host a device uses to reach this machine: the iOS simulator shares its network, the Android emulator sees it as
 * 10.0.2.2, and a real phone reaches it over Wi-Fi at the machine's network address (null when it has none).
 */
export function deviceHost(device: Device | null | undefined, lanIp?: string | null): string | null {
  if (!device || (device.platform === 'ios' && !device.physical)) return 'localhost';
  if (device.platform === 'android' && !device.physical) return '10.0.2.2';
  return lanIp ?? null;
}

export interface AddressOptions {
  lanIp?: string | null;
  /** The callee's plain http address, for a phone. */
  httpUrl?: string | null;
  /** The address the caller has for the deployed callee: its trailing slash, or lack of one, is kept. */
  like?: string | undefined;
}
export type LocalAddress =
  | { url: string; needsLan: boolean; note: string | undefined; error?: undefined }
  | { error: string; url?: undefined; needsLan?: undefined; note?: undefined };

/**
 * The address a caller on `device` uses for a local callee. A phone cannot trust this machine's development
 * certificate, so it gets the callee's plain http address, and the callee has to listen on the network.
 */
export function localAddress(
  callee: Pick<App, 'url'>,
  device?: Device | null,
  options: AddressOptions = {},
): LocalAddress {
  const phone = !!device?.physical;
  const base = phone && options.httpUrl ? options.httpUrl : callee.url;
  if (!base) return { error: 'the callee has no url in stack.json' };
  const host = deviceHost(device, options.lanIp);
  if (!host) return { error: "no network address for this Mac; connect to Wi-Fi, or pass the phone's reachable host" };
  const address = new URL(base);
  address.hostname = host;
  const slash = (options.like ?? callee.url ?? '').endsWith('/');
  const url = slash ? address.toString() : address.toString().replace(/\/$/, '');
  const untrusted = phone && !options.httpUrl && address.protocol === 'https:';
  const note = untrusted
    ? 'the callee has no http address; a phone will reject its development certificate'
    : undefined;
  return { url, needsLan: phone, note };
}

export interface BrowserChecks {
  /** Settings the callee has to be started with. */
  settings: { app: 'callee'; env: string; value: string }[];
  warnings: string[];
}
/**
 * What a browser front end needs from an API it calls locally: its own origin allowed (CORS), and no https page
 * calling http. `slot` numbers each browser caller of the same API, for settings written as `Origins__{n}`.
 */
export function browserChecks(
  callee: Pick<App, 'name' | 'url' | 'cors'>,
  callerUrl: string | null | undefined,
  slot = 0,
): BrowserChecks {
  const origin = callerUrl && URL.canParse(callerUrl) ? new URL(callerUrl).origin : null;
  const out: BrowserChecks = { settings: [], warnings: [] };
  const allow = callee.cors?.env;
  if (allow && origin)
    for (const env of [allow].flat())
      out.settings.push({ app: 'callee', env: env.replace('{n}', String(slot)), value: origin });
  else if (origin)
    out.warnings.push(
      `${callee.name ?? 'the API'} has no recorded CORS setting; the browser may block calls from ${origin}. Record it as "cors": { "env": "<setting>" } in stack.json.`,
    );
  if (callerUrl?.startsWith('https:') && callee.url?.startsWith('http:'))
    out.warnings.push("an https page cannot call an http API; use the API's https address or serve the page over http");
  return out;
}

/** The lines to put in a git-ignored local env file, which the framework reads on top of its .env. */
export function envFileChange(call: { file?: string; env?: string | string[] }, value: string) {
  return { file: call.file ?? '.env.local', lines: [call.env ?? []].flat().map(name => `${name}=${value}`) };
}
