import { describe, expect, it } from 'vitest';
import { cardChanges, changes } from './stack-changes.ts';

describe('cardChanges', () => {
  const base = {
    apps: { web: { name: 'Web', url: 'http://localhost:3000' }, gone: { name: 'Gone' } },
    queues: { events: { name: 'Events', type: 'sqs' } },
  };
  it('marks each card added or changed, with the fields that changed', () => {
    const now = {
      apps: {
        web: { name: 'Web', url: 'http://localhost:3001', consumes: { orders: {} } },
        orders: { name: 'Orders' },
      },
      queues: { events: { name: 'Events', type: 'sqs' } },
      databases: { db: { name: 'Orders', kind: 'postgres' } },
    };
    expect(cardChanges(base, now)).toEqual({
      web: { added: false, fields: ['url', 'consumes'] },
      orders: { added: true, fields: [] },
      'database:db': { added: true, fields: [] },
    });
  });
  it('has nothing for the same stack', () => {
    expect(cardChanges(base, structuredClone(base))).toEqual({});
  });
});

it('a field cleared and typed again is no change; areas in another order are one', () => {
  expect(changes({ name: 'Acme Shop', envs: ['qa'] }, { envs: ['qa'], name: 'Acme Shop' })).toBe(0);
  expect(
    changes({ areas: { a: { name: 'A' }, b: { name: 'B' } } }, { areas: { b: { name: 'B' }, a: { name: 'A' } } }),
  ).toBe(1);
  expect(changes({ a: { name: 'A' }, b: { name: 'B' } }, { b: { name: 'B' }, a: { name: 'A' } }, 'areas')).toBe(1);
  expect(changes({ name: 'Acme Shop' }, { name: 'Acme Store', envs: ['qa'] })).toBe(2);
});
