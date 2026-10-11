import assert from 'node:assert/strict';
import { conflicts, dotnetPorts, nodePorts, portsIn } from '../dist/engine/investigate.js';

assert.deepEqual(portsIn('https://localhost:7089;http://localhost:5089'), [7089, 5089]);
assert.deepEqual(portsIn('http://*:8080 and http://+:9090'), [8080, 9090]);
assert.deepEqual(dotnetPorts('{"profiles":{"QA":{"applicationUrl":"https://localhost:7089;http://localhost:5089"},"IIS":{}}}'),
  [{ scheme: 'https', port: 7089, where: 'profile QA' }, { scheme: 'http', port: 5089, where: 'profile QA' }]);
assert.deepEqual(dotnetPorts('\\uFEFF{ broken "applicationUrl": "http://localhost:5000"'), [{ port: 5000, where: 'launchSettings.json' }]);
assert.deepEqual(nodePorts({ '.env': 'A=1\nPORT=3001\n', 'package.json': '{"scripts":{"dev":"vite --port 5173","x":"tsc"}}', 'vite.config.ts': 'server: { port: 5174 }' }).map(p => p.port).sort(), [3001, 5173, 5174]);

const app = (id, port, tunnels = []) => ({ id, stackPort: port, ports: [], tunnels });
assert.deepEqual(conflicts([app('a', 5000), app('b', 5000)]), [{ port: 5000, who: ['a', 'b'] }]);
assert.deepEqual(conflicts([app('a', 1, [{ tunnel: 'db.x', port: 5432 }]), app('b', 2, [{ tunnel: 'db.x', port: 5432 }])]), []);
// Two tunnels on one port are resolved by the tunnel planner, not reported as a conflict.
assert.equal(conflicts([app('a', 1, [{ tunnel: 'db.x', port: 5432 }]), app('b', 2, [{ tunnel: 'db.y', port: 5432 }])]).length, 0);
// An app listening on a port a tunnel needs is a real conflict.
assert.deepEqual(conflicts([app('a', 5432), app('b', 2, [{ tunnel: 'db.y', port: 5432 }])]), [{ port: 5432, who: ['a', 'tunnel to db.y (for b)'] }]);
console.log('ok');
