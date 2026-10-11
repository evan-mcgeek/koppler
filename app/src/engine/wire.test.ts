import { expect, test } from 'vitest';
import type { Registry } from '../data.ts';
import { wireInfo } from './wire.ts';

const stack = {
  name: 'Acme Shop',
  envs: ['qa', 'prod'],
  apps: {
    web: { name: 'Web', kind: 'node', url: 'http://localhost:3000', consumes: { api: { how: 'env', env: 'API_URL' } } },
    api: { name: 'API', kind: 'node', url: 'http://localhost:5000' },
    jobs: { name: 'Jobs', kind: 'node' },
  },
  found: { jobs: { api: 'src/client.ts:4' } },
} as unknown as Registry;

test('a cable points the caller at the local address of the app it calls', () => {
  const wired = wireInfo(stack, {}, 'web', 'api', 'qa');
  expect(wired).toMatchObject({
    from: 'web',
    to: 'api',
    how: 'env',
    env: 'API_URL',
    value: 'http://localhost:5000',
    device: null,
  });
});

test('a call the stack only found is wired with its place in the code, not a way to set it', () => {
  expect(wireInfo(stack, {}, 'jobs', 'api', 'qa')).toMatchObject({ how: 'unknown', found: 'src/client.ts:4' });
});

test('a call the stack does not know is an error, not a guess', () => {
  expect(wireInfo(stack, {}, 'api', 'web', 'qa')).toEqual({
    error: 'api does not call web as far as the stack knows (koppler sync finds unrecorded calls)',
  });
  expect(wireInfo(stack, {}, 'web', 'nope', 'qa')).toEqual({ error: 'nope is not an app in the stack' });
});
