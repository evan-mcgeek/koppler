import { expect, test } from 'vitest';
import {
  cableCurve,
  cablePath,
  endOffsets,
  orderSlots,
  sidePoint,
  throughPath,
  type Box,
  type Cable,
} from './cables.ts';

const cards: Record<string, Box> = {
  web: { x: 0, y: 0, w: 200, h: 100 },
  orders: { x: 0, y: 300, w: 200, h: 100 },
  payments: { x: 400, y: 300, w: 200, h: 100 },
  catalog: { x: 800, y: 300, w: 200, h: 100 },
};
const cardOf = (id: string) => cards[id];
const down = (from: string, to: string): Cable => ({ from, to, fromSide: 'bottom', toSide: 'top' });

test('a cable leaves and enters along its sockets, further out the longer it is', () => {
  const from = sidePoint(cards['web'] as Box, 'bottom');
  expect(from).toEqual({ x: 100, y: 100 });
  const [, out, into] = cableCurve(from, 'bottom', { x: 100, y: 300 }, 'top');
  expect(out).toEqual({ x: 100, y: 180 });
  expect(into).toEqual({ x: 100, y: 220 });
  expect(cablePath(from, 'bottom', { x: 100, y: 300 }, 'top')).toBe('M100,100 C100,180 100,220 100,300');
  // A free end, while a cable is being drawn, has no side to enter along.
  expect(cableCurve(from, 'bottom', { x: 100, y: 300 }, null)[2]).toEqual({ x: 100, y: 300 });
});

test('a cable with waypoints passes through each of them', () => {
  const path = throughPath({ x: 0, y: 0 }, 'right', { x: 300, y: 200 }, 'left', [{ x: 150, y: 20 }]);
  expect(path.startsWith('M0,0 L40,0')).toBe(true);
  expect(path).toContain(' 150,20 C');
  expect(path.endsWith(' 260,200 L300,200')).toBe(true);
});

test('Arrange orders the cables on a side by where their other end sits', () => {
  const cables = [down('web', 'catalog'), down('web', 'orders'), down('web', 'payments')];
  orderSlots(cables, id => cards[id] as Box);
  expect(cables.map(cable => [cable.to, cable.fromSlot])).toEqual([
    ['catalog', 2],
    ['orders', 0],
    ['payments', 1],
  ]);
});

test('cables on one side fan out around its middle, in their order; a lone cable sits on the port', () => {
  const cables = [down('web', 'catalog'), down('web', 'orders'), down('web', 'payments')];
  orderSlots(cables, id => cards[id] as Box);
  const { offset, onPort } = endOffsets(cables, { cardOf });
  expect([offset['1|from'], offset['2|from'], offset['0|from']]).toEqual([-26, 0, 26]);
  expect(onPort).toContainEqual({ id: 'orders', side: 'top' });
  expect(offset['1|to']).toBe(0);
});

test('tunnels under a card leave the free part of its bottom edge to the cables', () => {
  const coveredBelow = () => ({ covered: 100, atRight: false });
  const { offset, onPort } = endOffsets([down('web', 'orders')], { cardOf, coveredBelow });
  // The free stretch runs from 100 to 200: its middle is 50 right of the card's own.
  expect(offset['0|from']).toBe(50);
  expect(onPort).not.toContainEqual({ id: 'web', side: 'bottom' });
});

test('Arrange centres cables between two facing cards on the stretch they share, so they run straight across', () => {
  // Payments API reaches from 100 to 300 here: it shares 100 to 200 with Web Shop above it.
  const boxes: Record<string, Box> = { ...cards, payments: { x: 100, y: 300, w: 200, h: 100 } };
  const twice: Cable[] = [down('web', 'payments'), { from: 'payments', to: 'web', fromSide: 'top', toSide: 'bottom' }];
  orderSlots(twice, id => boxes[id] as Box);
  const { offset } = endOffsets(twice, { cardOf: id => boxes[id] });
  const at = (box: Box, by = 0) => box.x + box.w / 2 + by;
  expect(at(boxes['web'] as Box, offset['0|from'])).toBe(at(boxes['payments'] as Box, offset['0|to']));
  expect(at(boxes['web'] as Box, offset['1|to'])).toBe(at(boxes['payments'] as Box, offset['1|from']));
  expect(((offset['0|from'] ?? 0) + (offset['1|to'] ?? 0)) / 2).toBe(50);
});

test('a card that moves leaves every end where it is on its side', () => {
  const boxes: Record<string, Box> = { ...cards, payments: { x: 100, y: 300, w: 200, h: 100 } };
  const cables = [down('web', 'payments')];
  const drawn = () => endOffsets(cables, { cardOf: id => boxes[id] }).offset;
  // A cable just drawn sits on the middle of each side.
  expect(drawn()).toEqual({ '0|from': 0, '0|to': 0 });
  orderSlots(cables, id => boxes[id] as Box);
  const arranged = drawn();
  expect(arranged).toEqual({ '0|from': 50, '0|to': -50 });
  boxes['payments'] = { x: 400, y: 500, w: 200, h: 100 };
  expect(drawn()).toEqual(arranged);
});

test('ends that Arrange moved off the middle stay on a side that has become too short for it', () => {
  const cables: Cable[] = [{ ...down('web', 'orders'), fromShift: 500 }];
  expect(endOffsets(cables, { cardOf }).offset['0|from']).toBe(84);
});
