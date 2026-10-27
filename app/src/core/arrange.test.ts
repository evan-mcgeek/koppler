import { expect, test } from 'vitest';
import { sidesFor, type Point } from './arrange.ts';

const card = () => ({ w: 200, h: 100 });

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
