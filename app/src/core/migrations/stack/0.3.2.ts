// 0.3.2: a call's `how` is one Koppler applies; one written in words becomes `unknown`, its words kept in `note`.
import type { Migration, Raw } from '../run.ts';

/** The ways of calling Koppler applied in 0.3.2, kept here as they were then. */
const HOWS = ['env', 'env-file', 'edit', 'secret', 'unknown'] as const;

const isObject = (value: unknown): value is Raw => typeof value === 'object' && value !== null && !Array.isArray(value);

export const howsKopplerApplies: Migration = {
  version: '0.3.2',
  about: 'A call whose how is written in words becomes how unknown, with those words kept as its note',
  up: (raw, say) => {
    const next = structuredClone(raw);
    const calls = (consumes: unknown, at: string) => {
      if (!isObject(consumes)) return;
      for (const [callee, call] of Object.entries(consumes)) {
        if (!isObject(call) || typeof call['how'] !== 'string' || (HOWS as readonly string[]).includes(call['how']))
          continue;
        const words = call['how'];
        const note = typeof call['note'] === 'string' && call['note'] ? `${call['note']} ${words}` : words;
        consumes[callee] = { ...call, how: 'unknown', note };
        say(`${at} -> ${callee}: how "${words}" kept as its note`);
      }
    };
    for (const [id, app] of Object.entries(isObject(next['apps']) ? next['apps'] : {})) {
      if (!isObject(app)) continue;
      calls(app['consumes'], id);
      for (const [env, overlay] of Object.entries(isObject(app['envs']) ? app['envs'] : {}))
        if (isObject(overlay)) calls(overlay['consumes'], `${id} on ${env}`);
    }
    return next;
  },
};
