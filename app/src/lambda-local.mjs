// Runs a queue-triggered AWS Lambda on this Mac: an AWS emulator in Docker (Floci) holds the queue, the function in its real
// runtime image and its secret; this process is the address callers post to, and prints the function's log.
// Usage (through `koppler run <app>`, which supplies the stored secret): lambda-local.mjs <config json> <port> [<overrides file>]
// Config, from the app's `lambda` in stack.json: { project, handler, runtime, timeout?, memory?, routes?: [paths],
//   secret?: { id, from } }  `from` names the stored value holding the secret's JSON; the overrides file sets keys in it.
import fs from 'node:fs';
import http from 'node:http';
import os from 'node:os';
import path from 'node:path';
import { execFileSync, spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { takeSecrets } from './safe-env.mjs';

const here = path.dirname(fileURLToPath(import.meta.url));
// Read once and taken out of the environment, so the build and Docker commands started below never carry them.
const stored = takeSecrets();
const [config, port, overridesFile] = [JSON.parse(process.argv[2] ?? 'null'), Number(process.argv[3]), process.argv[4]];
if (!config?.handler || !config.runtime || !port) { console.error('usage: lambda-local.mjs <config json> <port> [<overrides file>]'); process.exit(1); }
const emulator = port + 1, name = `koppler-lambda-${port}`, endpoint = `http://127.0.0.1:${emulator}`, arch = os.arch() === 'arm64' ? 'arm64' : 'x86_64';
const work = fs.mkdtempSync(path.join(os.tmpdir(), 'koppler-lambda-')), cache = path.join(process.env.KOPPLER_STATE || path.join(os.homedir(), '.local', 'state', 'koppler'), 'lambda');
const run = (cmd, args, opts = {}) => execFileSync(cmd, args, { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'], ...opts }).trim();
// The emulator takes any credentials. The AWS CLI gets only what it needs to run, not the user's AWS profile.
const awsEnv = { PATH: process.env.PATH ?? '', HOME: process.env.HOME ?? '', ...(process.env.TMPDIR && { TMPDIR: process.env.TMPDIR }), AWS_ACCESS_KEY_ID: 'test', AWS_SECRET_ACCESS_KEY: 'test', AWS_PAGER: '', AWS_CONFIG_FILE: '/dev/null', AWS_SHARED_CREDENTIALS_FILE: '/dev/null' };
const aws = (...args) => run('aws', ['--endpoint-url', endpoint, '--region', 'eu-west-1', '--output', 'text', ...args], { env: awsEnv });
const say = text => console.log(`koppler: ${text}`);
// The emulator starts one container per function; the ones that appear after this start are removed with it.
const functions = () => { try { return run('docker', ['ps', '-aq', '--filter', 'name=floci-aws-function']).split('\n').filter(Boolean); } catch { return []; } };
const before = new Set(functions());
let logs;
const stop = code => { try { logs?.kill(); run('docker', ['rm', '-f', name, ...functions().filter(id => !before.has(id))]); } catch {} fs.rmSync(work, { recursive: true, force: true }); process.exit(code); };
for (const sig of ['SIGTERM', 'SIGINT', 'SIGHUP']) process.on(sig, () => stop(0));

try {
  say('starting the AWS emulator');
  try { run('docker', ['rm', '-f', name]); } catch {}
  run('docker', ['run', '-d', '--name', name, '-p', `127.0.0.1:${emulator}:4566`, '-v', '/var/run/docker.sock:/var/run/docker.sock', 'floci/floci:latest']);
  for (let i = 0; ; i++) { try { await fetch(`${endpoint}/_floci/health`); break; } catch { if (i > 60) throw new Error('the emulator did not start'); await new Promise(r => setTimeout(r, 500)); } }

  say('building the function');
  const out = path.join(work, 'out');
  if (config.runtime.startsWith('dotnet')) run('dotnet', ['publish', config.project ?? '.', '-c', 'Release', '-r', `linux-${arch === 'arm64' ? 'arm64' : 'x64'}`, '--self-contained', 'false', '-o', out]);
  else fs.cpSync(path.resolve(config.project ?? '.'), out, { recursive: true }); // ponytail: other runtimes are zipped as they are, with no install or build step
  run('zip', ['-q', '-r', path.join(work, 'fn.zip'), '.'], { cwd: out });

  const extra = [];
  if (config.secret) {
    const value = stored[config.secret.from];
    if (!value) throw new Error(`${config.secret.from} is not stored; see koppler doctor`);
    let secret; try { secret = JSON.parse(value); } catch { throw new Error(`${config.secret.from} is not the secret's JSON`); }
    const set = overridesFile && fs.existsSync(overridesFile) ? JSON.parse(fs.readFileSync(overridesFile, 'utf8')).set ?? {} : {};
    for (const key of Object.keys(set)) say(`${key} points at ${set[key]}`);
    const file = path.join(work, 'secret.json');
    fs.writeFileSync(file, JSON.stringify({ ...secret, ...set }), { mode: 0o600 });
    aws('secretsmanager', 'create-secret', '--name', config.secret.id, '--secret-string', `file://${file}`, '--query', 'Name');
    fs.rmSync(file);
    // The function asks the AWS secrets extension on localhost:2773; a stand-in answers there from the emulator's Secrets Manager.
    const proxy = path.join(cache, `secrets-proxy-${arch}`);
    if (!fs.existsSync(proxy)) {
      say('building the secrets stand-in (once)');
      fs.mkdirSync(cache, { recursive: true });
      // Built in a folder under the home directory, which Docker on a Mac can always mount.
      const src = path.join(cache, 'src'); fs.mkdirSync(src, { recursive: true });
      fs.copyFileSync(path.join(here, 'lambda-secrets-proxy.go'), path.join(src, 'main.go'));
      fs.writeFileSync(path.join(src, 'go.mod'), 'module secretsproxy\ngo 1.22\n');
      run('docker', ['run', '--rm', '-v', `${src}:/src`, '-w', '/src', '-e', 'CGO_ENABLED=0', '-e', `GOARCH=${arch === 'arm64' ? 'arm64' : 'amd64'}`, 'golang:1.22-alpine', 'go', 'build', '-ldflags=-s -w', '-o', 'secrets-proxy', '.']);
      fs.copyFileSync(path.join(src, 'secrets-proxy'), proxy);
    }
    const layer = path.join(work, 'layer'); fs.mkdirSync(layer);
    fs.copyFileSync(proxy, path.join(layer, 'secrets-proxy'));
    fs.writeFileSync(path.join(layer, 'wrapper'), '#!/bin/sh\n/opt/secrets-proxy &\nexec "$@"\n');
    for (const f of ['secrets-proxy', 'wrapper']) fs.chmodSync(path.join(layer, f), 0o755);
    run('zip', ['-q', '-r', path.join(work, 'layer.zip'), '.'], { cwd: layer });
    const arn = aws('lambda', 'publish-layer-version', '--layer-name', 'secrets-standin', '--zip-file', `fileb://${path.join(work, 'layer.zip')}`, '--query', 'LayerVersionArn');
    extra.push('--layers', arn, '--environment', 'Variables={AWS_LAMBDA_EXEC_WRAPPER=/opt/wrapper}');
  }

  say('creating the queue and the function');
  const queue = aws('sqs', 'create-queue', '--queue-name', 'requests', '--query', 'QueueUrl');
  const queueArn = aws('sqs', 'get-queue-attributes', '--queue-url', queue, '--attribute-names', 'QueueArn', '--query', 'Attributes.QueueArn');
  aws('lambda', 'create-function', '--function-name', 'function', '--runtime', config.runtime, '--architectures', arch, '--handler', config.handler, '--role', 'arn:aws:iam::000000000000:role/lambda',
    '--zip-file', `fileb://${path.join(work, 'fn.zip')}`, '--timeout', String(config.timeout ?? 30), '--memory-size', String(config.memory ?? 256), ...extra, '--query', 'FunctionName');
  aws('lambda', 'create-event-source-mapping', '--function-name', 'function', '--event-source-arn', queueArn, '--batch-size', '10', '--function-response-types', 'ReportBatchItemFailures', '--query', 'State');

  // What API Gateway does in the cloud: a POST on one of the routes becomes a message on the queue.
  const routes = (config.routes ?? []).map(r => `/${String(r).replace(/^\/+|\/+$/g, '')}`);
  http.createServer((req, res) => {
    const where = new URL(req.url, 'http://x').pathname.replace(/\/+$/, '') || '/';
    if (req.method === 'GET' && where === '/') return res.writeHead(200, { 'content-type': 'text/plain' }).end(`koppler: local Lambda ${config.handler}\n`);
    // For Koppler's flow check: the emulator is up, the function is deployed and its queue trigger is on.
    if (req.method === 'GET' && where === '/health') {
      let state; try { state = { function: aws('lambda', 'get-function', '--function-name', 'function', '--query', 'Configuration.State'), trigger: aws('lambda', 'list-event-source-mappings', '--function-name', 'function', '--query', 'EventSourceMappings[0].State') }; } catch { state = { error: 'the emulator does not answer' }; }
      const ok = state.function === 'Active' && state.trigger === 'Enabled';
      return res.writeHead(ok ? 200 : 503, { 'content-type': 'application/json' }).end(JSON.stringify({ koppler: 'lambda', ok, ...state }));
    }
    if (req.method !== 'POST' || (routes.length && !routes.includes(where))) return res.writeHead(404).end();
    let body = ''; req.on('data', c => { body += c; if (body.length > 262144) req.destroy(); });
    req.on('end', async () => {
      try {
        const sent = await fetch(endpoint, { method: 'POST', headers: { 'content-type': 'application/x-www-form-urlencoded', authorization: `AWS4-HMAC-SHA256 Credential=test/${new Date().toISOString().slice(0, 10).replace(/-/g, '')}/eu-west-1/sqs/aws4_request, SignedHeaders=host, Signature=0` },
          body: new URLSearchParams({ Action: 'SendMessage', Version: '2012-11-05', QueueUrl: queue, MessageBody: body }) });
        console.log(`koppler: POST ${where} -> queue (${sent.status})`);
        res.writeHead(sent.status, { 'content-type': sent.headers.get('content-type') ?? 'text/xml' }).end(await sent.text());
      } catch { res.writeHead(502).end(); }
    });
  }).listen(port, '127.0.0.1', () => say(`ready: POST http://localhost:${port}${routes[0] ?? '/'} reaches the function through its queue`));

  logs = spawn('docker', ['logs', '-f', '--since', '0s', name], { stdio: ['ignore', 'pipe', 'pipe'] });
  const print = chunk => { for (const line of String(chunk).split('\n')) { const m = line.match(/\[lambda:[^\]]*\] (.*)$/) ?? line.match(/(ESM [^:]*: .*)$/); if (m) console.log(m[1]); } };
  logs.stdout.on('data', print); logs.stderr.on('data', print);
  logs.on('exit', () => { console.error('koppler: the emulator stopped'); stop(1); });
} catch (e) {
  console.error(`koppler: ${String(e.stderr ?? '').trim().split('\n').pop() || e.message}`);
  stop(1);
}
