#!/usr/bin/env node
// A canvas to play with: a made-up stack and board on a server of its own, in a throwaway folder. Nothing of yours is
// read or changed. `npm run play`, then open the address it prints; Ctrl+C stops it and removes the folder.
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const app = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'koppler-play-'));
const temp = path.join(dir, 'state', 'run');
fs.mkdirSync(temp, { recursive: true });

const one = (name, kind, port, calls = [], more = {}) => ({
  name,
  kind,
  slug: `acme/${name.toLowerCase().replace(/\s+/g, '-')}`,
  ...(port && { url: `http://localhost:${port}` }),
  deployedUrl: `https://${name.toLowerCase().replace(/\s+/g, '-')}.qa.acme.example`,
  consumes: Object.fromEntries(calls.map(id => [id, { how: 'env', env: `${id.toUpperCase()}_URL` }])),
  ...more,
});
const apps = {
  mobile: one('Mobile App', 'flutter', 0, ['gateway']),
  web: one('Web Shop', 'web', 3000, ['gateway', 'catalog']),
  gateway: one('Gateway', 'node', 4000, ['orders', 'catalog', 'accounts']),
  orders: one('Orders API', 'dotnet', 5001, ['payments', 'catalog'], {
    prereqs: [{ tunnel: 'db.qa.acme.example', port: 5432, what: 'Database (Postgres)' }],
    publishes: { 'order-events': {} },
  }),
  payments: one('Payments API', 'dotnet', 5002, ['billing'], { reads: { 'order-events': {} } }),
  billing: { name: 'Billing', kind: 'other', outside: 'a hosted service', deployedUrl: 'https://api.billing.example' },
  catalog: one('Catalog API', 'node', 5003),
  accounts: one('Accounts API', 'dotnet', 5004),
  receipts: one('Receipts', 'lambda', 5005, ['orders']),
};
// Accounts API is left out of the clones, to show an app that is not cloned.
const cloned = Object.keys(apps).filter(id => id !== 'accounts' && id !== 'billing');
const write = (name, value) => {
  fs.writeFileSync(path.join(temp, `${name}.json`), JSON.stringify(value));
};
const queues = { 'order-events': { name: 'Order events', type: 'sqs', queue: 'order-events-qa' } };
write('registry', {
  name: 'Acme Shop',
  envs: ['qa', 'prod'],
  protected: ['prod'],
  apps,
  queues,
  source: path.join(dir, 'stack'),
});
write('local', {
  roots: [path.join(dir, 'clones')],
  at: new Date().toISOString(),
  apps: Object.fromEntries(
    cloned.map(id => [
      id,
      {
        path: path.join(dir, 'clones', id),
        branch: 'main',
        dirty: id === 'orders' ? 2 : 0,
        branches: ['main', 'feature/checkout', 'fix/rounding'],
      },
    ]),
  ),
});
write('repos', { roots: [path.join(dir, 'clones')], stack: 'Acme Shop', repos: [] });
const at = (x, y) => ({ x, y, run: 'cli', branch: 'main' });
write('state', {
  env: 'qa',
  mode: 'auto',
  zoom: 1,
  pan: { x: 0, y: 0 },
  nodes: { web: at(80, 60), gateway: at(480, 60), orders: at(480, 420), catalog: at(80, 420), payments: at(880, 420) },
  edges: [
    { from: 'web', to: 'gateway', fromSide: 'right', toSide: 'left' },
    { from: 'gateway', to: 'orders', fromSide: 'bottom', toSide: 'top' },
    { from: 'gateway', to: 'catalog', fromSide: 'bottom', toSide: 'top' },
    { from: 'orders', to: 'payments', fromSide: 'right', toSide: 'left' },
  ],
});

const server = spawn(process.execPath, [path.join(app, 'dist', 'status-watch.mjs')], {
  env: {
    ...process.env,
    KOPPLER_STATE: path.join(dir, 'state'),
    KOPPLER_TEMP: temp,
    KOPPLER_LOGS: path.join(dir, 'state', 'logs'),
    KOPPLER_CONFIG_DIR: path.join(dir, 'config'),
    KOPPLER_PORT: process.env.KOPPLER_PLAY_PORT ?? '4750',
  },
  stdio: 'inherit',
});
const stop = () => {
  server.kill();
  fs.rmSync(dir, { recursive: true, force: true });
};
process.on('SIGINT', () => process.exit(0));
process.on('SIGTERM', () => process.exit(0));
process.on('exit', stop);
server.on('exit', code => process.exit(code ?? 1));

const urlFile = path.join(temp, 'canvas-url');
for (let tries = 0; tries < 100 && !fs.existsSync(urlFile); tries++) await new Promise(done => setTimeout(done, 100));
if (!fs.existsSync(urlFile)) {
  console.error('The canvas server did not start. Is port 4750 taken? Set KOPPLER_PLAY_PORT to another one.');
  process.exit(1);
}
const url = fs.readFileSync(urlFile, 'utf8').trim();
console.log(
  `\nA made-up stack to play with. Nothing of yours is read or changed.\n\n  New canvas:      ${url}next/\n  Today's canvas:  ${url}\n\nCtrl+C stops it.`,
);
