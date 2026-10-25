// Queues switched to local on the board.
//   SQS: one AWS emulator in Docker (the image the Lambda kind uses) holds them all; every app on one starts with the AWS
//   SDK's SQS endpoint pointed at it and its queue settings set to the local queue.
//   Kafka: one local broker in Docker (apache/kafka); the topic is created on it and every app on one starts with its
//   broker settings pointed at it.
import { execFileSync } from 'node:child_process';
import { of as kindOf } from '../core/kinds.ts';
import { LOCAL_QUEUE_TYPES } from '../core/plan.ts';
import type { Stack } from '../core/stack.ts';

export const PORT = 4566;
export const ENDPOINT = `http://127.0.0.1:${String(PORT)}`;
// Stopping the Docker client does not stop its container: it is removed on stop, and a leftover one before starting.
const RM = 'docker rm -f koppler-queues >/dev/null 2>&1';
// Run by Stop as well: the shell's own cleanup never happens when it has to be killed.
export const STOP_EMULATOR = ['docker', 'rm', '-f', 'koppler-queues'];
export const STOP_BROKER = ['docker', 'rm', '-f', 'koppler-kafka'];
export const EMULATOR = [
  'sh',
  '-c',
  `${RM}; trap '${RM}; exit 0' TERM INT HUP; docker run --rm --name koppler-queues -p 127.0.0.1:${String(PORT)}:4566 floci/floci:latest & wait`,
];
export const KAFKA_PORT = 9092;
// IPv4, as published: `localhost` is IPv6 first on a Mac, where nothing listens, and a client follows the broker's
// advertised address after it first connects.
export const KAFKA = `127.0.0.1:${String(KAFKA_PORT)}`;
const RM_KAFKA = 'docker rm -f koppler-kafka >/dev/null 2>&1';
// Given any setting, the image drops all its defaults: the whole single-node setup is given.
const BROKER_SETTINGS = {
  KAFKA_NODE_ID: '1',
  KAFKA_PROCESS_ROLES: 'broker,controller',
  KAFKA_LISTENERS: 'PLAINTEXT://:9092,CONTROLLER://:9093',
  KAFKA_ADVERTISED_LISTENERS: `PLAINTEXT://${KAFKA}`,
  KAFKA_CONTROLLER_LISTENER_NAMES: 'CONTROLLER',
  KAFKA_LISTENER_SECURITY_PROTOCOL_MAP: 'CONTROLLER:PLAINTEXT,PLAINTEXT:PLAINTEXT',
  KAFKA_CONTROLLER_QUORUM_VOTERS: '1@localhost:9093',
  KAFKA_OFFSETS_TOPIC_REPLICATION_FACTOR: '1',
  KAFKA_TRANSACTION_STATE_LOG_REPLICATION_FACTOR: '1',
  KAFKA_TRANSACTION_STATE_LOG_MIN_ISR: '1',
  KAFKA_GROUP_INITIAL_REBALANCE_DELAY_MS: '0',
};
const settings = Object.entries(BROKER_SETTINGS)
  .map(([key, value]) => `-e ${key}=${value}`)
  .join(' ');
export const BROKER = [
  'sh',
  '-c',
  `${RM_KAFKA}; trap '${RM_KAFKA}; exit 0' TERM INT HUP; docker run --rm --name koppler-kafka -p 127.0.0.1:${String(KAFKA_PORT)}:9092 ${settings} apache/kafka:latest & wait`,
];

/** A queue of the board that runs locally, and the apps on it with the settings that name it. */
export interface LocalQueue {
  id: string;
  name: string;
  type: string;
  /** The queue's own name in this environment. */
  queue: string;
  apps: { id: string; env: string[] }[];
}
type QueueStack = Pick<Stack, 'apps' | 'queues'>;

/** How an app uses a queue, as its `publishes` or `reads` records it. */
const useOf = (stack: QueueStack, app: string, queue: string) =>
  (['publishes', 'reads'] as const)
    .map(key => stack.apps[app]?.[key]?.[queue] as { env?: string | string[] } | undefined)
    .find(Boolean);

/** The local queues of a board and the apps on each; what cannot be local is in `left`. */
export function localQueues(
  stack: QueueStack,
  queues: Record<string, string> | undefined,
  ids: string[],
  env: string,
): { queues: LocalQueue[]; left: string[] } {
  const out: LocalQueue[] = [];
  const left: string[] = [];
  for (const [id, where] of Object.entries(queues ?? {})) {
    const queue = stack.queues?.[id];
    if (where !== 'local' || !queue) continue;
    if (!(LOCAL_QUEUE_TYPES as readonly string[]).includes(queue.type)) {
      left.push(`${queue.name}: Koppler cannot run a ${queue.type} queue locally yet; it stays the deployed one`);
      continue;
    }
    const apps = ids.flatMap(app => {
      const use = useOf(stack, app, id);
      return use ? [{ id: app, env: [use.env ?? []].flat() }] : [];
    });
    out.push({ id, name: queue.name, type: queue.type, queue: queue.envs?.[env]?.queue ?? queue.queue ?? id, apps });
  }
  return { queues: out, left };
}

/** Settings per app for the created queues (`urls` by queue id); apps that take none at start are left for the agent. */
export function queueEnv(
  stack: QueueStack,
  list: LocalQueue[],
  urls: Record<string, string>,
): { set: Record<string, Record<string, string>>; left: string[] } {
  const set: Record<string, Record<string, string>> = {};
  const left: string[] = [];
  for (const queue of list)
    for (const { id, env } of queue.apps) {
      const app = stack.apps[id];
      const url = urls[queue.id];
      if (!app || url === undefined) continue;
      if (kindOf(app).platforms || app.kind === 'lambda') {
        left.push(`${app.name}: point it at the local ${queue.name} queue (${url}); Koppler cannot pass it at start`);
        continue;
      }
      // A Kafka app's settings name its brokers; an SQS app's name the queue, with the SDK's endpoint beside them.
      const kafka = queue.type === 'kafka';
      Object.assign(
        (set[id] ??= {}),
        kafka ? {} : { AWS_ENDPOINT_URL_SQS: ENDPOINT },
        Object.fromEntries(env.map(name => [name, kafka ? KAFKA : url])),
      );
    }
  return { set, left };
}

/** Creates the topic on the local broker; returns its name. */
export function createTopic(name: string): string {
  const create = ['--bootstrap-server', KAFKA, '--create', '--if-not-exists', '--topic', name];
  execFileSync('docker', ['exec', 'koppler-kafka', '/opt/kafka/bin/kafka-topics.sh', ...create], {
    encoding: 'utf8',
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  return name;
}

/** Creates the queue in the running emulator and returns its local URL. */
export function createQueue(name: string): string {
  const attrs = name.endsWith('.fifo') ? ['--attributes', 'FifoQueue=true,ContentBasedDeduplication=true'] : [];
  const create = ['sqs', 'create-queue', '--queue-name', name, ...attrs, '--query', 'QueueUrl'];
  return execFileSync('aws', ['--endpoint-url', ENDPOINT, '--region', 'eu-west-1', '--output', 'text', ...create], {
    encoding: 'utf8',
    stdio: ['ignore', 'pipe', 'pipe'],
    // The emulator takes any key; the user's own profile and session must not reach it.
    env: {
      ...process.env,
      AWS_PROFILE: undefined,
      AWS_SESSION_TOKEN: undefined,
      AWS_ACCESS_KEY_ID: 'test',
      AWS_SECRET_ACCESS_KEY: 'test',
      AWS_PAGER: '',
    },
  }).trim();
}
