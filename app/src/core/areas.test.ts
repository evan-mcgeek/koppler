import { expect, test } from 'vitest';
import { boardArea, inAreas } from './areas.ts';

const areas = { payments: { name: 'Payments' }, shipping: { name: 'Shipping' }, accounts: { name: 'Accounts' } };
const apps = {
  web: {},
  orders: { areas: ['payments', 'shipping'] },
  pay: { areas: ['payments'] },
  basket: { areas: ['payments'] },
  ship: { areas: ['shipping'] },
  carrier: { areas: ['shipping'] },
  signup: { areas: ['accounts'] },
};
const stack = { areas, apps };
const board = (ids: string[], area?: string) => ({
  nodes: Object.fromEntries(ids.map(id => [id, {}])),
  ...(area && { area }),
});

test("a board's area is the one most of its apps are in, counting only apps that have one", () => {
  expect(boardArea(stack, board(['web', 'pay', 'basket', 'ship']))).toEqual({ id: 'payments', by: 'apps' });
});

test('a tie goes to the smaller area, then to the first in the stack', () => {
  // Payments has 3 apps, Shipping 3, Accounts 1.
  expect(boardArea(stack, board(['pay', 'signup']))).toEqual({ id: 'accounts', by: 'apps' });
  expect(boardArea(stack, board(['pay', 'ship']))).toEqual({ id: 'payments', by: 'apps' });
});

test('a board set by hand keeps its area; one of only shared apps has none', () => {
  expect(boardArea(stack, board(['pay'], 'accounts'))).toEqual({ id: 'accounts', by: 'hand' });
  expect(boardArea(stack, board(['web']))).toEqual({ by: 'apps' });
  // A hand-set area the stack no longer has falls back to the apps.
  expect(boardArea(stack, board(['pay'], 'gone'))).toEqual({ id: 'payments', by: 'apps' });
});

test('an app shows when it is in a chosen area or in none; no choice shows every app', () => {
  expect(inAreas(apps.web, ['shipping'])).toBe(true);
  expect(inAreas(apps.orders, ['shipping'])).toBe(true);
  expect(inAreas(apps.pay, ['shipping'])).toBe(false);
  expect(inAreas(apps.pay, undefined)).toBe(true);
  expect(inAreas(apps.pay, [])).toBe(true);
});
