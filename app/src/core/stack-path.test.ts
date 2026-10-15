import { expect, test } from 'vitest';
import { getAt, parsePath, setAt } from './stack-path.ts';

test('a path is read into its parts, and what is not one is refused', () => {
  expect(parsePath('apps.orders-api.prereqs[0].port')).toEqual(['apps', 'orders-api', 'prereqs', 0, 'port']);
  expect(parsePath('envAliases["qa.eu"]')).toEqual(['envAliases', 'qa.eu']);
  for (const bad of ['', '.apps', 'apps..x', 'apps.__proto__.x', 'apps.constructor', 'apps[x]', 'apps/x'])
    expect(parsePath(bad)).toHaveProperty('error');
});

test('a field is set and taken out on a copy, making what is on the way and closing up lists', () => {
  const stack = { apps: { a: { name: 'A', prereqs: [{ port: 1 }, { port: 2 }] } } };
  const frozen = JSON.stringify(stack);
  expect(setAt(stack, ['apps', 'a', 'url'], 'http://x')).toEqual({
    apps: { a: { name: 'A', prereqs: [{ port: 1 }, { port: 2 }], url: 'http://x' } },
  });
  expect(setAt(stack, ['apps', 'b', 'envs', 'prod', 'start'], 'go')).toMatchObject({
    apps: { b: { envs: { prod: { start: 'go' } } } },
  });
  expect(getAt(setAt(stack, ['apps', 'a', 'prereqs', 0], undefined), ['apps', 'a', 'prereqs'])).toEqual([{ port: 2 }]);
  expect(getAt(setAt(stack, ['apps', 'a', 'prereqs', 2], { port: 3 }), ['apps', 'a', 'prereqs', 2])).toEqual({
    port: 3,
  });
  expect(getAt(setAt(stack, ['apps', 'a', 'name'], undefined), ['apps', 'a'])).not.toHaveProperty('name');
  expect(() => setAt(stack, ['apps', 'a', 'prereqs', 5], {})).toThrow(/no item 5/);
  expect(JSON.stringify(stack)).toBe(frozen);
  expect(getAt(stack, ['apps', 'a', 'prereqs', 1, 'port'])).toBe(2);
  expect(getAt(stack, ['apps', 'zzz', 'name'])).toBeUndefined();
  expect(getAt({}, ['toString'])).toBeUndefined();
});
