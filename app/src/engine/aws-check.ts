// `koppler discover --deployed --aws`: what AWS runs between the queues, checked against what the stack says feeds
// what. Read-only: it lists and describes EventBridge Pipes and Lambda Kafka listeners with each app's AWS profile (its
// view role when the AWS config has one), and never reads a value, a secret or a message.
import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { appOn } from '../core/stack.ts';
import type { Registry } from '../data.ts';
import { queueId } from './deployed.ts';

/** One thing AWS runs that moves messages: a pipe, or a Lambda reading Kafka. Names, not ARNs. */
export interface AwsLink {
  /** A Kafka topic, or the queue, stream or bus it reads. */
  from: string;
  /** A queue or bus by its name, or `Lambda <name>` / `API destination <name>`. */
  to: string;
  what: string;
  state: string;
}

type CheckStack = Pick<Registry, 'envs' | 'queues' | 'apps'>;

/** A name from an ARN: the queue, the bus, `Lambda <name>`, `API destination <name>`; else the ARN's last part. */
export function nameOf(arn: string): string {
  const bus = /:event-bus\/([\w.-]+)/.exec(arn)?.[1];
  if (bus) return bus;
  const fn = /:function:([\w-]+)/.exec(arn)?.[1];
  if (fn) return `Lambda ${fn}`;
  const destination = /:api-destination\/([\w.-]+)/.exec(arn)?.[1];
  if (destination) return `API destination ${destination}`;
  return arn.split(/[:/]/).pop() ?? arn;
}

/** What AWS confirms, what it has that the stack does not, and what the stack says that AWS does not run. */
export function compareFeeds(links: AwsLink[], stack: CheckStack, env: string): string[] {
  const queues = Object.entries(stack.queues ?? {});
  const realName = ([id, queue]: (typeof queues)[number]) =>
    (env === stack.envs[0] ? undefined : queue.envs?.[env]?.queue) ?? queue.queue ?? id;
  const byName = (name: string) =>
    queues.find(one => realName(one) === name) ?? queues.find(([id]) => id === queueId(name));
  const readVia = (id: string) =>
    Object.entries(stack.apps).some(([, app]) => {
      const use = app.reads?.[id];
      return !!use && typeof use === 'object' && 'via' in use;
    });
  const out: string[] = [];
  const seen = new Set<string>();
  for (const link of links) {
    const from = byName(link.from);
    const to = byName(link.to);
    const running = link.state === 'RUNNING' || link.state === 'Enabled' ? '' : ` (${link.state.toLowerCase()})`;
    const line = `${link.from} -> ${link.to} by ${link.what}${running}`;
    if (from) seen.add(from[0]);
    if (from && (Object.keys(from[1].feeds ?? {}).length || readVia(from[0]))) out.push(`OK       ${line}`);
    else if (from) out.push(`FOUND    ${line}: the stack has ${from[1].name}, but not what it feeds`);
    else if (to) out.push(`FOUND    ${line}: feeds ${to[1].name}, and the stack does not have ${link.from}`);
  }
  for (const [id, queue] of queues)
    if (Object.values(queue.feeds ?? {}).some(feed => (feed as { via?: string }).via === 'pipe') && !seen.has(id))
      out.push(
        `MISSING  ${realName([id, queue])}: the stack says a pipe reads it; no pipe in the accounts checked does`,
      );
  return out;
}

/** The profiles the stack's apps sign in with on an environment, each as its view role when the AWS config has one. */
export function profilesFor(stack: CheckStack, env: string): string[] {
  let known: string[] = [];
  try {
    known = [
      ...fs.readFileSync(path.join(os.homedir(), '.aws', 'config'), 'utf8').matchAll(/^\[profile ([^\]\s]+)\]/gm),
    ].map(match => match[1] ?? '');
  } catch {
    // No AWS config: the profiles are used as the stack names them.
  }
  const named = Object.keys(stack.apps).flatMap(id => {
    const prereqs = (appOn(stack, id, env) as { prereqs?: { sso?: unknown }[] } | undefined)?.prereqs ?? [];
    return prereqs.flatMap(need => (typeof need.sso === 'string' ? [need.sso] : []));
  });
  return [
    ...new Set(
      named.map(profile => {
        const view = profile.replace(/-(ops|admin|billing)$/, '-view');
        return known.includes(view) ? view : profile;
      }),
    ),
  ];
}

const aws = (profile: string, args: string[]): unknown =>
  JSON.parse(
    execFileSync('aws', [...args, '--profile', profile, '--output', 'json'], {
      encoding: 'utf8',
      stdio: ['ignore', 'pipe', 'pipe'],
      timeout: 60_000,
    }),
  );

/** The pipes and Kafka listeners one account runs, read with this profile. */
export function awsLinks(profile: string): AwsLink[] {
  const links: AwsLink[] = [];
  const pipes = (aws(profile, ['pipes', 'list-pipes']) as { Pipes?: { Name: string }[] }).Pipes ?? [];
  for (const { Name } of pipes) {
    const pipe = aws(profile, ['pipes', 'describe-pipe', '--name', Name]) as {
      Source?: string;
      Target?: string;
      CurrentState?: string;
      SourceParameters?: Record<string, { TopicName?: string } | undefined>;
    };
    const kafka =
      pipe.SourceParameters?.['SelfManagedKafkaParameters']?.TopicName ??
      pipe.SourceParameters?.['ManagedStreamingKafkaParameters']?.TopicName;
    links.push({
      from: kafka ?? nameOf(pipe.Source ?? ''),
      to: nameOf(pipe.Target ?? ''),
      what: `pipe ${Name}`,
      state: pipe.CurrentState ?? '',
    });
  }
  const mappings =
    (
      aws(profile, ['lambda', 'list-event-source-mappings']) as {
        EventSourceMappings?: { Topics?: string[]; FunctionArn?: string; State?: string }[];
      }
    ).EventSourceMappings ?? [];
  for (const mapping of mappings)
    for (const topic of mapping.Topics ?? [])
      links.push({
        from: topic,
        to: nameOf(mapping.FunctionArn ?? ''),
        what: 'Lambda Kafka listener',
        state: mapping.State ?? '',
      });
  return links;
}

/** Prints the check for one environment; a profile not signed in is named with how to sign in. */
export function awsCheck(stack: CheckStack, env: string): void {
  console.log(`\nAWS on ${env.toUpperCase()}: pipes and Kafka listeners against what the stack says feeds what`);
  const links: AwsLink[] = [];
  for (const profile of profilesFor(stack, env)) {
    try {
      aws(profile, ['sts', 'get-caller-identity']);
    } catch {
      console.log(`SIGN IN  ${profile}: not checked; aws sso login --profile ${profile}`);
      continue;
    }
    try {
      const found = awsLinks(profile);
      links.push(...found);
      console.log(`READ     ${profile}: ${String(found.length)} pipes and listeners`);
    } catch (error) {
      console.log(
        `FAILED   ${profile}: ${((error as { stderr?: string }).stderr ?? String(error)).trim().split('\n')[0] ?? ''}`,
      );
    }
  }
  const lines = compareFeeds(links, stack, env);
  for (const line of lines) console.log(line);
  if (!lines.length) console.log('Nothing in these accounts reads or feeds a queue the stack has.');
}
