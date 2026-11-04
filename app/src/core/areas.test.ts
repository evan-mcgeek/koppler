import { expect, test } from 'vitest';
import { appGroups, boardArea, boardGroups, inAreas } from './areas.ts';

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

const shop = {
  areas: { payments: { name: 'Payments' }, shipping: { name: 'Shipping' }, accounts: { name: 'Accounts' } },
  apps: {
    web: {},
    mobile: {},
    orders: { areas: ['payments', 'shipping'] },
    pay: { areas: ['payments'] },
    ship: { areas: ['shipping'] },
    signup: { areas: ['accounts'] },
  },
};

test('with no choice, or every area on, nothing is grouped or hidden', () => {
  expect(appGroups(shop, Object.keys(shop.apps), [], undefined)).toBeNull();
  expect(appGroups(shop, Object.keys(shop.apps), [], ['payments', 'shipping', 'accounts'])).toBeNull();
});

test("apps group by the chosen areas, then no area; one in two areas lists once, with the other; the board's own always show", () => {
  const ids = ['mobile', 'orders', 'pay', 'ship', 'signup', 'web'];
  expect(appGroups(shop, ids, ['signup'], ['payments'])).toEqual({
    groups: [
      { title: 'On this board', apps: [{ id: 'signup', also: [], outside: true }] },
      {
        title: 'Payments',
        area: 'payments',
        apps: [
          { id: 'orders', also: ['Shipping'] },
          { id: 'pay', also: [] },
        ],
      },
      {
        title: 'No area',
        apps: [
          { id: 'mobile', also: [] },
          { id: 'web', also: [] },
        ],
      },
    ],
    hidden: 1,
  });
  // Hidden counts every app the areas hide, whatever the search shows.
  expect(appGroups(shop, ['pay'], [], ['payments'])?.hidden).toBe(2);
});

test('team boards group under their area in the stack order, no area last; a choice hides the others and says which', () => {
  const board = (name: string, ids: string[], area?: string) => ({
    name,
    nodes: Object.fromEntries(ids.map(id => [id, {}])),
    ...(area && { area }),
  });
  const team = [
    board('Track a parcel', ['ship']),
    board('Checkout', ['pay', 'web']),
    board('Smoke test', ['web']),
    board('Sign up', ['signup']),
    board('Order emails', ['pay'], 'accounts'),
  ];
  const names = (out: ReturnType<typeof boardGroups>) => out.groups.map(g => [g.title, g.boards.map(b => b.name)]);
  expect(names(boardGroups(shop, team, undefined))).toEqual([
    ['Payments', ['Checkout']],
    ['Shipping', ['Track a parcel']],
    ['Accounts', ['Sign up', 'Order emails']],
    ['No area', ['Smoke test']],
  ]);
  const chosen = boardGroups(shop, team, ['payments']);
  expect(names(chosen)).toEqual([
    ['Payments', ['Checkout']],
    ['No area', ['Smoke test']],
  ]);
  expect(chosen.hidden).toEqual({ count: 3, areas: ['Shipping', 'Accounts'] });
});
