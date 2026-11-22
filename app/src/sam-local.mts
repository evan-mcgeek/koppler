// Runs an AWS SAM app's API on this Mac: `sam build`, then `sam local start-api`, with the deploy parameters of the
// environment from samconfig.toml and the settings the template declares taken from Koppler's environment (stored
// secrets, a cable's local address). Functions with other triggers (queues, schedules, streams) run once on demand.
// Usage (through `koppler run <app>`): sam-local.mjs <port> <config json: { id?, template?, envs: [samconfig names] }>
//        (through `koppler invoke`):  sam-local.mjs invoke <function> <config json> [<event file>]
import { spawn, spawnSync, type ChildProcess } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { sampleEvent } from './core/sam-events.ts';
import { takeSecrets } from './safe-env.ts';

/** The settings the template gives its functions, by name: only these reach the functions. */
export const declared = (yaml: string): string[] => [
  ...new Set(
    [...yaml.matchAll(/^(\s*)Variables:\s*\n((?:\1\s+[A-Za-z_][\w]*:.*\n?)+)/gm)].flatMap(block =>
      [...(block[2] ?? '').matchAll(/^\s+([A-Za-z_][\w]*):/gm)].map(variable => variable[1] ?? ''),
    ),
  ),
];
const FUNCTION =
  /^ {2,4}(\w+):\s*\n\s+Type:\s*AWS::Serverless::Function[\s\S]*?(?=^ {2,4}\w+:\s*\n\s+Type:|(?![\s\S]))/gm;
const TRIGGER =
  /Type:\s*(Api|HttpApi|SQS|SNS|Schedule|ScheduleV2|S3|DynamoDB|Kinesis|EventBridgeRule|CloudWatchEvent|MSK|SelfManagedKafka)\b/g;
/** Functions and what triggers each, so the ones not run here can be named. */
export const functions = (yaml: string): { name: string; triggers: string[] }[] =>
  [...yaml.matchAll(FUNCTION)].map(block => ({
    name: block[1] ?? '',
    triggers: [...new Set([...block[0].matchAll(TRIGGER)].map(trigger => trigger[1] ?? ''))],
  }));
/** samconfig.toml's parameter_overrides for the first of the environment's names that has them. */
export function overrides(toml: string, envs: string[]): { env: string; value: string } | null {
  for (const env of envs) {
    const section = new RegExp(
      `\\[${env.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}\\.deploy\\.parameters\\]([\\s\\S]*?)(?=\\n\\[|$)`,
    ).exec(toml);
    const line = /parameter_overrides\s*=\s*"((?:[^"\\]|\\.)*)"/.exec(section?.[1] ?? '');
    if (line) return { env, value: (line[1] ?? '').replace(/\\"/g, '"') };
  }
  return null;
}

const say = (text: string) => {
  console.log(`koppler: ${text}`);
};
/** A local address is the host as seen from inside the function's container. */
const inContainer = (value: string) =>
  value.replace(/\/\/(localhost|127\.0\.0\.1)(?=[:/]|$)/g, '//host.docker.internal');

/** What to do: serve the API on a port, or run one function once with an event. */
type Target = { port: number } | { invoke: string; event: string | undefined };

async function main(target: Target, config: { id?: string; template?: string; envs?: string[] }): Promise<void> {
  const template = config.template ?? ['template.yaml', 'template.yml'].find(file => fs.existsSync(file));
  if (('port' in target && !target.port) || !template || !fs.existsSync(template)) {
    console.error('usage: sam-local.mjs <port> <config json>; no SAM template here');
    process.exit(1);
  }
  const text = fs.readFileSync(template, 'utf8');
  const invoked = 'invoke' in target ? functions(text).find(one => one.name === target.invoke) : undefined;
  if ('invoke' in target && !invoked) {
    const names = functions(text).map(one => one.name);
    console.error(`koppler: no function ${target.invoke} in ${template}; it has ${names.join(', ') || 'none'}`);
    process.exit(1);
  }
  const sample = invoked && !('invoke' in target && target.event) ? sampleEvent(invoked.triggers) : null;
  if (invoked && 'invoke' in target && !target.event && !sample) {
    const by = invoked.triggers.join(', ') || 'nothing in the template';
    console.error(`koppler: no sample event for ${by}: pass one with --event <file>`);
    process.exit(1);
  }

  // Read once and taken out of the environment, so the build and Docker commands started below never carry them.
  const all = { ...process.env, ...takeSecrets() };
  const given = Object.fromEntries(
    declared(text).flatMap((name): [string, string][] => {
      const value = all[name];
      return value === undefined ? [] : [[name, inContainer(value)]];
    }),
  );
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'koppler-sam-'));
  const envFile = path.join(tmp, 'env.json');
  fs.writeFileSync(envFile, JSON.stringify({ Parameters: given }), { mode: 0o600 });
  const stop = (code: number): never => {
    fs.rmSync(tmp, { recursive: true, force: true });
    process.exit(code);
  };
  let child: ChildProcess | undefined;
  for (const signal of ['SIGTERM', 'SIGINT', 'SIGHUP'] as const)
    process.on(signal, () => {
      child?.kill('SIGTERM');
      stop(0);
    });

  const params = fs.existsSync('samconfig.toml')
    ? overrides(fs.readFileSync('samconfig.toml', 'utf8'), config.envs ?? [])
    : null;
  const withParams = params ? ['--parameter-overrides', params.value] : [];
  if (params) say(`deploy parameters from samconfig.toml [${params.env}]`);
  if (Object.keys(given).length) say(`settings passed in: ${Object.keys(given).join(', ')}`);
  if ('port' in target)
    for (const { name, triggers } of functions(text)) {
      if (triggers.some(trigger => trigger === 'Api' || trigger === 'HttpApi')) continue;
      const by = triggers.join(', ') || 'nothing in the template';
      say(`${name} is triggered by ${by}; run it once with: koppler invoke ${config.id ?? '<app>'} ${name}`);
    }

  // SAM finds Docker only through DOCKER_HOST: the endpoint of the active Docker context (Colima, Docker Desktop, ...).
  const env = { ...process.env };
  if (!env['DOCKER_HOST']) {
    const inspect = ['context', 'inspect', '--format', '{{.Endpoints.docker.Host}}'];
    const host = (spawnSync('docker', inspect, { encoding: 'utf8' }).stdout as string | null)?.trim();
    if (host) env['DOCKER_HOST'] = host;
  }
  // Built outside the repo, in Koppler's own folder for this app, so the clone stays untouched; always under the home
  // folder, which Docker on a Mac (Colima, Docker Desktop) shares with containers. SAM runs from there too, since it
  // keeps its dependency cache (.aws-sam) where it runs.
  const ownState = process.env['KOPPLER_STATE'];
  const state = ownState?.startsWith(os.homedir()) ? ownState : path.join(os.homedir(), '.local', 'state', 'koppler');
  const work = path.join(
    state,
    'sam',
    process
      .cwd()
      .replace(/[^\w.-]+/g, '_')
      .slice(-80),
  );
  const buildDir = path.join(work, 'build');
  const cacheDir = path.join(work, 'cache');
  const templatePath = path.resolve(template);
  fs.mkdirSync(work, { recursive: true });
  const sam = (args: string[]) => spawn('sam', [...args, ...withParams], { stdio: 'inherit', env, cwd: work });
  // Built with the tools on this Mac; when its runtime is not installed, in the runtime's own container.
  // The sample event first: it takes a second, the build may take minutes.
  let event = 'invoke' in target ? (target.event ?? '') : '';
  if (sample) {
    say(`a sample ${sample.join(' ')} event from sam local generate-event`);
    event = path.join(tmp, 'event.json');
    const made = spawnSync('sam', ['local', 'generate-event', ...sample], { encoding: 'utf8', env });
    if (made.status !== 0) stop(made.status ?? 1);
    fs.writeFileSync(event, made.stdout, { mode: 0o600 });
  }
  say('building the functions');
  // Not blocking, so a Stop during the build is heard at once. A build cut short is the end, not a reason to build another way.
  const build = (how: string) =>
    new Promise<number | null>(done => {
      const building = sam([
        'build',
        '--template',
        templatePath,
        '--build-dir',
        buildDir,
        '--cache-dir',
        cacheDir,
        how,
      ]);
      child = building;
      building.on('error', () => {
        done(1);
      });
      building.on('exit', (code, signal) => {
        if (signal) stop(0);
        done(code);
      });
    });
  if ((await build('--cached')) !== 0) {
    say('building in the runtime container instead');
    if ((await build('--use-container')) !== 0) stop(1);
  }

  const built = path.join(buildDir, 'template.yaml');
  if ('invoke' in target) {
    say(`invoking ${target.invoke}`);
    child = sam(['local', 'invoke', target.invoke, '--template', built, '--event', event, '--env-vars', envFile]);
    child.on('exit', code => stop(code ?? 1));
    return;
  }
  const { port } = target;
  say(`starting the API on port ${String(port)}`);
  const serve = ['--template', built, '--port', String(port), '--host', '127.0.0.1', '--env-vars', envFile];
  child = sam(['local', 'start-api', ...serve]);
  child.on('exit', code => stop(code ?? 0));
}

if (process.argv[1] && fs.realpathSync(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const [first, second, third, fourth] = process.argv.slice(2);
  const config = (raw: string | undefined) => JSON.parse(raw ?? '{}') as Parameters<typeof main>[1];
  if (first === 'invoke') await main({ invoke: second ?? '', event: fourth }, config(third));
  else await main({ port: Number(first) }, config(second));
}
