import { expect, test } from 'vitest';
import { patch } from './stack-share.ts';

test("a copy's changes are made on the file as others left it: theirs stay, mine join, a list is taken whole", () => {
  const base = { name: 'Acme', apps: { web: { port: 3000, tags: ['a'] }, gone: { port: 1 } } };
  const mine = { name: 'Acme', apps: { web: { port: 3001, tags: ['a', 'b'] }, api: { port: 5001 } } };
  const theirs = {
    name: 'Acme',
    apps: { web: { port: 3000, tags: ['a'], note: 'theirs' }, gone: { port: 1 }, pay: { port: 7 } },
  };
  expect(patch(base, mine, theirs)).toEqual({
    name: 'Acme',
    apps: { web: { port: 3001, tags: ['a', 'b'], note: 'theirs' }, pay: { port: 7 }, api: { port: 5001 } },
  });
  // Nothing changed here: the file stays as they left it.
  expect(patch(base, base, theirs)).toBe(theirs);
});
