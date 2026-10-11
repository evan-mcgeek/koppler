// Today's canvas with the spike's board, for the side-by-side: `npm run build`, then `node spike/today.mjs`.
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawn } from 'node:child_process';
import { chromium } from '@playwright/test';

const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'koppler-spike-'));
const temp = path.join(dir, 'state', 'run');
fs.mkdirSync(temp, { recursive: true });
const app = (name, kind, port, consumes = []) => ({
  name,
  kind,
  slug: `acme/${name.toLowerCase().replace(/\s+/g, '-')}`,
  url: `http://localhost:${port}`,
  deployedUrl: `https://${name.toLowerCase().replace(/\s+/g, '-')}.qa.acme.example`,
  consumes: Object.fromEntries(consumes.map(id => [id, { how: 'env', env: `${id.toUpperCase()}_URL` }])),
});
const apps = {
  mobile: app('Mobile App', 'flutter', 0, ['orders']),
  web: app('Web Shop', 'node', 3000, ['orders', 'catalog']),
  orders: app('Orders API', 'dotnet', 5001, ['payments', 'catalog']),
  payments: app('Payments API', 'dotnet', 5002),
  catalog: app('Catalog API', 'node', 5003),
};
const write = (name, value) => fs.writeFileSync(path.join(temp, `${name}.json`), JSON.stringify(value));
write('registry', { name: 'Acme Shop', envs: ['qa', 'prod'], apps, source: path.join(dir, 'stack') });
write('local', {
  roots: [dir],
  at: new Date().toISOString(),
  apps: Object.fromEntries(
    Object.keys(apps).map(id => [id, { path: path.join(dir, id), branch: 'main', dirty: 0, branches: ['main'] }]),
  ),
});
write('repos', { roots: [dir], stack: 'Acme Shop', repos: [] });
const at = (x, y) => ({ x: x + 300, y: y + 80, run: 'cli', branch: 'main' });
write('state', {
  env: 'qa',
  mode: 'auto',
  zoom: 1,
  pan: { x: 0, y: 0 },
  nodes: { mobile: at(0, 0), web: at(380, 0), orders: at(190, 400), payments: at(0, 800), catalog: at(380, 800) },
  edges: [
    { from: 'mobile', to: 'orders', fromSide: 'bottom', toSide: 'top' },
    { from: 'web', to: 'orders', fromSide: 'bottom', toSide: 'top' },
    { from: 'orders', to: 'payments', fromSide: 'bottom', toSide: 'top' },
    { from: 'orders', to: 'catalog', fromSide: 'bottom', toSide: 'top' },
    { from: 'web', to: 'catalog', fromSide: 'right', toSide: 'right', points: [{ x: 1100, y: 640 }] },
  ],
});
const server = spawn(process.execPath, ['dist/status-watch.mjs'], {
  env: {
    ...process.env,
    KOPPLER_STATE: path.join(dir, 'state'),
    KOPPLER_TEMP: temp,
    KOPPLER_LOGS: path.join(dir, 'state', 'logs'),
    KOPPLER_CONFIG_DIR: path.join(dir, 'config'),
    KOPPLER_PORT: '4798',
  },
  stdio: 'ignore',
});
try {
  const urlFile = path.join(temp, 'canvas-url');
  for (let tries = 0; tries < 50 && !fs.existsSync(urlFile); tries++) await new Promise(done => setTimeout(done, 100));
  const browser = await chromium.launch();
  const page = await browser.newPage({ viewport: { width: 1280, height: 860 } });
  await page.goto(fs.readFileSync(urlFile, 'utf8').trim());
  await page.waitForSelector('.node');
  await page.getByRole('button', { name: 'Fit', exact: true }).click();
  await page.waitForTimeout(800);
  await page.screenshot({ path: 'spike/shots/0-today.png' });
  await browser.close();
} finally {
  server.kill();
  fs.rmSync(dir, { recursive: true, force: true });
}
