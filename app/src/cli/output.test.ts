import { afterEach, expect, test, vi } from 'vitest';
import { confirm, flagValue, positional, table } from './output.ts';

afterEach(() => {
  vi.restoreAllMocks();
});

test('a table is as wide as its longest cells, with no trailing space', () => {
  const lines: string[] = [];
  vi.spyOn(console, 'log').mockImplementation((line: string) => void lines.push(line));
  table([
    ['NAME', 'PORT', 'COMMAND'],
    ['orders-api', 5001, 'dotnet run'],
    ['web', '-', ''],
  ]);
  expect(lines).toEqual(['NAME        PORT  COMMAND', 'orders-api  5001  dotnet run', 'web         -']);
});

test('which arguments are not options', () => {
  const args = ['orders', '--env', 'prod', 'web', '--json'];
  expect(positional(args)).toEqual(['orders', 'prod', 'web']);
  expect(positional(args, ['--env'])).toEqual(['orders', 'web']);
  expect(flagValue(args, '--env')).toBe('prod');
  expect(flagValue(args, '--port')).toBeUndefined();
});

test('without a terminal, only --yes says yes', async () => {
  expect(await confirm('Stop everything?', ['--yes'])).toBe(true);
  expect(await confirm('Stop everything?', ['-y'])).toBe(true);
  // The test runner's own input is not a terminal.
  expect(await confirm('Stop everything?')).toBe(false);
});
