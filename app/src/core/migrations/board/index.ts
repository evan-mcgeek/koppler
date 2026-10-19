// A board's format, wherever the board is kept: the stack's team boards, the user's own, a shared board file. One
// migration for each Koppler version that changed it, oldest first.
import { migrate, type Format, type Raw } from '../run.ts';
import { everyAppSaysHowItRuns } from './0.1.0.ts';

export const BOARD_FORMAT: Format = {
  name: 'The board',
  key: 'koppler',
  version: '0.1.0',
  migrations: [everyAppSaysHowItRuns],
  // Before it said its Koppler version, a board numbered its format: 1 is 0.1.0's.
  legacy: raw => (raw['version'] === 1 ? '0.1.0' : undefined),
};

export const migrateBoard = (raw: Raw) => migrate(raw, BOARD_FORMAT);
