// Queues switched to local on the board.
//   SQS: one AWS emulator in Docker (the image the Lambda kind uses) holds them all; every app on one starts with the AWS
//   SDK's SQS endpoint pointed at it and its queue settings set to the local queue.
//   Kafka: one local broker in Docker (apache/kafka); the topic is created on it and every app on one starts with its
//   broker settings pointed at it.
import { execFileSync } from 'node:child_process';
import kinds from './kinds.js';
import kp from './plan.js';

export const PORT = 4566, ENDPOINT = `http://127.0.0.1:${PORT}`;
// Stopping the Docker client does not stop its container: it is removed on stop, and a leftover one before starting.
const RM = 'docker rm -f koppler-queues >/dev/null 2>&1';
// Run by Stop as well: the shell's own cleanup never happens when it has to be killed.
export const STOP_EMULATOR = ['docker', 'rm', '-f', 'koppler-queues'], STOP_BROKER = ['docker', 'rm', '-f', 'koppler-kafka'];
export const EMULATOR = ['sh', '-c', `${RM}; trap '${RM}; exit 0' TERM INT HUP; docker run --rm --name koppler-queues -p 127.0.0.1:${PORT}:4566 floci/floci:latest & wait`];
export const KAFKA_PORT = 9092, KAFKA = `localhost:${KAFKA_PORT}`;
const RM_KAFKA = 'docker rm -f koppler-kafka >/dev/null 2>&1';
export const BROKER = ['sh', '-c', `${RM_KAFKA}; trap '${RM_KAFKA}; exit 0' TERM INT HUP; docker run --rm --name koppler-kafka -p 127.0.0.1:${KAFKA_PORT}:9092 apache/kafka:latest & wait`];

// The local queues of a board and the apps on each: { id, name, queue, apps: [{ id, env: [settings] }] }; what cannot be local is in `left`.
export function localQueues(registry, queues, ids, env) {
  const out = [], left = [];
  for (const id of Object.keys(queues ?? {}).filter(q => queues[q] === 'local')) {
    const q = registry.queues?.[id];
    if (!q) continue;
    if (!kp.LOCAL_QUEUE_TYPES.includes(q.type)) { left.push(`${q.name}: Koppler cannot run a ${q.type} queue locally yet; it stays the deployed one`); continue; }
    const apps = ids.flatMap(a => ['publishes', 'reads'].map(k => registry.apps[a]?.[k]?.[id]).filter(Boolean).slice(0, 1).map(use => ({ id: a, env: [].concat(use.env ?? []) })));
    out.push({ id, name: q.name, type: q.type, queue: q.envs?.[env]?.queue ?? q.queue ?? id, apps });
  }
  return { queues: out, left };
}

// Env settings per app for the created queues ({ queueId: url }); apps that take no env at start are listed for the agent.
export function queueEnv(registry, list, urls) {
  const set = {}, left = [];
  for (const q of list) for (const a of q.apps) {
    const app = registry.apps[a.id];
    if (kinds.of(app).platforms || app.kind === 'lambda') { left.push(`${app.name}: point it at the local ${q.name} queue (${urls[q.id]}); Koppler cannot pass it at start`); continue; }
    // A Kafka app's settings name its brokers; an SQS app's name the queue, with the SDK's endpoint beside them.
    Object.assign(set[a.id] ??= {}, q.type === 'kafka' ? {} : { AWS_ENDPOINT_URL_SQS: ENDPOINT }, Object.fromEntries(a.env.map(n => [n, q.type === 'kafka' ? KAFKA : urls[q.id]])));
  }
  return { set, left };
}

// Creates the topic on the local broker; returns its name.
export function createTopic(name) {
  execFileSync('docker', ['exec', 'koppler-kafka', '/opt/kafka/bin/kafka-topics.sh', '--bootstrap-server', 'localhost:9092', '--create', '--if-not-exists', '--topic', name], { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] });
  return name;
}
// Creates the queue in the running emulator and returns its local URL.
export function createQueue(name) {
  const { AWS_PROFILE, AWS_SESSION_TOKEN, ...plain } = process.env;
  const attrs = name.endsWith('.fifo') ? ['--attributes', 'FifoQueue=true,ContentBasedDeduplication=true'] : [];
  return execFileSync('aws', ['--endpoint-url', ENDPOINT, '--region', 'eu-west-1', '--output', 'text', 'sqs', 'create-queue', '--queue-name', name, ...attrs, '--query', 'QueueUrl'],
    { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'], env: { ...plain, AWS_ACCESS_KEY_ID: 'test', AWS_SECRET_ACCESS_KEY: 'test', AWS_PAGER: '' } }).trim();
}
