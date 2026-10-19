// The board file: what the canvas keeps per stack on this Mac (the board on screen, the user's own boards, the view).
// One migration for each Koppler version that changed it, oldest first; the boards inside it are boards
// (migrations/board).
import { migrate, type Format, type Raw } from '../run.ts';

export const BOARD_FILE_FORMAT: Format = {
  name: 'The board file',
  key: 'koppler',
  // 0.2.0 added which databases run locally and, per app, whether its database lines go through the tunnel card.
  version: '0.2.0',
  migrations: [],
};

export const migrateBoardFile = (raw: Raw) => migrate(raw, BOARD_FILE_FORMAT);
