import { execFileSync } from 'node:child_process';
import { beforeEach, expect, test, vi } from 'vitest';
import type { Stack } from '../core/stack.ts';
import {
  BROKER,
  createLocal,
  EMULATOR,
  ENDPOINT,
  feedLocal,
  KAFKA,
  LAMBDA_QUEUES,
  LAMBDA_SETTINGS,
  localFeeds,
  localQueues,
  queueEnv,
  REGION,
  STOP_BROKER,
  STOP_EMULATOR,
} from './queues.ts';

vi.mock('node:child_process', () => ({ execFileSync: vi.fn(() => 'printed\n') }));
const exec = vi.mocked(execFileSync);
/** The AWS CLI calls made, without the endpoint and region every one of them carries. */
const calls = () => exec.mock.calls.map(([, args]) => (args as string[]).slice(6));
beforeEach(() => {
  exec.mockClear();
});

const stack = {
  queues: {
    thumbs: { name: 'Thumbnails', type: 'sqs', queue: 'thumbs-qa', envs: { prod: { queue: 'thumbs-prod' } } },
    feed: { name: 'Feed', type: 'kafka' },
    alerts: { name: 'Alerts', type: 'other' },
  },
  apps: {
    api: { name: 'API', kind: 'dotnet', publishes: { thumbs: { env: 'Queues__Thumbs' } } },
    worker: { name: 'Worker', kind: 'node', reads: { thumbs: {} } },
    fn: { name: 'Fn', kind: 'lambda', reads: { thumbs: {} } },
    emit: { name: 'Emit', kind: 'lambda', publishes: { thumbs: { env: 'THUMBS_URL' } } },
    web: { name: 'Web', kind: 'web' },
    listener: { name: 'Listener', kind: 'dotnet', reads: { feed: { env: ['Kafka__BootstrapServers'] } } },
  },
} as unknown as Stack;
const board = localQueues(
  stack,
  { thumbs: 'local', alerts: 'local', ghost: 'local' },
  ['api', 'worker', 'fn', 'emit', 'web'],
  'prod',
);

test('only queues switched to local, of a type Koppler runs, with the board apps on them', () => {
  const apps = [
    { id: 'api', env: ['Queues__Thumbs'] },
    { id: 'worker', env: [] },
    { id: 'fn', env: [] },
    { id: 'emit', env: ['THUMBS_URL'] },
  ];
  expect(board.queues).toEqual([{ id: 'thumbs', name: 'Thumbnails', type: 'sqs', queue: 'thumbs-prod', apps }]);
  expect(board.left).toEqual(['Alerts: Koppler cannot run a other queue locally yet; it stays the deployed one']);
  expect(localQueues(stack, { thumbs: 'deployed' }, ['api'], 'qa').queues).toEqual([]);
});

test('a Kafka topic runs on the local broker, with no AWS endpoint', () => {
  const kafka = localQueues(stack, { feed: 'local' }, ['listener'], 'qa').queues;
  expect(queueEnv(stack, kafka, { feed: `${KAFKA}/feed` }).set).toEqual({
    listener: { Kafka__BootstrapServers: KAFKA },
  });
});

test('apps Koppler starts get the SDK endpoint and their queue settings; a Lambda that reads one is triggered by it', () => {
  const url = 'http://127.0.0.1:4566/000000000000/thumbs-prod';
  const env = queueEnv(stack, board.queues, { thumbs: url });
  expect(env.set).toEqual({
    // The AWS SDK for .NET signs for us-east-1 at an endpoint of its own: it is told the queue's region.
    api: { AWS_ENDPOINT_URL_SQS: ENDPOINT, AWS__AuthenticationRegion: REGION, Queues__Thumbs: url },
    worker: { AWS_ENDPOINT_URL_SQS: ENDPOINT },
    fn: { [LAMBDA_QUEUES]: url },
    // A Lambda runs in the emulator, which is its endpoint already: it gets only the settings that name the queue.
    emit: { THUMBS_URL: url, [LAMBDA_SETTINGS]: 'THUMBS_URL' },
  });
  expect(env.left).toEqual([]);
});

const events = {
  queues: {
    orders: { name: 'Orders', type: 'sns', queue: 'orders', feeds: { emails: { via: 'subscription' } } },
    bus: {
      name: 'Shop events',
      type: 'eventbridge',
      queue: 'shop',
      feeds: { emails: { via: 'rule' }, audit: { via: 'rule' }, orders: { via: 'rule' } },
    },
    emails: { name: 'Emails', type: 'sqs', queue: 'emails', feeds: { archive: { via: 'pipe' } } },
    archive: { name: 'Archive', type: 'sqs' },
    audit: { name: 'Audit', type: 'sqs' },
  },
  apps: {
    shop: {
      name: 'Shop API',
      kind: 'node',
      publishes: { orders: { env: 'ORDERS_TOPIC' }, bus: { env: ['EVENT_BUS'] } },
    },
    mailer: { name: 'Mailer', kind: 'lambda', reads: { emails: {}, orders: {} } },
    mobile: { name: 'Shop app', kind: 'flutter', publishes: { bus: {} } },
  },
} as unknown as Stack;
const topicArn = 'arn:aws:sns:eu-west-1:000000000000:orders';
const onBoard = localQueues(
  events,
  { orders: 'local', bus: 'local', emails: 'local', archive: 'local' },
  ['shop', 'mailer', 'mobile'],
  'qa',
).queues;

test('an SNS topic and an event bus run in the emulator; apps get their endpoint and the setting that names each', () => {
  expect(onBoard.map(queue => [queue.id, queue.type])).toEqual([
    ['orders', 'sns'],
    ['bus', 'eventbridge'],
    ['emails', 'sqs'],
    ['archive', 'sqs'],
  ]);
  const env = queueEnv(events, onBoard, { orders: topicArn, bus: 'shop', emails: 'http://e', archive: 'http://a' });
  expect(env.set['shop']).toEqual({
    AWS_ENDPOINT_URL_SNS: ENDPOINT,
    ORDERS_TOPIC: topicArn,
    AWS_ENDPOINT_URL_EVENTBRIDGE: ENDPOINT,
    EVENT_BUS: 'shop',
  });
  // A local Lambda is triggered only by an SQS queue.
  expect(env.set['mailer']).toEqual({ [LAMBDA_QUEUES]: 'http://e' });
  expect(env.left).toEqual([
    expect.stringMatching(/^Mailer: Koppler triggers a local Lambda only from an SQS queue/),
    expect.stringMatching(/^Shop app: point it at the local Shop events event bus \(shop\)/),
  ]);
});

test('a local topic or bus feeds only a local SQS queue; one that stays deployed is never subscribed', () => {
  const found = localFeeds(events, onBoard);
  expect(found.feeds.map(({ from, to, via }) => [from.id, to.id, via])).toEqual([
    ['orders', 'emails', 'subscription'],
    ['bus', 'emails', 'rule'],
  ]);
  expect(found.left).toEqual([
    'Shop events feeds Audit, which stays deployed. Local messages do not reach it.',
    'Koppler cannot run the rule from Shop events to Orders here yet.',
    'Koppler cannot run the pipe from Emails to Archive here yet.',
  ]);
});

test('each kind is made in the emulator: a queue gives its URL, a topic its ARN, a bus its name', () => {
  expect(createLocal('sqs', 'emails')).toBe('printed');
  expect(createLocal('sns', 'orders.fifo')).toBe('printed');
  expect(createLocal('eventbridge', 'shop')).toBe('shop');
  // The default bus is always there.
  expect(createLocal('eventbridge', 'default')).toBe('default');
  expect(calls()).toEqual([
    ['sqs', 'create-queue', '--queue-name', 'emails', '--query', 'QueueUrl'],
    [
      'sns',
      'create-topic',
      '--name',
      'orders.fifo',
      '--attributes',
      'FifoTopic=true,ContentBasedDeduplication=true',
      '--query',
      'TopicArn',
    ],
    ['events', 'create-event-bus', '--name', 'shop', '--query', 'EventBusArn'],
  ]);
  // Every call reaches the emulator, never the user's AWS account.
  expect(exec.mock.calls[0]?.[1]?.slice(0, 6)).toEqual([
    '--endpoint-url',
    ENDPOINT,
    '--region',
    REGION,
    '--output',
    'text',
  ]);
});

test('a bus already made by an earlier run is kept', () => {
  exec.mockImplementationOnce(() => {
    throw Object.assign(new Error('failed'), { stderr: 'An error occurred (ResourceAlreadyExistsException)' });
  });
  expect(createLocal('eventbridge', 'shop')).toBe('shop');
});

test('a topic subscribes the queue; a bus gets a rule that sends every event to it', () => {
  exec.mockReturnValue('arn:aws:sqs:eu-west-1:000000000000:emails\n');
  feedLocal({ type: 'sns', address: topicArn }, 'http://e');
  feedLocal({ type: 'eventbridge', address: 'shop' }, 'http://e');
  exec.mockReturnValue('printed\n');
  const queueArn = 'arn:aws:sqs:eu-west-1:000000000000:emails';
  const arnOf = ['sqs', 'get-queue-attributes', '--queue-url', 'http://e', '--attribute-names', 'QueueArn'];
  expect(calls()).toEqual([
    [...arnOf, '--query', 'Attributes.QueueArn'],
    ['sns', 'subscribe', '--topic-arn', topicArn, '--protocol', 'sqs', '--notification-endpoint', queueArn],
    [...arnOf, '--query', 'Attributes.QueueArn'],
    [
      'events',
      'put-rule',
      '--name',
      'koppler-to-emails',
      '--event-bus-name',
      'shop',
      '--event-pattern',
      '{"source":[{"prefix":""}]}',
    ],
    [
      'events',
      'put-targets',
      '--rule',
      'koppler-to-emails',
      '--event-bus-name',
      'shop',
      '--targets',
      `Id=koppler,Arn=${queueArn}`,
    ],
  ]);
});

test('the broker is reached and advertised on IPv4, where it is published, never as localhost', () => {
  expect(KAFKA).toBe('127.0.0.1:9092');
  expect(BROKER.at(-1)).toContain('-p 127.0.0.1:9092:9092');
  expect(BROKER.at(-1)).toContain('-e KAFKA_ADVERTISED_LISTENERS=PLAINTEXT://127.0.0.1:9092');
});

test('Stop removes the very containers the emulator and the broker start, and the functions the emulator ran', () => {
  expect(EMULATOR.at(-1)).toContain('--name koppler-queues ');
  expect(STOP_EMULATOR.at(-1)).toContain('docker rm -f koppler-queues');
  expect(EMULATOR.at(-1)).toContain('-e FLOCI_SERVICES_LAMBDA_CONTAINER_NAME_PREFIX=koppler-fn ');
  expect(STOP_EMULATOR.at(-1)).toContain('--filter name=koppler-fn- ');
  // The emulator starts each function's container through Docker.
  expect(EMULATOR.at(-1)).toContain('-v /var/run/docker.sock:/var/run/docker.sock');
  expect(BROKER.at(-1)).toContain(`--name ${STOP_BROKER.at(-1) ?? ''} `);
});
