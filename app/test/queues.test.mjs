import assert from 'node:assert/strict';
import { localQueues, queueEnv, ENDPOINT, KAFKA, EMULATOR, BROKER, STOP_EMULATOR, STOP_BROKER } from '../src/queues.mjs';

const registry = {
  queues: { thumbs: { name: 'Thumbnails', type: 'sqs', queue: 'thumbs-qa', envs: { prod: { queue: 'thumbs-prod' } } }, feed: { name: 'Feed', type: 'kafka' }, alerts: { name: 'Alerts', type: 'sns' } },
  apps: {
    api: { name: 'API', kind: 'dotnet', publishes: { thumbs: { env: 'Queues__Thumbs' } } },
    worker: { name: 'Worker', kind: 'node', reads: { thumbs: {} } },
    fn: { name: 'Fn', kind: 'lambda', reads: { thumbs: {} } },
    web: { name: 'Web', kind: 'web' },
    listener: { name: 'Listener', kind: 'dotnet', reads: { feed: { env: ['Kafka__BootstrapServers'] } } },
  },
};

// Only queues switched to local, of a type Koppler runs, with the board apps on them; the env's own queue name.
const { queues, left } = localQueues(registry, { thumbs: 'local', alerts: 'local', ghost: 'local' }, ['api', 'worker', 'fn', 'web'], 'prod');
assert.deepEqual(queues, [{ id: 'thumbs', name: 'Thumbnails', type: 'sqs', queue: 'thumbs-prod', apps: [{ id: 'api', env: ['Queues__Thumbs'] }, { id: 'worker', env: [] }, { id: 'fn', env: [] }] }]);
assert.deepEqual(left, ['Alerts: Koppler cannot run a sns queue locally yet; it stays the deployed one']);
// A Kafka topic runs on the local broker: its apps' broker settings point there, with no AWS endpoint.
const kafka = localQueues(registry, { feed: 'local' }, ['listener'], 'qa').queues;
assert.deepEqual(queueEnv(registry, kafka, { feed: `${KAFKA}/feed` }).set, { listener: { Kafka__BootstrapServers: KAFKA } });
assert.equal(localQueues(registry, { thumbs: 'deployed' }, ['api'], 'qa').queues.length, 0);

// Apps started by Koppler get the SDK endpoint and their queue settings; a Lambda is left for the agent.
const url = 'http://127.0.0.1:4566/000000000000/thumbs-prod';
const env = queueEnv(registry, queues, { thumbs: url });
assert.deepEqual(env.set, { api: { AWS_ENDPOINT_URL_SQS: ENDPOINT, Queues__Thumbs: url }, worker: { AWS_ENDPOINT_URL_SQS: ENDPOINT } });
assert.match(env.left[0], /^Fn: point it at the local Thumbnails queue/);
// Stop removes the very containers the emulator and the broker start.
assert.ok(EMULATOR.at(-1).includes(`--name ${STOP_EMULATOR.at(-1)} `));
assert.ok(BROKER.at(-1).includes(`--name ${STOP_BROKER.at(-1)} `));
console.log('queues tests ok');
