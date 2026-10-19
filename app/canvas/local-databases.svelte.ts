// Where each database runs on this Mac, as the user gave it, and whether anything answers there. Kept by the server,
// never in the stack.
import type { LocalAddress } from '../src/core/databases.ts';
import { post } from './data.ts';

class LocalDatabases {
  addresses = $state.raw<Record<string, LocalAddress>>({});
  /** The last test of each database's local address: whether it answered, or `testing`. */
  answers = $state<Record<string, boolean | 'testing'>>({});
  #loaded: Promise<void> | undefined;

  load(): Promise<void> {
    this.#loaded ??= fetch('data/local-databases.json')
      .then(answer => (answer.ok ? (answer.json() as Promise<Record<string, LocalAddress> | null>) : null))
      .then(kept => {
        this.addresses = kept ?? {};
      })
      .catch(() => undefined);
    return this.#loaded;
  }
  /** Whether anything answers on that address. */
  async test(id: string, at: LocalAddress | undefined = this.addresses[id]): Promise<boolean | string> {
    if (!at) return false;
    this.answers[id] = 'testing';
    const said = await post<{ open: boolean }>('local-database-test', { id, ...at, database: at.database ?? '' });
    this.answers[id] = 'error' in said ? false : said.open;
    return 'error' in said ? said.error : said.open;
  }
  /** Keeps the address on this Mac; the reason when it was refused. */
  async keep(id: string, at: LocalAddress): Promise<string | null> {
    const said = await post<{ ok: true }>('local-database', { id, ...at, database: at.database ?? '' });
    if ('error' in said) return said.error;
    this.addresses = { ...this.addresses, [id]: at };
    return null;
  }
}
export const localDatabases = new LocalDatabases();

export const addressText = (at: LocalAddress) =>
  `${at.host}:${String(at.port)}${at.database ? ` · ${at.database}` : ''}`;
