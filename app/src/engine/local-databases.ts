// Where each database of the stack runs on this Mac, as the user gave it: kept with the stack's own files on this Mac,
// never in the shared stack.
import { readData, readStack, writeData } from '../data.ts';
import { fail } from '../failure.ts';
import type { LocalAddress } from '../core/databases.ts';

const HOST = /^[a-z0-9.-]{1,253}$/i;
const NAME = /^[\w.-]{1,128}$/;

/** Every local address kept, by database id. */
export function localAddresses(): Record<string, LocalAddress> {
  const kept = readData('local-databases') ?? {};
  return Object.fromEntries(
    Object.entries(kept).flatMap(([id, at]) => {
      const one = at as Partial<LocalAddress> | null;
      return one && typeof one.host === 'string' && typeof one.port === 'number' ? [[id, one as LocalAddress]] : [];
    }),
  );
}

/** Checks an address before it is kept; the reason it is refused, or null. */
export function addressProblem(at: Partial<LocalAddress>): string | null {
  if (typeof at.host !== 'string' || !HOST.test(at.host)) return 'a host name such as localhost';
  if (typeof at.port !== 'number' || !Number.isInteger(at.port) || at.port < 1 || at.port > 65535)
    return 'a port number from 1 to 65535';
  if (at.database !== undefined && (typeof at.database !== 'string' || !NAME.test(at.database)))
    return 'a database name of letters, digits, dots, dashes and underscores';
  return null;
}

/** Keeps a database's local address, or forgets it with null. */
export function keepAddress(id: string, at: LocalAddress | null): void {
  const { [id]: _was, ...rest } = localAddresses();
  writeData('local-databases', at ? { ...rest, [id]: at } : rest);
}

/** Reads `host:port[/database]`. */
export function parseAddress(text: string): Partial<LocalAddress> {
  const [, host, port, database] = /^([^:/]+):(\d+)(?:\/(.+))?$/.exec(text) ?? [];
  return host && port ? { host, port: Number(port), ...(database && { database }) } : {};
}

/** `koppler db`: the stack's databases and where each runs on this Mac; `local <id> <address>` or `--clear` sets one. */
export function dbCommand(args: string[]): void {
  const stack = readStack() ?? fail('no stack loaded (koppler init)');
  const databases = stack.databases ?? {};
  const [form, id, address] = args.filter(arg => !arg.startsWith('--'));
  if (form === 'local') {
    const database = id ? databases[id] : undefined;
    if (!id || !database)
      fail(
        `usage: koppler db local <database> <host:port[/database]> | --clear; one of ${Object.keys(databases).join(', ') || 'none'}`,
      );
    if (args.includes('--clear')) {
      keepAddress(id, null);
      console.log(`${database.name ?? id}: no local address now`);
      return;
    }
    const at = parseAddress(address ?? '');
    const problem = addressProblem(at);
    if (problem) fail(`${address ?? 'the address'}: needs host:port[/database], with ${problem}`);
    keepAddress(id, at as LocalAddress);
    console.log(`${database.name ?? id}: local at ${String(address)}, kept on this Mac only`);
    return;
  }
  if (form) fail('usage: koppler db [local <database> <host:port[/database]> | local <database> --clear]');
  const kept = localAddresses();
  if (!Object.keys(databases).length) console.log('The stack names no databases.');
  for (const [key, database] of Object.entries(databases)) {
    const users = Object.keys(stack.apps).filter(app => stack.apps[app]?.uses?.[key]);
    const at = kept[key];
    const local = at ? `${at.host}:${String(at.port)}${at.database ? `/${at.database}` : ''}` : 'no local address';
    console.log(
      `${key}  ${database.name ?? key} (${database.kind ?? 'database'})  used by ${users.join(', ') || 'no app'}  ${local}`,
    );
  }
}
