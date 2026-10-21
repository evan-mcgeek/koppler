// 0.2.2: a stack names only apps it has, where koppler remove left a removed app on the team boards and in `after`.
import { withoutMissingApps } from '../../missing-apps.ts';
import type { Migration } from '../run.ts';

export const noRemovedApps: Migration = {
  version: '0.2.2',
  about: 'Takes out the mentions of apps the stack no longer has, on its team boards and in other apps',
  up: (raw, say) => {
    const next = withoutMissingApps(raw);
    if (JSON.stringify(next) !== JSON.stringify(raw)) say('mentions of removed apps taken out');
    return next;
  },
};
