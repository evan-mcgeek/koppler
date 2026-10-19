// The stack's format: one migration for each Koppler version that changed it, oldest first. A new one goes last, in a
// file named for the version that introduces it, and the format's version moves to it.
import { migrate, type Format, type Raw } from '../run.ts';
import { databasesNamedOnce } from './0.2.0.ts';

export const STACK_FORMAT: Format = {
  name: 'The stack',
  key: 'koppler',
  version: '0.2.0',
  migrations: [databasesNamedOnce],
};

/** A stack as written, in this Koppler's format: what every reader of the stack works with. */
export const migrateStack = (raw: Raw) => migrate(raw, STACK_FORMAT);
