import { describe, expect, it } from 'vitest';
import { beforeStart } from './secret-types.ts';

describe('beforeStart', () => {
  const rejected = { code: 1, message: 'failed: it rejected the key' };
  const down = { code: 1, message: 'failed: nothing answers at its address (is the tunnel up?)' };

  it('stops a start when a database login or a key is wrong', () => {
    expect(beforeStart('postgres', { code: 1, message: 'failed: password authentication failed' })).toBe('stop');
    expect(beforeStart('postgres', down)).toBe('stop');
    expect(beforeStart('key', rejected)).toBe('stop');
  });

  it('only warns when an outside API cannot say whether a key works', () => {
    expect(beforeStart('key', down)).toBe('warn');
    expect(beforeStart('key', { code: 1, message: 'failed: it answered 503' })).toBe('warn');
  });

  it('says a passed test and passes over one it could not run', () => {
    expect(beforeStart('key', { code: 0, message: 'accepted' })).toBe('ok');
    expect(beforeStart('key', { code: 2, message: 'cannot test: approve sending it first' })).toBe('skip');
  });
});
