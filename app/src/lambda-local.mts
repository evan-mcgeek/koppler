// Runs a queue-triggered AWS Lambda on this Mac: an AWS emulator in Docker (Floci) holds the queue, the function in its real
// runtime image and its secret; this process is the address callers post to, and prints the function's log.
// Usage (through `koppler run <app>`, which supplies the stored secret): lambda-local.mjs <config json> <port> [<overrides file>]
// Config, from the app's `lambda` in stack.json: { project, handler, runtime, timeout?, memory?, routes?: [paths],
//   secret?: { id, from } }  `from` names the stored value holding the secret's JSON; the overrides file sets keys in it.
import { execFileSync, spawn, type ChildProcess, type ExecFileSyncOptions } from 'node:child_process';
import fs from 'node:fs';
import http from 'node:http';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { takeSecrets } from './safe-env.ts';

/** The app's `lambda` in stack.json. */
interface Config {
  project?: string;
  handler: string;
  runtime: string;
  timeout?: number;
  memory?: number;
  routes?: string[];
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
  console.error('usage: lambda-local.mjs <config json> <port> [<overrides file>]');
  process.exit(1);
}
const emulator = port + 1;
const name = `koppler-lambda-${String(port)}`;
const endpoint = `http://127.0.0.1:${String(emulator)}`;
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
const aws = (...args: string[]) =>
  run('aws', ['--endpoint-url', endpoint, '--region', 'eu-west-1', '--output', 'text', ...args], { env: awsEnv });
const say = (text: string) => {
  console.log(`koppler: ${text}`);
};
// The emulator starts one container per function; the ones that appear after this start are removed with it.
const functions = () => {
  try {
    return run('docker', ['ps', '-aq', '--filter', 'name=floci-aws-function']).split('\n').filter(Boolean);
  } catch {
    return [];
  }
};
const before = new Set(functions());
let logs: ChildProcess | undefined;
const stop = (code: number): never => {
  try {
    logs?.kill();
    run('docker', ['rm', '-f', name, ...functions().filter(id => !before.has(id))]);
  } catch {
    // Already gone.
  }
  fs.rmSync(work, { recursive: true, force: true });
  process.exit(code);
};
for (const signal of ['SIGTERM', 'SIGINT', 'SIGHUP'] as const) process.on(signal, () => stop(0));

/** The function's secret in the emulator, and the layer through which the function reads it; the arguments that add the layer. */
function withSecret(secretOf: NonNullable<Config['secret']>): string[] {
  const value = stored[secretOf.from];
  if (!value) throw new Error(`${secretOf.from} is not stored; see koppler doctor`);
  let secret: Record<string, unknown>;
  try {
    secret = JSON.parse(value) as Record<string, unknown>;
  } catch {
    throw new Error(`${secretOf.from} is not the secret's JSON`);
  }
  const set =
    overridesFile && fs.existsSync(overridesFile)
      ? ((JSON.parse(fs.readFileSync(overridesFile, 'utf8')) as { set?: Record<string, unknown> }).set ?? {})
      : {};
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
  return ['--layers', arn, '--environment', 'Variables={AWS_LAMBDA_EXEC_WRAPPER=/opt/wrapper}'];
}

/** For Koppler's flow check: the emulator is up, the function is deployed and its queue trigger is on. */
function health(): { ok: boolean; function?: string; trigger?: string; error?: string } {
  const of = (...query: string[]) => aws('lambda', ...query);
  try {
    const deployed = of('get-function', '--function-name', 'function', '--query', 'Configuration.State');
    const trigger = of(
      'list-event-source-mappings',
      '--function-name',
      'function',
      '--query',
      'EventSourceMappings[0].State',
    );
    return { ok: deployed === 'Active' && trigger === 'Enabled', function: deployed, trigger };
  } catch {
    return { ok: false, error: 'the emulator does not answer' };
  }
}

try {
  say('starting the AWS emulator');
  try {
    run('docker', ['rm', '-f', name]);
  } catch {
    // None left over.
  }
  const published = ['-p', `127.0.0.1:${String(emulator)}:4566`, '-v', '/var/run/docker.sock:/var/run/docker.sock'];
  run('docker', ['run', '-d', '--name', name, ...published, 'floci/floci:latest']);
  for (let tries = 0; ; tries++) {
    try {
      await fetch(`${endpoint}/_floci/health`);
      break;
    } catch {
      if (tries > 60) throw new Error('the emulator did not start');
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

  const extra = config.secret ? withSecret(config.secret) : [];

  say('creating the queue and the function');
  const queue = aws('sqs', 'create-queue', '--queue-name', 'requests', '--query', 'QueueUrl');
  const attribute = ['--attribute-names', 'QueueArn', '--query', 'Attributes.QueueArn'];
  const queueArn = aws('sqs', 'get-queue-attributes', '--queue-url', queue, ...attribute);
  aws(
    'lambda',
    'create-function',
    ...['--function-name', 'function', '--runtime', config.runtime, '--architectures', arch],
    ...['--handler', config.handler, '--role', 'arn:aws:iam::000000000000:role/lambda'],
    ...['--zip-file', `fileb://${zipped}`, '--timeout', String(config.timeout ?? 30)],
    ...['--memory-size', String(config.memory ?? 256), ...extra, '--query', 'FunctionName'],
  );
  aws(
    'lambda',
    'create-event-source-mapping',
    ...['--function-name', 'function', '--event-source-arn', queueArn, '--batch-size', '10'],
    ...['--function-response-types', 'ReportBatchItemFailures', '--query', 'State'],
  );

  // What API Gateway does in the cloud: a POST on one of the routes becomes a message on the queue.
  const routes = (config.routes ?? []).map(route => `/${route.replace(/^\/+|\/+$/g, '')}`);
  const toQueue = async (body: string) => {
    const day = new Date().toISOString().slice(0, 10).replace(/-/g, '');
    return fetch(endpoint, {
      method: 'POST',
      headers: {
        'content-type': 'application/x-www-form-urlencoded',
        authorization: `AWS4-HMAC-SHA256 Credential=test/${day}/eu-west-1/sqs/aws4_request, SignedHeaders=host, Signature=0`,
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
    if (request.method !== 'POST' || (routes.length && !routes.includes(where))) {
      response.writeHead(404).end();
      return;
    }
    let body = '';
    request.on('data', (chunk: Buffer) => {
      body += chunk.toString();
      if (body.length > 262144) request.destroy();
    });
    request.on('end', () => {
      toQueue(body)
        .then(async sent => {
          console.log(`koppler: POST ${where} -> queue (${String(sent.status)})`);
          const type = sent.headers.get('content-type') ?? 'text/xml';
          response.writeHead(sent.status, { 'content-type': type }).end(await sent.text());
        })
        .catch(() => response.writeHead(502).end());
    });
  });
  server.listen(port, '127.0.0.1', () => {
    say(`ready: POST http://localhost:${String(port)}${routes[0] ?? '/'} reaches the function through its queue`);
  });

  const following = spawn('docker', ['logs', '-f', '--since', '0s', name], { stdio: ['ignore', 'pipe', 'pipe'] });
  logs = following;
  const print = (chunk: Buffer) => {
    for (const line of chunk.toString().split('\n')) {
      const said = /\[lambda:[^\]]*\] (.*)$/.exec(line) ?? /(ESM [^:]*: .*)$/.exec(line);
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
