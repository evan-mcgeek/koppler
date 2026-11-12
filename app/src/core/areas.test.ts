import { expect, test } from 'vitest';
import {
  appGroups,
  areaId,
  areaUse,
  areaWhy,
  boardArea,
  boardGroups,
  hiddenBy,
  inAreas,
  withoutArea,
} from './areas.ts';

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
  expect(boardArea(stack, board(['pay', 'signup']))).toEqual({ id: 'accounts', by: 'apps', tie: true });
  expect(boardArea(stack, board(['pay', 'ship']))).toEqual({ id: 'payments', by: 'apps', tie: true });
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

test('boards group under their area in the stack order, by name, no area last; a choice hides the others and says which', () => {
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
    ['Accounts', ['Order emails', 'Sign up']],
    ['No area', ['Smoke test']],
  ]);
  const chosen = boardGroups(shop, team, ['payments']);
  expect(names(chosen)).toEqual([
    ['Payments', ['Checkout']],
    ['No area', ['Smoke test']],
  ]);
  expect(chosen.hidden).toEqual({ count: 3, team: 3, yours: 0, areas: ['Shipping', 'Accounts'] });
});

test('boards of both kinds sort by name ignoring case, and the hidden ones are counted by kind', () => {
  const mixed = [
    { name: 'checkout notes', nodes: { pay: {} }, mine: true },
    { name: 'Basket rework', nodes: { pay: {} }, mine: true },
    { name: 'Checkout', nodes: { pay: {} } },
    { name: 'Track a parcel', nodes: { ship: {} } },
    { name: 'Parcel notes', nodes: { ship: {} }, mine: true },
  ];
  const names = boardGroups(shop, mixed, undefined).groups.map(g => [g.title, g.boards.map(b => b.name)]);
  expect(names).toEqual([
    ['Payments', ['Basket rework', 'Checkout', 'checkout notes']],
    ['Shipping', ['Parcel notes', 'Track a parcel']],
  ]);
  expect(boardGroups(shop, mixed, ['payments']).hidden).toEqual({ count: 2, team: 1, yours: 1, areas: ['Shipping'] });
});

test("a choice hides the apps outside it but the board's own, and says the areas they are in", () => {
  expect(hiddenBy(shop, ['payments'], ['signup'])).toEqual({ apps: ['ship'], areas: ['Shipping'] });
  expect(hiddenBy(shop, ['payments'], [])).toEqual({ apps: ['ship', 'signup'], areas: ['Shipping', 'Accounts'] });
  expect(hiddenBy(shop, ['payments', 'shipping', 'accounts'], [])).toEqual({ apps: [], areas: [] });
  expect(hiddenBy(shop, undefined, [])).toEqual({ apps: [], areas: [] });
});

test('why a board is in its area, from its apps alone', () => {
  expect(areaWhy(stack, board(['web', 'pay', 'basket', 'ship']))).toBe('Payments: 2 of its 4 apps');
  expect(areaWhy(stack, board(['pay', 'signup']))).toBe('1 app in Payments, 1 in Accounts. Accounts is smaller');
  expect(areaWhy(stack, board(['pay', 'ship']))).toBe('1 app in Payments, 1 in Shipping. Payments comes first');
  expect(areaWhy(stack, board(['web']))).toBe('None of its apps is in an area');
  // Set by hand, it still says what its apps would give.
  expect(areaWhy(stack, board(['pay'], 'accounts'))).toBe('Payments: 1 of its 1 app');
});

test("a new area's id is made from its name, once", () => {
  expect(areaId('Order emails', [])).toBe('order-emails');
  expect(areaId('  Payments & Refunds ', [])).toBe('payments-refunds');
  expect(areaId('Payments', ['payments', 'payments-2'])).toBe('payments-3');
  expect(areaId('Über', [])).toBe('ber');
  expect(areaId('!!', [])).toBe('area');
  // An all-digit key sorts first in an object, so it could never be moved: it gets a word in front.
  expect(areaId('2025', [])).toBe('area-2025');
});

const full = {
  areas: { payments: { name: 'Payments' }, shipping: { name: 'Shipping' } },
  apps: {
    web: { name: 'Web Shop' },
    orders: { name: 'Orders API', areas: ['payments', 'shipping'] },
    pay: { name: 'Payments API', areas: ['payments'] },
    ship: { name: 'Shipping API', areas: ['shipping'] },
  },
  presets: [
    { name: 'Checkout', nodes: { web: {}, pay: {} } },
    { name: 'Order emails', nodes: { web: {}, ship: {} }, area: 'payments' },
    { name: 'Track a parcel', nodes: { ship: {} } },
  ],
};

test('what an area holds: its apps, and the team boards in it, worked out or set by hand', () => {
  expect(areaUse(full, 'payments')).toEqual({
    apps: ['Orders API', 'Payments API'],
    boards: ['Checkout', 'Order emails'],
    byHand: ['Order emails'],
  });
  expect(areaUse(full, 'shipping')).toEqual({
    apps: ['Orders API', 'Shipping API'],
    boards: ['Track a parcel'],
    byHand: [],
  });
});

test('removing an area takes it out of every app and team board, and leaves the rest as it was', () => {
  const out = withoutArea({ ...full, envs: ['qa'] }, 'payments');
  expect(out).toEqual({
    envs: ['qa'],
    areas: { shipping: { name: 'Shipping' } },
    apps: {
      web: { name: 'Web Shop' },
      orders: { name: 'Orders API', areas: ['shipping'] },
      pay: { name: 'Payments API' },
      ship: { name: 'Shipping API', areas: ['shipping'] },
    },
    presets: [
      { name: 'Checkout', nodes: { web: {}, pay: {} } },
      { name: 'Order emails', nodes: { web: {}, ship: {} } },
      { name: 'Track a parcel', nodes: { ship: {} } },
    ],
  });
  // The last area goes with its key.
  expect(withoutArea({ areas: { payments: { name: 'Payments' } }, apps: {} }, 'payments')).toEqual({ apps: {} });
});

test('removing an area keeps every key where it was', () => {
  const stack = {
    name: 'Acme Shop',
    areas: { payments: { name: 'Payments' }, shipping: { name: 'Shipping' } },
    apps: { orders: { name: 'Orders API', areas: ['payments', 'shipping'], kind: 'dotnet' } },
    presets: [{ name: 'Checkout', area: 'payments', nodes: {} }],
    envs: ['qa'],
  };
  expect(JSON.stringify(withoutArea(stack, 'payments'))).toBe(
    JSON.stringify({
      name: 'Acme Shop',
      areas: { shipping: { name: 'Shipping' } },
      apps: { orders: { name: 'Orders API', areas: ['shipping'], kind: 'dotnet' } },
      presets: [{ name: 'Checkout', nodes: {} }],
      envs: ['qa'],
    }),
  );
});
