import { expect, test } from 'vitest';
import { addressProblem, parseAddress } from './local-databases.ts';
import { stackCommands } from './checks.ts';

test('a local address is read as host:port[/database] and checked before it is kept', () => {
  expect(parseAddress('localhost:5433/orders_dev')).toEqual({ host: 'localhost', port: 5433, database: 'orders_dev' });
  expect(parseAddress('localhost:6379')).toEqual({ host: 'localhost', port: 6379 });
  expect(addressProblem(parseAddress('localhost'))).toBe('a host name such as localhost');
  expect(addressProblem(parseAddress('localhost:70000'))).toBe('a port number from 1 to 65535');
  expect(addressProblem({ host: 'localhost', port: 5432, database: 'a b' })).toMatch(/database name/);
  expect(addressProblem(parseAddress('db.local:5432/x'))).toBeNull();
});

test("a database use's code change waits for the user's approval like any other code change", () => {
  const change = { file: 'src/Db.cs', find: 'Host=prod', replace: '{local}' };
  const commands = stackCommands({ apps: { orders: { name: 'Orders', uses: { 'orders-db': { change } } } } });
  expect(commands).toEqual([{ what: 'code change', name: 'Orders, src/Db.cs', run: 'Host=prod\n  becomes\n{local}' }]);
});
