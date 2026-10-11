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

test('apps that call each other in a loop share a layer', () => {
  const depth = layerDepths(['a', 'b', 'c'], calls('a>b', 'b>a', 'b>c'));
  expect(depth['a']).toBe(depth['b']);
  expect(depth['c']).toBe((depth['b'] ?? 0) + 1);
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
