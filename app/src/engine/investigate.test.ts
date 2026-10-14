import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { conflicts, dotnetPorts, localPorts, nodePorts, portsIn } from './investigate.ts';
import { test } from 'vitest';

test('ports are read from launch settings and package files, and only clashes with an app are conflicts', async () => {
  assert.deepEqual(portsIn('https://localhost:7089;http://localhost:5089'), [7089, 5089]);
  assert.deepEqual(portsIn('http://*:8080 and http://+:9090'), [8080, 9090]);
  assert.deepEqual(
    dotnetPorts('{"profiles":{"QA":{"applicationUrl":"https://localhost:7089;http://localhost:5089"},"IIS":{}}}'),
    [
      { scheme: 'https', port: 7089, where: 'profile QA' },
      { scheme: 'http', port: 5089, where: 'profile QA' },
    ],
  );
  assert.deepEqual(dotnetPorts('\\uFEFF{ broken "applicationUrl": "http://localhost:5000"'), [
    { port: 5000, where: 'launchSettings.json' },
  ]);
  assert.deepEqual(
    nodePorts({
      '.env': 'A=1\nPORT=3001\n',
      'package.json': '{"scripts":{"dev":"vite --port 5173","x":"tsc"}}',
      'vite.config.ts': 'server: { port: 5174 }',
    })
      .map(p => p.port)
      .sort(),
    [3001, 5173, 5174],
  );

  const app = (id: string, port: number, tunnels: { tunnel: string; port: number }[] = []) => ({
    id,
    stackPort: port,
    ports: [],
    tunnels,
  });
  assert.deepEqual(conflicts([app('a', 5000), app('b', 5000)]), [{ port: 5000, who: ['a', 'b'] }]);
  assert.deepEqual(
    conflicts([app('a', 1, [{ tunnel: 'db.x', port: 5432 }]), app('b', 2, [{ tunnel: 'db.x', port: 5432 }])]),
    [],
  );
  // Two tunnels on one port are resolved by the tunnel planner, not reported as a conflict.
  assert.equal(
    conflicts([app('a', 1, [{ tunnel: 'db.x', port: 5432 }]), app('b', 2, [{ tunnel: 'db.y', port: 5432 }])]).length,
    0,
  );
  // An app listening on a port a tunnel needs is a real conflict.
  assert.deepEqual(conflicts([app('a', 5432), app('b', 2, [{ tunnel: 'db.y', port: 5432 }])]), [
    { port: 5432, who: ['a', 'tunnel to db.y (for b)'] },
  ]);
  console.log('ok');
});

test("a Node app's port is its entry file's default when nothing else sets it", () => {
  const repo = fs.mkdtempSync(path.join(os.tmpdir(), 'koppler-node-'));
  const write = (name: string, text: string) => {
    fs.mkdirSync(path.dirname(path.join(repo, name)), { recursive: true });
    fs.writeFileSync(path.join(repo, name), text);
  };
  write('package.json', '{"scripts":{"start":"node src/server.js"}}');
  write('src/server.js', 'const port = Number(process.env.PORT) || 5101;\nserver.listen(port);');
  assert.deepEqual(localPorts(repo, 'node'), [{ port: 5101, where: 'src/server.js' }]);
  write('package.json', '{"main":"app.js"}');
  write('app.js', "app.listen(process.env.PORT ?? '8080');");
  assert.deepEqual(localPorts(repo, 'node'), [{ port: 8080, where: 'app.js' }]);
  write('index.js', 'http.createServer(handler).listen(4000);');
  write('package.json', '{}');
  fs.rmSync(path.join(repo, 'src'), { recursive: true });
  fs.rmSync(path.join(repo, 'app.js'));
  assert.deepEqual(localPorts(repo, 'node'), [{ port: 4000, where: 'index.js' }]);
  // A PORT the .env file sets wins over the code's default.
  write('.env', 'PORT=3001\n');
  assert.deepEqual(
    localPorts(repo, 'node').map(found => found.port),
    [3001],
  );
});
