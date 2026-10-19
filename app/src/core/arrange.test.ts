import { expect, test } from 'vitest';
import { arrange, layerDepths, layoutBox, sidesFor, type Point } from './arrange.ts';

const card = () => ({ w: 200, h: 100 });
const calls = (...pairs: string[]) =>
  pairs.map(pair => {
    const [from = '', to = ''] = pair.split('>');
    return { from, to };
  });

test('callers sit above the apps they call', () => {
  expect(layerDepths(['api', 'web', 'db'], calls('web>api', 'api>db'))).toEqual({ web: 0, api: 1, db: 2 });
  const pos = arrange(['api', 'web', 'db'], calls('web>api', 'api>db'), card, 'down', false, { pad: 24 });
  expect(pos['web']?.y).toBeLessThan(pos['api']?.y ?? 0);
  expect(pos['api']?.y).toBeLessThan(pos['db']?.y ?? 0);
});

test('a loop is laid out from where it is entered, the link that closes it going back up', () => {
  // The way in is the card nothing leads to; inside the loop the cards follow its order.
  expect(layerDepths(['b', 'a', 'c', 'entry'], calls('entry>a', 'a>b', 'b>c', 'c>a'))).toEqual({
    entry: 0,
    a: 1,
    b: 2,
    c: 3,
  });
  // A loop with no way in starts at the card that reaches the most.
  const depth = layerDepths(['a', 'b', 'c'], calls('a>b', 'b>a', 'b>c'));
  expect([depth['a'], depth['b'], depth['c']]).toEqual([0, 1, 2]);
});

test('a card that only feeds a queue sits just above it, and the queue just above its reader', () => {
  // The app's own path: web, api, orders, payments; a notifier feeds payments through a queue.
  const depth = layerDepths(
    ['notifier', 'queue:paid', 'web', 'api', 'orders', 'payments'],
    calls('web>api', 'api>orders', 'orders>payments', 'notifier>queue:paid', 'queue:paid>payments'),
  );
  expect(depth).toEqual({ web: 0, api: 1, orders: 2, payments: 3, 'queue:paid': 2, notifier: 1 });
});

test('a layer is ordered so that cables do not cross', () => {
  // Written crossed: a calls y, b calls x, with x before y.
  const pos = arrange(['a', 'b', 'x', 'y'], calls('a>y', 'b>x'), card, 'down', false, { pad: 0 });
  const leftToRight = (first: string, second: string) => (pos[first]?.x ?? 0) < (pos[second]?.x ?? 0);
  expect(leftToRight('a', 'b')).toBe(leftToRight('y', 'x'));
});

test('across the board the layers become columns, and the tight form takes less room', () => {
  const edges = calls('web>api');
  const across = arrange(['web', 'api'], edges, card, 'right', false, { pad: 0 });
  expect(across['web']?.x).toBeLessThan(across['api']?.x ?? 0);
  expect(across['web']?.y).toBe(across['api']?.y);
  const loose = layoutBox(arrange(['web', 'api'], edges, card, 'down', false, { pad: 0 }), card);
  const tight = layoutBox(arrange(['web', 'api'], edges, card, 'down', false, { pad: 0, tight: true }), card);
  expect(tight.h).toBeLessThan(loose.h);
});

test('a mirrored layout is the same one read the other way round', () => {
  const ids = ['top', 'left', 'right'];
  const edges = calls('top>left', 'top>right');
  const plain = arrange(ids, edges, card, 'down', false, { pad: 0 });
  const mirrored = arrange(ids, edges, card, 'down', true, { pad: 0 });
  expect(mirrored['left']?.x).toBe(plain['right']?.x);
  expect(mirrored['right']?.x).toBe(plain['left']?.x);
});

test('a cable leaves and enters on the sides that face each other, unless a side is kept for something else', () => {
  const pos: Record<string, Point> = { a: { x: 0, y: 0 }, below: { x: 0, y: 400 }, beside: { x: 600, y: 0 } };
  expect(sidesFor(pos, { from: 'a', to: 'below' }, 'down', card)).toEqual({ fromSide: 'bottom', toSide: 'top' });
  expect(sidesFor(pos, { from: 'a', to: 'beside' }, 'down', card)).toEqual({ fromSide: 'right', toSide: 'left' });
  expect(sidesFor(pos, { from: 'beside', to: 'a' }, 'down', card)).toEqual({ fromSide: 'left', toSide: 'right' });
  // The bottom of `a` is kept for its tunnels: the cable takes the other pair of sides.
  expect(sidesFor(pos, { from: 'a', to: 'below' }, 'down', card, { a: 'bottom' })).toEqual({
    fromSide: 'right',
    toSide: 'left',
  });
});

test('cards in a chain line up, so their cables run straight, whatever their sizes', () => {
  const sizes: Record<string, { w: number; h: number }> = {
    app: { w: 200, h: 80 },
    api: { w: 240, h: 300 },
    pay: { w: 200, h: 120 },
    wallet: { w: 200, h: 90 },
  };
  const size = (id: string) => sizes[id] ?? card();
  // The api also calls a customer service, so the pay column has two cards and the wallet's has one.
  const ids = ['app', 'api', 'pay', 'customer', 'wallet'];
  const pos = arrange(ids, calls('app>api', 'api>pay', 'api>customer', 'pay>wallet'), size, 'right', false, {
    pad: 0,
  });
  const middle = (id: string) => (pos[id]?.y ?? 0) + size(id).h / 2;
  expect(middle('app')).toBe(middle('api'));
  expect(middle('pay')).toBe(middle('wallet'));
  expect(middle('api')).toBe((middle('pay') + middle('customer')) / 2);
});

test('a card lines up on its own middle, not on the room kept beside it', () => {
  // The api's queue stacks under it: it is given that room, and lines up by the card itself.
  const size = (id: string) => (id === 'api' ? { w: 200, h: 260 } : card());
  const pos = arrange(['web', 'api'], calls('web>api'), size, 'right', false, { pad: 0, anchor: () => 50 });
  expect(pos['web']?.y).toBe(pos['api']?.y);
});

test('a card called by two sits between them, and no two cards ever overlap', () => {
  const pos = arrange(['a', 'b', 'c'], calls('a>c', 'b>c'), card, 'right', false, { pad: 0 });
  const middle = (id: string) => (pos[id]?.y ?? 0) + 50;
  expect(middle('c')).toBe((middle('a') + middle('b')) / 2);
  // Boards of every shape, in every layout: cards of their own sizes never cover one another.
  let seed = 7;
  const random = () => (seed = (seed * 16807) % 2147483647) / 2147483647;
  for (let board = 0; board < 60; board++) {
    const ids = Array.from({ length: 4 + Math.floor(random() * 12) }, (_, n) => `c${String(n)}`);
    const sizes = Object.fromEntries(
      ids.map(id => [id, { w: 120 + Math.round(random() * 200), h: 50 + Math.round(random() * 250) }]),
    );
    const edges = ids.flatMap((from, n) =>
      ids
        .slice(n + 1)
        .filter(() => random() < 0.25)
        .map(to => ({ from, to })),
    );
    for (const [dir, mirror] of [
      ['down', false],
      ['down', true],
      ['right', false],
      ['right', true],
    ] as const) {
      const at = arrange(ids, edges, id => sizes[id] ?? card(), dir, mirror, { pad: 24 });
      for (const [n, a] of ids.entries())
        for (const b of ids.slice(n + 1)) {
          const p = at[a] as Point;
          const q = at[b] as Point;
          const s = sizes[a] ?? card();
          const t = sizes[b] ?? card();
          const apart = p.x + s.w <= q.x || q.x + t.w <= p.x || p.y + s.h <= q.y || q.y + t.h <= p.y;
          expect(apart, `${a} and ${b} overlap (${dir}${mirror ? ', mirrored' : ''})`).toBe(true);
        }
    }
  }
});
