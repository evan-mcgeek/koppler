// Each of Koppler's files as this Koppler reads it: brought up to its format, with the boards it holds in the board
// format. Pure; reading from disk and writing back is the caller's.
import { migrate as migrateBoard } from '../presets.ts';
import { migrateBoardFile } from './board-file/index.ts';
import type { Raw } from './run.ts';
import { migrateStack } from './stack/index.ts';

export type Upgrade = (raw: Raw) => { value: Raw; error?: undefined } | { error: string; value?: undefined };

/** The boards under these keys, each in the board format; one that is not a board is kept as it is. */
const withBoards = (raw: Raw, keys: string[]): Raw => ({
  ...raw,
  ...Object.fromEntries(
    keys.flatMap(key => {
      const list = raw[key];
      return Array.isArray(list) ? [[key, list.map((one: unknown) => migrateBoard(one).preset ?? one)]] : [];
    }),
  ),
});

/** The stack, and its team boards. */
export const upgradeStack: Upgrade = raw => {
  const done = migrateStack(raw);
  return done.error === undefined ? { value: withBoards(done.value, ['presets']) } : done;
};
/** The board file, and the user's own boards in it, kept and deleted. */
export const upgradeBoardFile: Upgrade = raw => {
  const done = migrateBoardFile(raw);
  return done.error === undefined ? { value: withBoards(done.value, ['presets', 'trash']) } : done;
};
