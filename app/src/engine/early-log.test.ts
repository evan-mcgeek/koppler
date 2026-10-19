import { expect, test } from 'vitest';
import { launchProblems } from './early-log.ts';

test('the lines that tell of a problem at start are picked out, and a count of no errors is not one', () => {
  const log = [
    'info: Microsoft.Hosting.Lifetime[14] Now listening on: http://localhost:5001',
    'fail: Microsoft.EntityFrameworkCore.Database.Command[20102] Failed executing DbCommand',
    'Build succeeded. 0 errors, 2 warnings',
    'Error: connect ECONNREFUSED 127.0.0.1:6379',
    'Unhandled exception. System.InvalidOperationException: No connection string named DB',
    'compiled with no errors',
  ].join('\n');
  expect(launchProblems(log)).toEqual([
    'fail: Microsoft.EntityFrameworkCore.Database.Command[20102] Failed executing DbCommand',
    'Error: connect ECONNREFUSED 127.0.0.1:6379',
    'Unhandled exception. System.InvalidOperationException: No connection string named DB',
  ]);
  expect(launchProblems('ready on :3000\nGET /health 200')).toEqual([]);
});
