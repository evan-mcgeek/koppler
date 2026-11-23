// Where each stored key may be sent, to test it: the user's own choice on this Mac, never the stack's.
import path from 'node:path';
import { migrate, type Format } from './core/migrations/run.ts';
import { locked, writeJson } from './json-files.ts';
import { configDir } from './paths.ts';
import { readUpgraded } from './upgraded.ts';

export const APPROVALS_FORMAT: Format = {
  name: 'The approvals file',
  key: 'koppler',
  version: '0.6.3',
  migrations: [],
};
/** One secret, in one store, that may be sent to this exact probe: its url, and the header it goes in (none: bearer). */
export interface Approval {
  store: string;
  name: string;
  url: string;
  header?: string;
}
export interface Probe {
  url: string;
  header?: string | undefined;
}

const file = () => path.join(configDir(), 'approvals.json');
const read = (): Approval[] => {
  const { value, error } = readUpgraded(file(), raw => migrate(raw, APPROVALS_FORMAT));
  if (error !== undefined) throw new Error(error);
  return Array.isArray(value?.['keys']) ? (value['keys'] as Approval[]) : [];
};
const write = (keys: Approval[]) => {
  writeJson(file(), { koppler: APPROVALS_FORMAT.version, keys });
};
const same = (a: Approval, store: string, name: string) => a.store === store && a.name === name;
// A header name is the same header in any case; the url must match exactly.
const headerOf = (header: string | undefined) => (header ?? '').toLowerCase();

/** Whether the user approved sending this secret to exactly this probe; any change to it asks again. */
export const isApproved = (store: string, name: string, probe: Probe): boolean =>
  read().some(a => same(a, store, name) && a.url === probe.url && headerOf(a.header) === headerOf(probe.header));

/** Approves the probe the stack names now, in place of any earlier one for this secret. */
export function approve(store: string, name: string, probe: Probe): void {
  locked(file(), () => {
    const keys = read().filter(a => !same(a, store, name));
    write([...keys, { store, name, url: probe.url, ...(probe.header && { header: probe.header }) }]);
  });
}

/** Takes back the approval of this secret. */
export function revoke(store: string, name: string): void {
  locked(file(), () => {
    write(read().filter(a => !same(a, store, name)));
  });
}
