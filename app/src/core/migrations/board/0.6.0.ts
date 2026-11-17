// 0.6.0: a feature's steps can carry a summary and values beside the note. Older boards need nothing; the version moves
// up so an older Koppler refuses these boards instead of dropping the two fields when it writes one back.
import type { Migration } from '../run.ts';

export const stepsCarrySummaryAndValues: Migration = {
  version: '0.6.0',
  about: 'Steps can carry a summary and values beside the note',
  up: raw => raw,
};
