import './sandbox.mjs';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { test } from 'node:test';

// koppler invoke: a SAM function its API does not run (a queue, a schedule) runs once, on demand, with a sample event.
const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'koppler-invoke-'));
const bin = path.join(dir, 'bin');
const clone = path.join(dir, 'shop-jobs');
const calls = path.join(dir, 'calls');
fs.mkdirSync(bin);
fs.mkdirSync(clone);
fs.writeFileSync(
  path.join(clone, 'template.yaml'),
  `Transform: AWS::Serverless-2016-10-31
Resources:
  OrdersQueueFunction:
    Type: AWS::Serverless::Function
    Properties:
      Handler: app.handler
      Environment:
        Variables:
          ORDERS_API_URL: x
      Events:
        Orders:
          Type: SQS
  KafkaFunction:
    Type: AWS::Serverless::Function
    Properties:
      Handler: app.kafka
      Events:
        Stream:
          Type: MSK
`,
);
// A stand-in for sam: it records each call, makes a sample event, and builds and invokes at once.
fs.writeFileSync(
  path.join(bin, 'sam'),
  `#!/bin/sh
echo "$*" >> "${calls}"
case "$1 $2" in
  "local generate-event") echo '{"Records":[{"body":"sample"}]}' ;;
  "local invoke") while [ $# -gt 0 ]; do [ "$1" = --env-vars ] && cat "$2"; shift; done; echo '{"statusCode":200}' ;;
esac
`,
  { mode: 0o755 },
);
const env = {
  ...process.env,
  PATH: `${bin}:${process.env.PATH}`,
  HOME: dir,
  KOPPLER_STATE: path.join(dir, 'state'),
  KOPPLER_TEMP: path.join(dir, 'state'),
  KOPPLER_CONFIG_DIR: path.join(dir, 'config'),
  DOCKER_HOST: 'unix:///nowhere',
  ORDERS_API_URL: 'http://localhost:5001',
};
delete env.CLAUDE_CODE_SESSION_ID;
const entry = path.join(path.dirname(fileURLToPath(import.meta.url)), '..', 'dist', 'koppler.mjs');
const koppler = (...args) => {
  const r = spawnSync('node', [entry, ...args], { encoding: 'utf8', env, cwd: dir });
  return { out: (r.stdout + r.stderr).trim(), code: r.status };
};
fs.mkdirSync(env.KOPPLER_STATE, { recursive: true });
fs.mkdirSync(env.KOPPLER_CONFIG_DIR, { recursive: true });
const stack = {
  envs: ['qa'],
  apps: {
    'shop-jobs': { name: 'Shop jobs', kind: 'sam', url: 'http://localhost:3100' },
    web: { name: 'Web', kind: 'node', url: 'http://localhost:3000' },
  },
};
fs.writeFileSync(path.join(env.KOPPLER_STATE, 'registry.json'), JSON.stringify(stack));
fs.writeFileSync(path.join(env.KOPPLER_STATE, 'local.json'), JSON.stringify({ apps: { 'shop-jobs': { path: clone }, web: { path: clone } } }));
process.on('exit', () => fs.rmSync(dir, { recursive: true, force: true }));
const ran = () => (fs.existsSync(calls) ? fs.readFileSync(calls, 'utf8').trim().split('\n') : []);

test('a queue function runs once with SAM sample queue message, built first, with the settings the API would get', () => {
  const r = koppler('invoke', 'shop-jobs', 'OrdersQueueFunction');
  assert.equal(r.code, 0, r.out);
  const [generate, build, invoke] = ran();
  assert.equal(generate, 'local generate-event sqs receive-message');
  assert.match(build ?? '', /^build /);
  assert.match(invoke ?? '', /^local invoke OrdersQueueFunction --template \S+template\.yaml --event \S+ --env-vars \S+/);
  // The function's result reaches the terminal, and so does the local address, as the container sees it.
  assert.match(r.out, /"statusCode":200/);
  assert.match(r.out, /"ORDERS_API_URL":"http:\/\/host\.docker\.internal:5001"/);
});

test('an event file of your own is used as it is', () => {
  fs.rmSync(calls, { force: true });
  fs.writeFileSync(path.join(dir, 'order.json'), '{"Records":[]}');
  const r = koppler('invoke', 'shop-jobs', 'OrdersQueueFunction', '--event', 'order.json');
  assert.equal(r.code, 0, r.out);
  assert.ok(!ran().some(call => call.includes('generate-event')), ran().join('\n'));
  assert.match(ran().at(-1) ?? '', new RegExp(`--event ${path.join(fs.realpathSync(dir), 'order.json').replace(/[.*+?^${}()|[\]\\]/g, '\\$&')} `));
});

test('what it cannot invoke is said, with what to do instead', () => {
  assert.match(koppler('invoke', 'shop-jobs', 'Nope').out, /no function Nope in .*template\.yaml; it has OrdersQueueFunction, KafkaFunction/);
  assert.match(koppler('invoke', 'shop-jobs', 'KafkaFunction').out, /no sample event for MSK: pass one with --event <file>/);
  assert.match(koppler('invoke', 'web', 'Anything').out, /web is not a SAM app/);
  assert.match(koppler('invoke').out, /usage: koppler invoke <app> <function>/);
});
