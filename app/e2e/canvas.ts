// The canvas under test: its own server on a free port, holding a small made-up stack in throwaway folders.
// A test gets `canvas` ({ url, dir, saved() }) and a `page` already showing it.
import fs from 'node:fs';
import net, { type AddressInfo } from 'node:net';
import os from 'node:os';
import path from 'node:path';
import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { test as base, expect, type Page } from '@playwright/test';

const here = path.dirname(fileURLToPath(import.meta.url));
const freePort = () =>
  new Promise<number>(resolve => {
    const s = net.createServer();
    s.listen(0, '127.0.0.1', () => {
      const { port } = s.address() as AddressInfo;
      s.close(() => {
        resolve(port);
      });
    });
  });

const app = (name: string, kind: string, port: number, extra: Record<string, unknown> = {}) => ({
  name,
  kind,
  slug: `acme/${name.toLowerCase().replace(/\s+/g, '-')}`,
  url: `http://localhost:${String(port)}`,
  deployedUrl: `https://${name.toLowerCase().replace(/\s+/g, '-')}.qa.acme.example`,
  ...extra,
});
export const STACK: Stack = {
  name: 'Acme Shop',
  envs: ['qa', 'prod'],
  apps: {
    web: app('Web Shop', 'node', 3000, {
      consumes: { orders: { how: 'env', env: 'ORDERS_URL' }, catalog: { how: 'env', env: 'CATALOG_URL' } },
    }),
    orders: app('Orders API', 'dotnet', 5001, {
      consumes: { payments: { how: 'env', env: 'Payments__Url' }, catalog: { how: 'env', env: 'Catalog__Url' } },
      prereqs: [{ tunnel: 'db.qa.acme.example', port: 5432, what: 'Database (Postgres)' }],
      envs: { prod: { prereqs: [{ tunnel: 'db.prod.acme.example', port: 5432, what: 'Database (Postgres)' }] } },
    }),
    payments: app('Payments API', 'dotnet', 5002),
    catalog: app('Catalog API', 'node', 5003),
  },
  presets: [
    {
      name: 'Checkout',
      version: 1,
      nodes: { web: { run: 'cli' }, orders: { run: 'cli' }, payments: { run: 'cli' } },
      edges: [
        { from: 'web', to: 'orders' },
        { from: 'orders', to: 'payments' },
      ],
    },
    {
      name: 'Browse',
      version: 1,
      nodes: { web: { run: 'cli' }, catalog: { run: 'cli' } },
      edges: [{ from: 'web', to: 'catalog' }],
    },
  ],
};

type Stack = {
  name: string;
  envs: string[];
  protected?: string[];
  apps: Record<string, Record<string, unknown>>;
  queues?: Record<string, Record<string, unknown>>;
  presets?: unknown[];
};
type Canvas = { url: string; dir: string; temp: string };

export const test = base.extend<{
  stack: Stack;
  board: object | null;
  uncloned: string[];
  dirty: string[];
  libraries: Record<string, string[]>;
  start: string;
  canvas: Canvas;
}>({
  // `stack`, `board`, `uncloned` (apps with no clone on this machine), `dirty` (apps whose clone has three
  // uncommitted changes) and `libraries` (per app, the libraries it uses that are cloned here) can be set per test
  // with test.use.
  stack: [STACK, { option: true }],
  board: [null, { option: true }],
  uncloned: [[], { option: true }],
  dirty: [[], { option: true }],
  libraries: [{}, { option: true }],
  // What follows the canvas address when it is opened, such as a board named in its hash.
  start: ['', { option: true }],
  canvas: async ({ stack, board, uncloned, dirty, libraries }, use) => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'koppler-e2e-')),
      temp = path.join(dir, 'state', 'run'),
      port = await freePort();
    fs.mkdirSync(temp, { recursive: true });
    const write = (name: string, value: unknown) => {
      fs.writeFileSync(path.join(temp, `${name}.json`), JSON.stringify(value));
    };
    write('registry', { ...stack, source: path.join(dir, 'stack') });
    write('local', {
      roots: [dir],
      at: new Date().toISOString(),
      apps: Object.fromEntries(
        Object.keys(stack.apps)
          .filter(id => !uncloned.includes(id))
          .map(id => [
            id,
            {
              path: path.join(dir, 'clones', id),
              branch: 'main',
              dirty: dirty.includes(id) ? 3 : 0,
              branches: ['main', 'feature/checkout'],
              ...(libraries[id] && {
                libraries: libraries[id].map(name => ({
                  name,
                  path: path.join(dir, 'clones', name),
                  ecosystem: 'npm',
                })),
              }),
            },
          ]),
      ),
    });
    write('repos', { roots: [dir], stack: stack.name, repos: [] });
    if (board) write('state', board);
    const env = {
      ...process.env,
      KOPPLER_STATE: path.join(dir, 'state'),
      KOPPLER_TEMP: temp,
      KOPPLER_LOGS: path.join(dir, 'state', 'logs'),
      KOPPLER_CONFIG_DIR: path.join(dir, 'config'),
      KOPPLER_PORT: String(port),
    };
    const server = spawn(process.execPath, [path.join(here, '..', 'dist', 'status-watch.mjs')], {
      env,
      stdio: 'ignore',
    });
    const urlFile = path.join(temp, 'canvas-url');
    await expect.poll(() => fs.existsSync(urlFile), { message: 'the canvas server starts' }).toBe(true);
    await use({ url: fs.readFileSync(urlFile, 'utf8').trim(), dir, temp });
    server.kill();
    fs.rmSync(dir, { recursive: true, force: true });
  },
  page: async ({ page, canvas, start }, use) => {
    const errors: string[] = [];
    page.on('pageerror', e => errors.push(String(e)));
    await page.goto(canvas.url + start);
    await use(page);
    expect(errors, 'no script errors on the page').toEqual([]);
  },
});
// A person's pace between two edits: the board takes edits less than 0.7 seconds apart as one step to undo.
export const nextEdit = (page: Page) => page.waitForTimeout(800);
export { expect };
