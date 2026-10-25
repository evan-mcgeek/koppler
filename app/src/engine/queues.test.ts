import { expect, test } from 'vitest';
import type { Stack } from '../core/stack.ts';
import {
  BROKER,
  EMULATOR,
  ENDPOINT,
  KAFKA,
  LAMBDA_QUEUES,
  localQueues,
  queueEnv,
  REGION,
  STOP_BROKER,
  STOP_EMULATOR,
} from './queues.ts';

const stack = {
  queues: {
    thumbs: { name: 'Thumbnails', type: 'sqs', queue: 'thumbs-qa', envs: { prod: { queue: 'thumbs-prod' } } },
    feed: { name: 'Feed', type: 'kafka' },
    alerts: { name: 'Alerts', type: 'sns' },
  },
  apps: {
    api: { name: 'API', kind: 'dotnet', publishes: { thumbs: { env: 'Queues__Thumbs' } } },
    worker: { name: 'Worker', kind: 'node', reads: { thumbs: {} } },
    fn: { name: 'Fn', kind: 'lambda', reads: { thumbs: {} } },
    emit: { name: 'Emit', kind: 'lambda', publishes: { thumbs: {} } },
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
    { id: 'emit', env: [] },
  ];
  expect(board.queues).toEqual([{ id: 'thumbs', name: 'Thumbnails', type: 'sqs', queue: 'thumbs-prod', apps }]);
  expect(board.left).toEqual(['Alerts: Koppler cannot run a sns queue locally yet; it stays the deployed one']);
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
  });
  expect(env.left).toEqual([expect.stringMatching(/^Emit: point it at the local Thumbnails queue/)]);
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
