import { describe, expect, it } from 'vitest';
import { stateOf } from './app-state.ts';

const exited = { state: 'exited', detail: 'It stopped.' } as const;
describe('stateOf', () => {
  it('a live process wins over what the run said of its start', () => {
    const running = { state: 'running', detail: '' } as const;
    expect(stateOf(running, [{ label: 'Start', state: 'failed', detail: 'x' }])).toEqual(running);
  });
  it('a failed start is named before an old process that exited', () => {
    expect(stateOf(exited, [{ label: 'Start', state: 'failed', detail: 'boom' }])).toEqual({
      state: 'failed-to-start',
      detail: 'boom',
    });
    expect(stateOf(exited)).toEqual(exited);
  });
  it('waiting comes from the run, a missing secret only when nothing else is known', () => {
    const waiting = [{ label: 'Start', state: 'todo', detail: 'Waiting for API.' }];
    expect(stateOf(null, waiting, ['DB'])).toEqual({ state: 'waiting', detail: 'Waiting for API.' });
    expect(stateOf(null, [], ['DB', 'KEY'])).toEqual({ state: 'secret-missing', detail: 'DB, KEY' });
    expect(stateOf(null)).toBeNull();
  });
});
