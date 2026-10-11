import { expect, test } from 'vitest';
import { fail, Failure } from './failure.ts';

test('a usage mistake exits 2, any other failure 1, unless the code is given', () => {
  expect(new Failure('usage: koppler up <app>').code).toBe(2);
  expect(new Failure('no stack loaded').code).toBe(1);
  expect(new Failure('', 3).code).toBe(3);
});

test('fail throws, so a caller can clean up and a server keeps running', () => {
  expect(() => fail('no stack loaded')).toThrow(Failure);
});
