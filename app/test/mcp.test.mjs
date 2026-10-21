import './sandbox.mjs';
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import readline from 'node:readline';
import { test } from 'node:test';
import { fileURLToPath } from 'node:url';

const entry = path.join(path.dirname(fileURLToPath(import.meta.url)), '..', 'dist', 'koppler.mjs');

/** `koppler mcp` as an MCP client sees it: send a request, get its answer by id. */
function server() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'koppler-mcp-'));
  const env = { ...process.env, KOPPLER_STATE: dir, KOPPLER_TEMP: dir, KOPPLER_CONFIG_DIR: dir };
  const child = spawn('node', [entry, 'mcp'], { env, stdio: ['pipe', 'pipe', 'inherit'] });
  const waiting = new Map();
  readline.createInterface({ input: child.stdout }).on('line', line => {
    const message = JSON.parse(line);
    waiting.get(message.id)?.(message);
  });
  let next = 0;
  const ask = (method, params) =>
    new Promise(resolve => {
      const id = ++next;
      waiting.set(id, resolve);
      child.stdin.write(`${JSON.stringify({ jsonrpc: '2.0', id, method, params })}\n`);
    });
  const call = async (name, args) => (await ask('tools/call', { name, arguments: args })).result;
  return { dir, ask, call, close: () => child.stdin.end() };
}

test('koppler mcp answers an MCP client: its tools with strict schemas, and each one run as the command', async () => {
  const { dir, ask, call, close } = server();
  try {
  const started = await ask('initialize', { protocolVersion: '2025-06-18', capabilities: {}, clientInfo: { name: 'test', version: '1' } });
  assert.equal(started.result.protocolVersion, '2025-06-18');
  assert.equal(started.result.serverInfo.name, 'koppler');
  const { tools } = (await ask('tools/list')).result;
  assert.deepEqual(tools.map(one => one.name), ['status', 'logs', 'doctor', 'plan', 'history', 'wait', 'say']);
  assert.equal(tools.find(one => one.name === 'wait').inputSchema.additionalProperties, false);

  const status = await call('status', {});
  assert.equal(status.isError, false);
  assert.deepEqual(status.structuredContent, { processes: [] });

  // A name that would be read as a flag, or a field the tool does not take, never reaches the command.
  const flag = await call('logs', { name: '--approve' });
  assert.equal(flag.isError, true);
  assert.match(flag.content[0].text, /name/);
  assert.equal((await call('status', { approve: true })).isError, true);

  const waited = await call('wait', { apps: ['web'], until: 'healthy', timeoutSeconds: 1 });
  assert.equal(waited.isError, true);
  assert.deepEqual(waited.structuredContent.apps, { web: 'not started' });

  const said = await call('say', { kind: 'result', title: 'Orders API runs' });
  assert.equal(said.isError, false, said.content[0].text);
  assert.match(fs.readFileSync(path.join(dir, 'messages.jsonl'), 'utf8'), /Orders API runs/);

  assert.equal((await ask('tools/call', { name: 'up', arguments: {} })).result.isError, true);
  assert.equal((await ask('nope')).error.code, -32601);
  } finally {
    close();
  }
});
