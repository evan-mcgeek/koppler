// Which host each stored key may be sent to, to test it: the user's own choice on this Mac, never the stack's.
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
/** One secret, in one store, that may go to one host. */
export interface Approval {
  store: string;
  name: string;
  host: string;
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

export const isApproved = (store: string, name: string, host: string): boolean =>
  read().some(a => same(a, store, name) && a.host === host.toLowerCase());

export function approve(store: string, name: string, host: string): void {
  const lower = host.toLowerCase();
  locked(file(), () => {
    const keys = read().filter(a => !(same(a, store, name) && a.host === lower));
    write([...keys, { store, name, host: lower }]);
  });
}

/** Takes back every host this secret was approved for. */
export function revoke(store: string, name: string): void {
  locked(file(), () => {
    write(read().filter(a => !same(a, store, name)));
  });
}
