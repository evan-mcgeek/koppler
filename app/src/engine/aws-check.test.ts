import assert from 'node:assert/strict';
import { test } from 'vitest';
import { compareFeeds, nameOf } from './aws-check.ts';

test('names are read out of ARNs: a queue, a bus, a Lambda, an API destination', () => {
  assert.equal(nameOf('arn:aws:sqs:eu-west-1:111:catalog-kafka-sqs-qa'), 'catalog-kafka-sqs-qa');
  assert.equal(nameOf('arn:aws:events:eu-west-1:111:event-bus/cs-async-qa'), 'cs-async-qa');
  assert.equal(nameOf('arn:aws:lambda:eu-west-1:111:function:listener-qa'), 'Lambda listener-qa');
  assert.equal(nameOf('arn:aws:events:eu-west-1:111:api-destination/send-qa/1234'), 'API destination send-qa');
});

test('what AWS runs is checked against what the stack says feeds what', () => {
  const stack = {
    envs: ['qa', 'prod'],
    queues: {
      products: {
        name: 'Products',
        type: 'kafka' as const,
        queue: 'Juno_Product',
        feeds: { catalog: { via: 'pipe' as const } },
      },
      catalog: { name: 'Catalog queue', type: 'sqs' as const },
      bookings: { name: 'Bookings', type: 'kafka' as const, queue: 'Juno_Booking' },
      stale: {
        name: 'Stale',
        type: 'kafka' as const,
        queue: 'Juno_Gone',
        feeds: { catalog: { via: 'pipe' as const } },
      },
    },
    apps: {},
  };
  const lines = compareFeeds(
    [
      { from: 'Juno_Product', to: 'catalog-kafka-sqs-qa-x1', what: 'pipe catalog-products', state: 'RUNNING' },
      { from: 'Juno_Booking', to: 'aggregator-sqs-qa', what: 'pipe aggregator-bookings', state: 'STOPPED' },
      { from: 'Juno_Account', to: 'catalog', what: 'pipe accounts', state: 'RUNNING' },
      { from: 'Unrelated_Topic', to: 'somewhere-else', what: 'pipe other', state: 'RUNNING' },
    ],
    stack,
    'qa',
  );
  assert.deepEqual(lines, [
    'OK       Juno_Product -> catalog-kafka-sqs-qa-x1 by pipe catalog-products',
    'FOUND    Juno_Booking -> aggregator-sqs-qa by pipe aggregator-bookings (stopped): the stack has Bookings, but not what it feeds',
    'FOUND    Juno_Account -> catalog by pipe accounts: feeds Catalog queue, and the stack does not have Juno_Account',
    'MISSING  Juno_Gone: the stack says a pipe reads it; no pipe in the accounts checked does',
  ]);
});
