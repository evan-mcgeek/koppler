// 0.6.0: a feature's steps can carry a summary and values beside the note, and a proposal of both waiting for a yes.
// Older boards need nothing; the version moves up so an older Koppler refuses these boards instead of dropping the new
// fields when it writes one back.
import type { Migration } from '../run.ts';

export const stepsCarrySummaryAndValues: Migration = {
  version: '0.6.0',
  about: 'Steps can carry a summary and values beside the note',
  up: raw => raw,
};
