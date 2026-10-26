import Bundled from 'elkjs/lib/elk.bundled.js';
import type { ELK } from 'elkjs/lib/elk-api.js';
import { describe, expect, it } from 'vitest';
import { along, DIRECTIONS, layOut } from './layout.ts';

// In one process here; the page runs the same engine in a worker.
const elk = new (Bundled as unknown as new () => ELK)();

// A map like a real one: events into handlers, an API, what it writes to, down to the phone, and calls back up.
const names = [
  'bus-a',
  'bus-b',
  'handler',
  'support',
  'api',
  'topic',
  'db',
  'queue',
  'pusher',
  'push',
  'app',
  'mobile-api',
];
const cards = names.map(id => ({ id, w: 200, h: id === 'support' ? 80 : 64 }));
const pairs = [
  ['bus-a', 'handler'],
  ['bus-b', 'handler'],
  ['bus-a', 'api'],
  ['bus-b', 'api'],
  ['handler', 'api'],
  ['support', 'api'],
  ['handler', 'mobile-api'],
  ['api', 'topic'],
  ['api', 'db'],
  ['api', 'queue'],
  ['queue', 'pusher'],
  ['pusher', 'api'],
  ['pusher', 'push'],
  ['push', 'app'],
  ['app', 'api'],
  ['app', 'mobile-api'],
  ['mobile-api', 'api'],
];
const links = pairs.map(([from = '', to = '']) => ({ id: `${from}>${to}`, from, to }));

describe('layOut', () => {
  for (const direction of DIRECTIONS)
    it(`${direction}: no two cards overlap, and no link runs behind a card`, async () => {
      const { at, routes } = await layOut(cards, links, direction, elk);
      const box = (id: string) => ({ ...(at[id] ?? { x: 0, y: 0 }), w: 200, h: id === 'support' ? 80 : 64 });
      for (const [i, a] of names.entries())
        for (const b of names.slice(i + 1)) {
          const [p, q] = [box(a), box(b)];
          const apart = p.x + p.w <= q.x || q.x + q.w <= p.x || p.y + p.h <= q.y || q.y + q.h <= p.y;
          expect(apart, `${a} and ${b}`).toBe(true);
        }
      expect(Object.keys(routes).sort()).toEqual(links.map(link => link.id).sort());
      for (const { id, from, to } of links) {
        const route = routes[id] ?? [];
        const inside = names
          .filter(name => name !== from && name !== to)
          .filter(name => {
            const b = box(name);
            return Array.from({ length: 49 }, (_, n) => along(route, (n + 1) / 50)).some(
              ({ x, y }) => x > b.x + 1 && x < b.x + b.w - 1 && y > b.y + 1 && y < b.y + b.h - 1,
            );
          });
        expect(inside, id).toEqual([]);
        // It leaves and reaches its cards on their edges.
        const [start, end] = [route[0], route.at(-1)];
        const on = (p: typeof start, b: ReturnType<typeof box>) =>
          !!p && p.x >= b.x - 1 && p.x <= b.x + b.w + 1 && p.y >= b.y - 1 && p.y <= b.y + b.h + 1;
        expect(on(start, box(from)) && on(end, box(to)), id).toBe(true);
      }
    });

  it('gives the same layout for the same map', async () => {
    expect(await layOut(cards, links, 'RIGHT', elk)).toEqual(await layOut(cards, links, 'RIGHT', elk));
  });
});
