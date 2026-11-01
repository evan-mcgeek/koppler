// What a stack has that its shared copy does not, card by card, for the map.
import type { Card } from './discover.ts';

type Entries = Record<string, unknown> | undefined;
export interface CardChange {
  /** Not in the shared stack at all. */
  added: boolean;
  /** Its fields that differ, when it is in both. */
  fields: string[];
}

const same = (a: unknown, b: unknown) => JSON.stringify(a) === JSON.stringify(b);
const SECTIONS: [string, (id: string) => Card][] = [
  ['apps', id => id],
  ['queues', id => `queue:${id}`],
  ['databases', id => `database:${id}`],
  ['resources', id => `resource:${id}`],
];

/** The cards added or changed in `now` since `base`; a card removed has nothing on the map to mark. */
export function cardChanges(base: Record<string, unknown>, now: Record<string, unknown>): Record<Card, CardChange> {
  const out: Record<Card, CardChange> = {};
  for (const [section, card] of SECTIONS) {
    const before = (base[section] ?? {}) as Record<string, Entries>;
    for (const [id, entry] of Object.entries((now[section] ?? {}) as Record<string, Entries>)) {
      const was = before[id];
      if (!was) out[card(id)] = { added: true, fields: [] };
      else if (!same(was, entry)) {
        const keys = [...new Set([...Object.keys(was), ...Object.keys(entry ?? {})])];
        out[card(id)] = { added: false, fields: keys.filter(key => !same(was[key], entry?.[key])) };
      }
    }
  }
  return out;
}
