import { expect, test } from 'vitest';
import { parseStamped } from './logfmt.ts';
import { mergeLogs, pairTimes } from './shared-log.ts';

test('a log pairs with its times from the end; a line still being written takes the last time', () => {
  expect(pairTimes(['a', 'b', 'c'], [10, 20, 30], true)).toEqual([10, 20, 30]);
  expect(pairTimes(['b', 'c'], [10, 20, 30], true)).toEqual([20, 30]);
  expect(pairTimes(['a', 'b', 'c'], [10, 20], false)).toEqual([10, 20, 20]);
  // Lines older than the first time kept take the oldest one.
  expect(pairTimes(['a', 'b', 'c'], [30], true)).toEqual([30, 30, 30]);
});

test('every app in arrival order, from a time on, the last so many', () => {
  const sources = [
    { app: 'orders', lines: ['created', 'charging'], times: [100, 200] },
    { app: 'pay', lines: ['charged'], times: [150], approx: true },
  ];
  expect(mergeLogs(sources).map(entry => `${entry.app}:${entry.line}`)).toEqual([
    'orders:created',
    'pay:charged',
    'orders:charging',
  ]);
  expect(mergeLogs(sources, { since: 150 }).map(entry => entry.line)).toEqual(['charged', 'charging']);
  expect(mergeLogs(sources, { limit: 1 }).map(entry => entry.line)).toEqual(['charging']);
  expect(mergeLogs(sources)[1]?.approx).toBe(true);
});

test("a stack trace continues its own app's row, never another app's", () => {
  const rows = parseStamped([
    { app: 'orders', at: 1, approx: false, line: 'Unhandled exception. System.Exception: boom' },
    { app: 'orders', at: 2, approx: false, line: '   at Orders.Charge()' },
    { app: 'pay', at: 3, approx: false, line: '   at Pay.Run()' },
  ]);
  expect(rows.map(row => [row.app, row.detail])).toEqual([
    ['orders', 'at Orders.Charge()'],
    ['pay', ''],
  ]);
});
