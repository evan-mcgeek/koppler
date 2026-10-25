import { expect, test } from 'vitest';
import type { Stack } from '../core/stack.ts';
import { BROKER, EMULATOR, ENDPOINT, KAFKA, localQueues, queueEnv, STOP_BROKER, STOP_EMULATOR } from './queues.ts';

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
    web: { name: 'Web', kind: 'web' },
    listener: { name: 'Listener', kind: 'dotnet', reads: { feed: { env: ['Kafka__BootstrapServers'] } } },
  },
} as unknown as Stack;
const board = localQueues(
  stack,
  { thumbs: 'local', alerts: 'local', ghost: 'local' },
  ['api', 'worker', 'fn', 'web'],
  'prod',
);

test('only queues switched to local, of a type Koppler runs, with the board apps on them', () => {
  const apps = [
    { id: 'api', env: ['Queues__Thumbs'] },
    { id: 'worker', env: [] },
    { id: 'fn', env: [] },
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

test('apps Koppler starts get the SDK endpoint and their queue settings; a Lambda is left for the agent', () => {
  const url = 'http://127.0.0.1:4566/000000000000/thumbs-prod';
  const env = queueEnv(stack, board.queues, { thumbs: url });
  expect(env.set).toEqual({
    api: { AWS_ENDPOINT_URL_SQS: ENDPOINT, Queues__Thumbs: url },
    worker: { AWS_ENDPOINT_URL_SQS: ENDPOINT },
  });
  expect(env.left[0]).toMatch(/^Fn: point it at the local Thumbnails queue/);
});

test('the broker is reached and advertised on IPv4, where it is published, never as localhost', () => {
  expect(KAFKA).toBe('127.0.0.1:9092');
  expect(BROKER.at(-1)).toContain('-p 127.0.0.1:9092:9092');
  expect(BROKER.at(-1)).toContain('-e KAFKA_ADVERTISED_LISTENERS=PLAINTEXT://127.0.0.1:9092');
});

test('Stop removes the very containers the emulator and the broker start', () => {
  expect(EMULATOR.at(-1)).toContain(`--name ${STOP_EMULATOR.at(-1) ?? ''} `);
  expect(BROKER.at(-1)).toContain(`--name ${STOP_BROKER.at(-1) ?? ''} `);
});
