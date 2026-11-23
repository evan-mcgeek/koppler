import './sandbox.mjs';
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import fs from 'node:fs';
import http from 'node:http';
import net from 'node:net';
import path from 'node:path';
import { test } from 'node:test';
import { fileURLToPath } from 'node:url';

const runner = path.join(path.dirname(fileURLToPath(import.meta.url)), '..', 'dist', 'lambda-local.mjs');
const freePort = () =>
  new Promise(resolve => {
    const server = net.createServer().listen(0, '127.0.0.1', () => {
      const { port } = server.address();
      server.close(() => resolve(port));
    });
  });

test('A Node Lambda called by an HTTP API: built by sam build, and each call reaches it as API Gateway\'s event, with its own answer back.', async t => {
  // The emulator's address is fixed; a stand-in answers there, unless something real already does.
  const events = [];
  const emulator = http.createServer((request, response) => {
    let body = '';
    request.on('data', chunk => (body += chunk));
    request.on('end', () => {
      if (request.url === '/_floci/health') return response.end('{}');
      if (/^\/2015-03-31\/functions\/orders-fn\/invocations$/.test(request.url ?? '')) {
        events.push(JSON.parse(body));
        const answer = { statusCode: 201, headers: { 'x-from': 'fn' }, cookies: ['cart=1'], body: 'made' };
        return response.writeHead(200, { 'content-type': 'application/json' }).end(JSON.stringify(answer));
      }
      response.writeHead(404).end();
    });
  });
  const listening = await new Promise(resolve => {
    emulator.once('error', () => resolve(false));
    emulator.listen(4566, '127.0.0.1', () => resolve(true));
  });
  if (!listening) return t.skip('port 4566 is in use (a real emulator runs here)');

  const dir = fs.mkdtempSync(path.join(process.env.KOPPLER_TEST_SANDBOX, 'lambda-'));
  const bin = path.join(dir, 'bin'), app = path.join(dir, 'orders-fn'), calls = path.join(dir, 'calls');
  fs.mkdirSync(bin);
  fs.mkdirSync(app);
  fs.writeFileSync(path.join(app, 'index.js'), 'exports.handler = async () => ({});\n');
  // sam build makes the function's folder; the AWS CLI answers what the runner asks; docker logs waits to be stopped.
  const stub = (name, body) => fs.writeFileSync(path.join(bin, name), `#!/bin/sh\necho "${name} $*" >> "${calls}"\n${body}\n`, { mode: 0o755 });
  stub('sam', 'while [ $# -gt 0 ]; do [ "$1" = --build-dir ] && mkdir -p "$2/Function" && echo built > "$2/Function/index.js"; shift; done');
  stub('aws', 'case "$*" in *get-function*) echo Active ;; *list-event-source-mappings*) echo None ;; *create-function*) echo orders-fn ;; *) exit 0 ;; esac');
  stub('docker', 'case "$1" in logs) exec sleep 600 ;; *) exit 0 ;; esac');

  const port = await freePort();
  const config = { project: app, handler: 'index.handler', runtime: 'nodejs20.x', api: 'http', routes: ['POST /orders/{id}'] };
  const env = { ...process.env, PATH: `${bin}:${process.env.PATH}`, DOCKER_HOST: 'unix:///nowhere' };
  const child = spawn('node', [runner, JSON.stringify(config), String(port), path.join(dir, 'none.json'), 'orders-fn'], { env });
  let out = '';
  try {
    await new Promise((resolve, reject) => {
      child.stdout.on('data', chunk => {
        out += chunk;
        if (out.includes('koppler: ready:')) resolve();
      });
      child.stderr.on('data', chunk => (out += chunk));
      child.on('exit', code => reject(new Error(`the runner ended (${String(code)}):\n${out}`)));
    });
    assert.match(out, /ready: calls on http:\/\/localhost:\d+\/orders\/\{id\} reach the function as API Gateway's event/);

    const answered = await fetch(`http://127.0.0.1:${String(port)}/orders/42?size=big`, { method: 'POST', body: '{"item":"mug"}', headers: { 'content-type': 'application/json' } });
    assert.equal(answered.status, 201);
    assert.equal(answered.headers.get('x-from'), 'fn');
    assert.equal(answered.headers.get('set-cookie'), 'cart=1');
    assert.equal(await answered.text(), 'made');
    assert.equal(events.length, 1);
    assert.equal(events[0].version, '2.0');
    assert.equal(events[0].routeKey, 'POST /orders/{id}');
    assert.deepEqual(events[0].pathParameters, { id: '42' });
    assert.deepEqual(events[0].queryStringParameters, { size: 'big' });
    assert.equal(events[0].body, '{"item":"mug"}');

    // Off its routes, API Gateway's not-found; its health is Koppler's own, with no queue trigger to wait for.
    assert.equal((await fetch(`http://127.0.0.1:${String(port)}/carts`, { method: 'POST' })).status, 404);
    const health = await (await fetch(`http://127.0.0.1:${String(port)}/health`)).json();
    assert.deepEqual(health, { koppler: 'lambda', ok: true, function: 'Active', api: true });

    // A malformed escape is API Gateway's bad request, and the runner keeps serving.
    const bad = await fetch(`http://127.0.0.1:${String(port)}/orders/100%`, { method: 'POST' });
    assert.equal(bad.status, 400);
    assert.equal((await fetch(`http://127.0.0.1:${String(port)}/health`)).status, 200);
    assert.equal(events.length, 1);

    const ran = fs.readFileSync(calls, 'utf8');
    const build = ran.split('\n').find(line => line.startsWith('sam build'));
    assert.match(build, /--cached/);
    const template = JSON.parse(fs.readFileSync(/--template (\S+)/.exec(build)[1], 'utf8'));
    assert.equal(template.Resources.Function.Properties.CodeUri, app);
    assert.match(ran, /create-function --function-name orders-fn --runtime nodejs20\.x .*--handler index\.handler/);
    // No queue of its own: calls go to the function, not to SQS.
    assert.doesNotMatch(ran, /create-queue/);
  } finally {
    const ended = new Promise(resolve => child.once('exit', resolve));
    child.kill('SIGTERM');
    await ended;
    await new Promise(resolve => emulator.close(resolve));
  }
});
