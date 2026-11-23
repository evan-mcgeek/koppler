// Queues switched to local on the board, and the Lambdas that read them.
//   SQS, SNS and EventBridge: one AWS emulator in Docker holds them all; every app on one starts with the AWS SDK's
//   endpoint for it pointed at the emulator and its settings set to the local queue, topic or bus. A Lambda runs in the
//   same emulator, triggered by an SQS queue it reads. A local topic or bus feeds only a local SQS queue.
//   Kafka: one local broker in Docker (apache/kafka); the topic is created on it and every app on one starts with its
//   broker settings pointed at it.
import { execFileSync } from 'node:child_process';
import { of as kindOf } from '../core/kinds.ts';
import { LOCAL_QUEUE_TYPES } from '../core/plan.ts';
import type { Stack } from '../core/stack.ts';
import type { FeedVia } from '../core/terraform.ts';

export const PORT = 4566;
export const ENDPOINT = `http://127.0.0.1:${String(PORT)}`;
// Where the local queues are made, and what every app on one signs for.
export const REGION = 'eu-west-1';
// By version and digest, so a new upstream push never changes what runs here unseen. To update: read the digest of the
// new version tag on Docker Hub, then change both together.
export const EMULATOR_IMAGE =
  'floci/floci:2.2.0@sha256:e97cd0c1dc2aa14e7697fb5ef5018404c4d6345169dbd276315f0bed2c7b0520';
// Each Lambda runs in a container of its own, with a code volume, named from this so only Koppler's are removed.
export const FUNCTIONS = 'koppler-fn';
// Stopping the Docker client does not stop its container: it is removed on stop, and a leftover one before starting;
// with it go the functions it started.
const RM = [
  'docker rm -f koppler-queues',
  `docker ps -aq --filter name=${FUNCTIONS}- | xargs docker rm -f`,
  `docker volume ls -q --filter name=${FUNCTIONS}-code- | xargs docker volume rm`,
]
  .map(command => `${command} >/dev/null 2>&1`)
  .join('; ');
// Run by Stop as well: the shell's own cleanup never happens when it has to be killed.
export const STOP_EMULATOR = ['sh', '-c', RM];
export const STOP_BROKER = ['docker', 'rm', '-f', 'koppler-kafka'];
export const EMULATOR = [
  'sh',
  '-c',
  `${RM}; trap '${RM}; exit 0' TERM INT HUP; docker run --rm --name koppler-queues -p 127.0.0.1:${String(PORT)}:4566 -v /var/run/docker.sock:/var/run/docker.sock -e FLOCI_DEFAULT_REGION=${REGION} -e FLOCI_SERVICES_LAMBDA_CONTAINER_NAME_PREFIX=${FUNCTIONS} ${EMULATOR_IMAGE} & wait`,
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

/** The local queues a Lambda reads, by URL, comma between them: the queues it is triggered by. */
export const LAMBDA_QUEUES = 'KOPPLER_LAMBDA_QUEUES';
/** The settings Koppler set for a Lambda that sends to a local queue, topic or bus, comma between them. */
export const LAMBDA_SETTINGS = 'KOPPLER_LAMBDA_SETTINGS';
/** The setting each AWS SDK reads for the address of one service. */
const ENDPOINT_SETTING: Record<string, string> = {
  sqs: 'AWS_ENDPOINT_URL_SQS',
  sns: 'AWS_ENDPOINT_URL_SNS',
  eventbridge: 'AWS_ENDPOINT_URL_EVENTBRIDGE',
};
const WORD: Record<string, string> = { sns: 'topic', eventbridge: 'event bus' };

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
  const append = (id: string, name: string, value: string) => {
    const all = set[id]?.[name];
    (set[id] ??= {})[name] = all ? `${all},${value}` : value;
  };
  for (const queue of list)
    for (const { id, env } of queue.apps) {
      const app = stack.apps[id];
      const url = urls[queue.id];
      if (!app || url === undefined) continue;
      const kafka = queue.type === 'kafka';
      if (app.kind === 'lambda' && !kafka) {
        // A Lambda that reads an SQS queue is triggered by it in the emulator, as its event source mapping does deployed.
        if (app.reads?.[queue.id] && queue.type === 'sqs') append(id, LAMBDA_QUEUES, url);
        else if (app.reads?.[queue.id])
          left.push(`${app.name}: Koppler triggers a local Lambda only from an SQS queue, not from ${queue.name}.`);
        // The emulator is its endpoint already: it gets only the settings that name the queue.
        else
          for (const name of env) {
            (set[id] ??= {})[name] = url;
            append(id, LAMBDA_SETTINGS, name);
          }
        continue;
      }
      if (kindOf(app).platforms || app.kind === 'lambda') {
        const word = WORD[queue.type] ?? 'queue';
        left.push(`${app.name}: point it at the local ${queue.name} ${word} (${url}); Koppler cannot pass it at start`);
        continue;
      }
      // A Kafka app's settings name its brokers; an AWS app's name the queue, with the SDK's endpoint beside them.
      Object.assign(
        (set[id] ??= {}),
        kafka ? {} : { [ENDPOINT_SETTING[queue.type] ?? 'AWS_ENDPOINT_URL']: ENDPOINT },
        // At an endpoint of its own, the AWS SDK for .NET signs for us-east-1 whatever its region; the emulator
        // keeps queues by the region a request is signed for.
        !kafka && app.kind === 'dotnet' ? { AWS__AuthenticationRegion: REGION } : {},
        Object.fromEntries(env.map(name => [name, kafka ? KAFKA : url])),
      );
    }
  return { set, left };
}

/** A local topic or bus and the local SQS queue it feeds. */
export interface LocalFeed {
  from: LocalQueue;
  to: LocalQueue;
  via: FeedVia;
}
const RUNS_HERE: Record<string, FeedVia> = { sns: 'subscription', eventbridge: 'rule' };

/** What the local queues feed: a topic's subscription or a bus's rule to a local SQS queue; the rest is said in `left`. */
export function localFeeds(stack: QueueStack, list: LocalQueue[]): { feeds: LocalFeed[]; left: string[] } {
  const feeds: LocalFeed[] = [];
  const left: string[] = [];
  for (const from of list)
    for (const [id, { via }] of Object.entries(stack.queues?.[from.id]?.feeds ?? {})) {
      const to = list.find(queue => queue.id === id);
      const name = stack.queues?.[id]?.name ?? id;
      if (!to) left.push(`${from.name} feeds ${name}, which stays deployed. Local messages do not reach it.`);
      else if (RUNS_HERE[from.type] !== via || to.type !== 'sqs')
        left.push(`Koppler cannot run the ${via} from ${from.name} to ${name} here yet.`);
      else feeds.push({ from, to, via });
    }
  return { feeds, left };
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

/** The AWS CLI against the running emulator, never the user's AWS account; returns what it printed. */
function emulator(...args: string[]): string {
  return execFileSync('aws', ['--endpoint-url', ENDPOINT, '--region', REGION, '--output', 'text', ...args], {
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

const FIFO = 'ContentBasedDeduplication=true';
/** Makes the queue, topic or bus in the running emulator; returns what an app names it by: a URL, an ARN or a name. */
export function createLocal(type: string, name: string): string {
  const fifo = name.endsWith('.fifo');
  if (type === 'sqs')
    return emulator(
      ...['sqs', 'create-queue', '--queue-name', name],
      ...(fifo ? ['--attributes', `FifoQueue=true,${FIFO}`] : []),
      ...['--query', 'QueueUrl'],
    );
  if (type === 'sns')
    return emulator(
      ...['sns', 'create-topic', '--name', name],
      ...(fifo ? ['--attributes', `FifoTopic=true,${FIFO}`] : []),
      ...['--query', 'TopicArn'],
    );
  // The default bus is always there; a bus an earlier run made is kept.
  if (name !== 'default')
    try {
      emulator('events', 'create-event-bus', '--name', name, '--query', 'EventBusArn');
    } catch (error) {
      if (!String((error as { stderr?: string }).stderr).includes('ResourceAlreadyExists')) throw error;
    }
  return name;
}

/**
 * Sends what reaches a local topic or bus on to a local SQS queue: a subscription, or a rule that matches every event.
 * ponytail: the deployed rule's pattern and a subscription's raw delivery are not in the stack; read them when needed.
 */
export function feedLocal(from: { type: string; address: string }, queueUrl: string): void {
  const attribute = ['--attribute-names', 'QueueArn', '--query', 'Attributes.QueueArn'];
  const arn = emulator('sqs', 'get-queue-attributes', '--queue-url', queueUrl, ...attribute);
  if (from.type === 'sns') {
    emulator('sns', 'subscribe', '--topic-arn', from.address, '--protocol', 'sqs', '--notification-endpoint', arn);
    return;
  }
  const rule = `koppler-to-${arn.split(':').pop() ?? ''}`.slice(0, 64);
  const on = ['--event-bus-name', from.address];
  emulator('events', 'put-rule', '--name', rule, ...on, '--event-pattern', '{"source":[{"prefix":""}]}');
  // A FIFO queue takes an event only with a message group.
  const target = {
    Id: 'koppler',
    Arn: arn,
    ...(arn.endsWith('.fifo') && { SqsParameters: { MessageGroupId: 'koppler' } }),
  };
  const targets = ['--targets', JSON.stringify([target]), '--query', 'FailedEntryCount'];
  // It answers a target it turns down with a count, not an error.
  if (emulator('events', 'put-targets', '--rule', rule, ...on, ...targets) !== '0')
    throw new Error(`the emulator turned down ${arn} as a target`);
}
