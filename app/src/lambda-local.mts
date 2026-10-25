// Runs an AWS Lambda on this Mac in the AWS emulator that holds the board's local queues (Floci, in Docker): the
// function in its real runtime image, with the settings, secrets and parameters it reads. A local queue it reads
// triggers it, as its event source mapping does deployed; with none, this process is the address callers post to and
// each POST becomes a message on a queue of its own. It prints the function's log.
// Usage (through `koppler run <app>`, which supplies the stored secrets and starts the emulator):
//   lambda-local.mjs <config json> <port> [<overrides file>] [<app id>]
// Config, from the app's `lambda` in stack.json: { project, handler, runtime, timeout?, memory?, routes?: [paths],
//   env?: [names], environment?: { name: value }, parameters?: [{ name, from }], secret?: { id, from } }
//   `env` names the settings it reads, taken from what Koppler sets (cables, stored secrets); `environment` gives fixed
//   ones; each parameter is put in Parameter Store from a stored value; `secret` names the stored value holding a
//   Secrets Manager secret's JSON, and the overrides file sets keys in it.
import { execFileSync, spawn, type ChildProcess, type ExecFileSyncOptions } from 'node:child_process';
import fs from 'node:fs';
import http from 'node:http';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { ENDPOINT, FUNCTIONS, LAMBDA_QUEUES, REGION } from './engine/queues.ts';
import { takeSecrets } from './safe-env.ts';

/** The app's `lambda` in stack.json. */
interface Config {
  project?: string;
  handler: string;
  runtime: string;
  timeout?: number;
  memory?: number;
  routes?: string[];
  env?: string[];
  environment?: Record<string, string>;
  parameters?: { name: string; from: string }[];
  /** The secret the function reads: its id in Secrets Manager, and the stored value that holds its JSON. */
  secret?: { id: string; from: string };
}

const here = path.dirname(fileURLToPath(import.meta.url));
// Read once and taken out of the environment, so the build and Docker commands started below never carry them.
const stored = takeSecrets();
const config = JSON.parse(process.argv[2] ?? 'null') as Config | null;
const port = Number(process.argv[3]);
const overridesFile = process.argv[4];
if (!config?.handler || !config.runtime || !port) {
  console.error('usage: lambda-local.mjs <config json> <port> [<overrides file>] [<app id>]');
  process.exit(1);
}
const fn = process.argv[5] || `function-${String(port)}`;
const triggers = (process.env[LAMBDA_QUEUES] ?? '').split(',').filter(Boolean);
const arch = os.arch() === 'arm64' ? 'arm64' : 'x86_64';
const work = fs.mkdtempSync(path.join(os.tmpdir(), 'koppler-lambda-'));
const state = process.env['KOPPLER_STATE'] || path.join(os.homedir(), '.local', 'state', 'koppler');
const cache = path.join(state, 'lambda');
const run = (command: string, args: string[], options: ExecFileSyncOptions = {}) =>
  execFileSync(command, args, { stdio: ['ignore', 'pipe', 'pipe'], ...options, encoding: 'utf8' }).trim();
// The emulator takes any credentials. The AWS CLI gets only what it needs to run, not the user's AWS profile.
const awsEnv = {
  PATH: process.env['PATH'] ?? '',
  HOME: process.env['HOME'] ?? '',
  ...(process.env['TMPDIR'] && { TMPDIR: process.env['TMPDIR'] }),
  AWS_ACCESS_KEY_ID: 'test',
  AWS_SECRET_ACCESS_KEY: 'test',
  AWS_PAGER: '',
  AWS_CONFIG_FILE: '/dev/null',
  AWS_SHARED_CREDENTIALS_FILE: '/dev/null',
};
const awsIn = (region: string, ...args: string[]) =>
  run('aws', ['--endpoint-url', ENDPOINT, '--region', region, '--output', 'text', ...args], { env: awsEnv });
const aws = (...args: string[]) => awsIn(REGION, ...args);
const quietly = (work: () => unknown) => {
  try {
    work();
  } catch {
    // Already gone, or never made.
  }
};
const say = (text: string) => {
  console.log(`koppler: ${text}`);
};
// The function runs in a container of its own, out of Docker's network: an address on this Mac is reached through
// Docker's name for it.
const fromDocker = (value: string) =>
  value.replace(/\/\/(localhost|127\.0\.0\.1)(?=[:/]|$)/g, '//host.docker.internal');
const requests = `${fn}-requests`;
let logs: ChildProcess | undefined;
/** What this function left in the emulator, which outlives it: its triggers, the function, its own queue and secret. */
const clean = () => {
  quietly(() => {
    const mappings = aws(
      'lambda',
      'list-event-source-mappings',
      '--function-name',
      fn,
      '--query',
      'EventSourceMappings[].UUID',
    );
    for (const uuid of mappings.split(/\s+/).filter(one => one && one !== 'None'))
      quietly(() => aws('lambda', 'delete-event-source-mapping', '--uuid', uuid));
  });
  quietly(() => aws('lambda', 'delete-function', '--function-name', fn));
  quietly(() => aws('sqs', 'delete-queue', '--queue-url', aws('sqs', 'get-queue-url', '--queue-name', requests)));
  quietly(() => {
    const left = run('docker', ['ps', '-aq', '--filter', `name=^${FUNCTIONS}-${fn}-[0-9a-f]+$`])
      .split('\n')
      .filter(Boolean);
    if (left.length) run('docker', ['rm', '-f', ...left]);
  });
  if (config.secret) {
    const { id } = config.secret;
    quietly(() => aws('secretsmanager', 'delete-secret', '--secret-id', id, '--force-delete-without-recovery'));
  }
};
const stop = (code: number): never => {
  logs?.kill();
  clean();
  fs.rmSync(work, { recursive: true, force: true });
  process.exit(code);
};
for (const signal of ['SIGTERM', 'SIGINT', 'SIGHUP'] as const) process.on(signal, () => stop(0));

/** The function's secret in the emulator, and the layer through which the function reads it. */
function withSecret(secretOf: NonNullable<Config['secret']>): { layer: string; env: Record<string, string> } {
  const value = stored[secretOf.from];
  if (!value) throw new Error(`${secretOf.from} is not stored; see koppler doctor`);
  let secret: Record<string, unknown>;
  try {
    secret = JSON.parse(value) as Record<string, unknown>;
  } catch {
    throw new Error(`${secretOf.from} is not the secret's JSON`);
  }
  const given =
    overridesFile && fs.existsSync(overridesFile)
      ? ((JSON.parse(fs.readFileSync(overridesFile, 'utf8')) as { set?: Record<string, unknown> }).set ?? {})
      : {};
  const set = Object.fromEntries(
    Object.entries(given).map(([key, points]) => [key, typeof points === 'string' ? fromDocker(points) : points]),
  );
  for (const [key, points] of Object.entries(set)) say(`${key} points at ${String(points)}`);
  const file = path.join(work, 'secret.json');
  fs.writeFileSync(file, JSON.stringify({ ...secret, ...set }), { mode: 0o600 });
  aws('secretsmanager', 'create-secret', '--name', secretOf.id, '--secret-string', `file://${file}`, '--query', 'Name');
  fs.rmSync(file);
  // The function asks the AWS secrets extension on localhost:2773; a stand-in answers there from the emulator's Secrets Manager.
  const proxy = path.join(cache, `secrets-proxy-${arch}`);
  if (!fs.existsSync(proxy)) {
    say('building the secrets stand-in (once)');
    fs.mkdirSync(cache, { recursive: true });
    // Built in a folder under the home directory, which Docker on a Mac can always mount.
    const src = path.join(cache, 'src');
    fs.mkdirSync(src, { recursive: true });
    fs.copyFileSync(path.join(here, 'lambda-secrets-proxy.go'), path.join(src, 'main.go'));
    fs.writeFileSync(path.join(src, 'go.mod'), 'module secretsproxy\ngo 1.22\n');
    const goArch = `GOARCH=${arch === 'arm64' ? 'arm64' : 'amd64'}`;
    const build = ['go', 'build', '-ldflags=-s -w', '-o', 'secrets-proxy', '.'];
    const inGo = ['-v', `${src}:/src`, '-w', '/src', '-e', 'CGO_ENABLED=0', '-e', goArch, 'golang:1.22-alpine'];
    run('docker', ['run', '--rm', ...inGo, ...build]);
    fs.copyFileSync(path.join(src, 'secrets-proxy'), proxy);
  }
  const layer = path.join(work, 'layer');
  fs.mkdirSync(layer);
  fs.copyFileSync(proxy, path.join(layer, 'secrets-proxy'));
  fs.writeFileSync(path.join(layer, 'wrapper'), '#!/bin/sh\n/opt/secrets-proxy &\nexec "$@"\n');
  for (const file of ['secrets-proxy', 'wrapper']) fs.chmodSync(path.join(layer, file), 0o755);
  const zipped = path.join(work, 'layer.zip');
  run('zip', ['-q', '-r', zipped, '.'], { cwd: layer });
  const published = [
    '--layer-name',
    'secrets-standin',
    '--zip-file',
    `fileb://${zipped}`,
    '--query',
    'LayerVersionArn',
  ];
  const arn = aws('lambda', 'publish-layer-version', ...published);
  return { layer: arn, env: { AWS_LAMBDA_EXEC_WRAPPER: '/opt/wrapper' } };
}

/** Each parameter, put in Parameter Store from its stored value. */
function putParameters(parameters: NonNullable<Config['parameters']>): void {
  for (const { name, from } of parameters) {
    const value = stored[from];
    if (!value) throw new Error(`${from} is not stored; see koppler doctor`);
    const file = path.join(work, 'parameter');
    fs.writeFileSync(file, value, { mode: 0o600 });
    // Also where the AWS SDK for .NET looks: at an endpoint of its own it signs for us-east-1 whatever its region.
    for (const region of new Set([REGION, 'us-east-1']))
      awsIn(
        region,
        'ssm',
        'put-parameter',
        '--name',
        name,
        '--type',
        'SecureString',
        '--overwrite',
        '--value',
        `file://${file}`,
      );
    fs.rmSync(file);
    say(`parameter ${name} set from ${from}`);
  }
}

/** The settings the function reads: fixed ones, then what Koppler set (a cable's address, a stored secret). */
function environment(): Record<string, string> {
  const variables: Record<string, string> = { ...config?.environment };
  for (const name of config?.env ?? []) {
    const value = stored[name] ?? process.env[name];
    if (value !== undefined) variables[name] = fromDocker(value);
    else if (!(name in variables)) say(`${name} is not set: the function starts without it`);
  }
  return variables;
}

/** For Koppler's flow check: the function is deployed and its trigger is on. */
function health(): { ok: boolean; function?: string; trigger?: string; error?: string } {
  const of = (...query: string[]) => aws('lambda', ...query);
  try {
    const deployed = of('get-function', '--function-name', fn, '--query', 'Configuration.State');
    const trigger = of('list-event-source-mappings', '--function-name', fn, '--query', 'EventSourceMappings[0].State');
    return { ok: deployed === 'Active' && trigger === 'Enabled', function: deployed, trigger };
  } catch {
    return { ok: false, error: 'the emulator does not answer' };
  }
}

try {
  for (let tries = 0; ; tries++) {
    try {
      await fetch(`${ENDPOINT}/_floci/health`);
      break;
    } catch {
      if (tries > 120)
        throw new Error(`the AWS emulator does not answer on ${ENDPOINT}; start it with the board's run`);
      await new Promise(resolve => setTimeout(resolve, 500));
    }
  }

  say('building the function');
  const out = path.join(work, 'out');
  const project = config.project ?? '.';
  if (config.runtime.startsWith('dotnet')) {
    const target = `linux-${arch === 'arm64' ? 'arm64' : 'x64'}`;
    run('dotnet', ['publish', project, '-c', 'Release', '-r', target, '--self-contained', 'false', '-o', out]);
  }
  // ponytail: other runtimes are zipped as they are, with no install or build step
  else fs.cpSync(path.resolve(project), out, { recursive: true });
  const zipped = path.join(work, 'fn.zip');
  run('zip', ['-q', '-r', zipped, '.'], { cwd: out });

  // What a run that could not clean up left goes first.
  clean();
  const secret = config.secret ? withSecret(config.secret) : undefined;
  if (config.parameters?.length) putParameters(config.parameters);
  const variables = { ...environment(), ...secret?.env };

  say('creating the function');
  aws(
    'lambda',
    'create-function',
    ...['--function-name', fn, '--runtime', config.runtime, '--architectures', arch],
    ...['--handler', config.handler, '--role', 'arn:aws:iam::000000000000:role/lambda'],
    ...['--zip-file', `fileb://${zipped}`, '--timeout', String(config.timeout ?? 30)],
    ...['--memory-size', String(config.memory ?? 256), '--environment', JSON.stringify({ Variables: variables })],
    ...(secret ? ['--layers', secret.layer] : []),
    ...['--query', 'FunctionName'],
  );
  const trigger = (queue: string) => {
    const attribute = ['--attribute-names', 'QueueArn', '--query', 'Attributes.QueueArn'];
    const queueArn = aws('sqs', 'get-queue-attributes', '--queue-url', queue, ...attribute);
    aws(
      'lambda',
      'create-event-source-mapping',
      ...['--function-name', fn, '--event-source-arn', queueArn, '--batch-size', '10'],
      ...['--function-response-types', 'ReportBatchItemFailures', '--query', 'State'],
    );
  };
  for (const queue of triggers) {
    trigger(queue);
    say(`triggered by the local queue ${queue}`);
  }
  // With no local queue of the board, what API Gateway does in the cloud: a POST on one of the routes becomes a
  // message on a queue of its own.
  const own = triggers.length ? undefined : aws('sqs', 'create-queue', '--queue-name', requests, '--query', 'QueueUrl');
  if (own) trigger(own);
  const routes = (config.routes ?? []).map(route => `/${route.replace(/^\/+|\/+$/g, '')}`);
  const toQueue = async (queue: string, body: string) => {
    const day = new Date().toISOString().slice(0, 10).replace(/-/g, '');
    return fetch(ENDPOINT, {
      method: 'POST',
      headers: {
        'content-type': 'application/x-www-form-urlencoded',
        authorization: `AWS4-HMAC-SHA256 Credential=test/${day}/${REGION}/sqs/aws4_request, SignedHeaders=host, Signature=0`,
      },
      body: new URLSearchParams({ Action: 'SendMessage', Version: '2012-11-05', QueueUrl: queue, MessageBody: body }),
    });
  };
  const server = http.createServer((request, response) => {
    const where = new URL(request.url ?? '', 'http://x').pathname.replace(/\/+$/, '') || '/';
    if (request.method === 'GET' && where === '/') {
      response.writeHead(200, { 'content-type': 'text/plain' }).end(`koppler: local Lambda ${config.handler}\n`);
      return;
    }
    if (request.method === 'GET' && where === '/health') {
      const { ok, ...found } = health();
      const answer = JSON.stringify({ koppler: 'lambda', ok, ...found });
      response.writeHead(ok ? 200 : 503, { 'content-type': 'application/json' }).end(answer);
      return;
    }
    if (!own || request.method !== 'POST' || (routes.length && !routes.includes(where))) {
      response.writeHead(404).end();
      return;
    }
    let body = '';
    request.on('data', (chunk: Buffer) => {
      body += chunk.toString();
      if (body.length > 262144) request.destroy();
    });
    request.on('end', () => {
      toQueue(own, body)
        .then(async sent => {
          console.log(`koppler: POST ${where} -> queue (${String(sent.status)})`);
          const type = sent.headers.get('content-type') ?? 'text/xml';
          response.writeHead(sent.status, { 'content-type': type }).end(await sent.text());
        })
        .catch(() => response.writeHead(502).end());
    });
  });
  server.listen(port, '127.0.0.1', () => {
    say(
      own
        ? `ready: POST http://localhost:${String(port)}${routes[0] ?? '/'} reaches the function through its queue`
        : `ready: messages on its local queue reach the function`,
    );
  });

  const following = spawn('docker', ['logs', '-f', '--since', '0s', 'koppler-queues'], {
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  logs = following;
  const mine = new RegExp(`\\[lambda:${fn}\\b[^\\]]*\\] (.*)$`);
  const print = (chunk: Buffer) => {
    for (const line of chunk.toString().split('\n')) {
      const said = mine.exec(line) ?? (line.includes(fn) ? /(ESM [^:]*: .*)$/.exec(line) : null);
      if (said) console.log(said[1]);
    }
  };
  following.stdout.on('data', print);
  following.stderr.on('data', print);
  following.on('exit', () => {
    console.error('koppler: the emulator stopped');
    stop(1);
  });
} catch (error) {
  const { stderr, message } = error as { stderr?: string; message: string };
  console.error(`koppler: ${(stderr ?? '').trim().split('\n').pop() || message}`);
  stop(1);
}
