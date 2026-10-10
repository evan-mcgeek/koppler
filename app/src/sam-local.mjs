// Runs an AWS SAM app's API on this Mac: `sam build`, then `sam local start-api`, with the deploy parameters of the
// environment from samconfig.toml and the settings the template declares taken from Koppler's environment (stored
// secrets, a cable's local address). Functions with other triggers (queues, schedules, streams) are listed, not run.
// Usage (through `koppler run <app>`): sam-local.mjs <port> <config json: { template?, envs: [samconfig env names] }>
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawn, spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

// The settings the template gives its functions, by name: only these reach the functions.
export const declared = yaml => [...new Set([...yaml.matchAll(/^(\s*)Variables:\s*\n((?:\1\s+[A-Za-z_][\w]*:.*\n?)+)/gm)].flatMap(m => [...m[2].matchAll(/^\s+([A-Za-z_][\w]*):/gm)].map(v => v[1])))];
// Functions and what triggers each, so the ones not run here can be named.
export const functions = yaml => [...yaml.matchAll(/^ {2,4}(\w+):\s*\n\s+Type:\s*AWS::Serverless::Function[\s\S]*?(?=^ {2,4}\w+:\s*\n\s+Type:|(?![\s\S]))/gm)]
  .map(m => ({ name: m[1], triggers: [...new Set([...m[0].matchAll(/Type:\s*(Api|HttpApi|SQS|SNS|Schedule|ScheduleV2|S3|DynamoDB|Kinesis|EventBridgeRule|CloudWatchEvent|MSK|SelfManagedKafka)\b/g)].map(t => t[1]))] }));
// samconfig.toml's parameter_overrides for the first of the environment's names that has them.
export function overrides(toml, envs) {
  for (const env of envs) {
    const section = toml.match(new RegExp(`\\[${env}\\.deploy\\.parameters\\]([\\s\\S]*?)(?=\\n\\[|$)`));
    const line = section?.[1].match(/parameter_overrides\s*=\s*"((?:[^"\\]|\\.)*)"/);
    if (line) return { env, value: line[1].replace(/\\"/g, '"') };
  }
  return null;
}

if (process.argv[1] && fs.realpathSync(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const [port, config] = [Number(process.argv[2]), JSON.parse(process.argv[3] ?? '{}')];
  const say = text => console.log(`koppler: ${text}`);
  const template = config.template ?? ['template.yaml', 'template.yml'].find(f => fs.existsSync(f));
  if (!port || !template || !fs.existsSync(template)) { console.error('usage: sam-local.mjs <port> <config json>; no SAM template here'); process.exit(1); }
  const text = fs.readFileSync(template, 'utf8');

  const vars = declared(text);
  // A local address is the host as seen from inside the function's container.
  const inContainer = v => String(v).replace(/\/\/(localhost|127\.0\.0\.1)(?=[:/]|$)/g, '//host.docker.internal');
  const given = Object.fromEntries(vars.filter(v => process.env[v] !== undefined).map(v => [v, inContainer(process.env[v])]));
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'koppler-sam-')), envFile = path.join(tmp, 'env.json');
  fs.writeFileSync(envFile, JSON.stringify({ Parameters: given }), { mode: 0o600 });
  const stop = code => { fs.rmSync(tmp, { recursive: true, force: true }); process.exit(code); };
  let child;
  for (const sig of ['SIGTERM', 'SIGINT', 'SIGHUP']) process.on(sig, () => { child?.kill('SIGTERM'); stop(0); });

  const params = fs.existsSync('samconfig.toml') ? overrides(fs.readFileSync('samconfig.toml', 'utf8'), config.envs ?? []) : null;
  if (params) say(`deploy parameters from samconfig.toml [${params.env}]`);
  if (Object.keys(given).length) say(`settings passed in: ${Object.keys(given).join(', ')}`);
  const others = functions(text).filter(f => !f.triggers.some(t => t === 'Api' || t === 'HttpApi'));
  for (const f of others) say(`${f.name} is not run here (triggered by ${f.triggers.join(', ') || 'nothing in the template'})`);

  // SAM finds Docker only through DOCKER_HOST: the endpoint of the active Docker context (Colima, Docker Desktop, ...).
  const env = { ...process.env };
  if (!env.DOCKER_HOST) { const host = spawnSync('docker', ['context', 'inspect', '--format', '{{.Endpoints.docker.Host}}'], { encoding: 'utf8' }).stdout?.trim(); if (host) env.DOCKER_HOST = host; }
  // Built outside the repo, in Koppler's own folder for this app, so the clone stays untouched; always under the home
  // folder, which Docker on a Mac (Colima, Docker Desktop) shares with containers. SAM runs from there too, since it
  // keeps its dependency cache (.aws-sam) where it runs.
  const ownState = process.env.KOPPLER_STATE, state = ownState && ownState.startsWith(os.homedir()) ? ownState : path.join(os.homedir(), '.local', 'state', 'koppler');
  const work = path.join(state, 'sam', process.cwd().replace(/[^\w.-]+/g, '_').slice(-80)), buildDir = path.join(work, 'build'), cacheDir = path.join(work, 'cache'), templatePath = path.resolve(template);
  fs.mkdirSync(work, { recursive: true });
  // Built with the tools on this Mac; when its runtime is not installed, in the runtime's own container.
  say('building the functions');
  // Not blocking, so a Stop during the build is heard at once. A build cut short is the end, not a reason to build another way.
  const build = args => new Promise(done => {
    child = spawn('sam', ['build', '--template', templatePath, '--build-dir', buildDir, '--cache-dir', cacheDir, ...args, ...(params ? ['--parameter-overrides', params.value] : [])], { stdio: 'inherit', env, cwd: work });
    child.on('error', () => done(1));
    child.on('exit', (code, signal) => signal ? stop(0) : done(code));
  });
  if (await build(['--cached']) !== 0) { say('building in the runtime container instead'); if (await build(['--use-container']) !== 0) stop(1); }

  say(`starting the API on port ${port}`);
  child = spawn('sam', ['local', 'start-api', '--template', path.join(buildDir, 'template.yaml'), '--port', String(port), '--host', '127.0.0.1', '--env-vars', envFile, ...(params ? ['--parameter-overrides', params.value] : [])], { stdio: 'inherit', env, cwd: work });
  child.on('exit', code => stop(code ?? 0));
}
