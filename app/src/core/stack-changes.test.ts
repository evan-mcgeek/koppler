import { describe, expect, it } from 'vitest';
import { cardChanges } from './stack-changes.ts';

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
