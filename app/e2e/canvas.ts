// The canvas under test: its own server on a free port, holding a small made-up stack in throwaway folders.
// A test gets `canvas` ({ url, dir, saved() }) and a `page` already showing it.
import { STACK_FORMAT } from '../src/core/migrations/stack/index.ts';
import fs from 'node:fs';
import net, { type AddressInfo } from 'node:net';
import os from 'node:os';
import path from 'node:path';
import { spawn, spawnSync } from 'node:child_process';
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
  // In this Koppler's format: its tunnels are the apps' own, not databases a migration would name.
  koppler: STACK_FORMAT.version,
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
  koppler?: string;
  envs: string[];
  protected?: string[];
  apps: Record<string, Record<string, unknown>>;
  queues?: Record<string, Record<string, unknown>>;
  databases?: Record<string, Record<string, unknown>>;
  resources?: Record<string, Record<string, unknown>>;
  found?: Record<string, Record<string, string>>;
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
              main: 'main',
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
    // A Run confirmed in a test is carried out for real: the tools that reach real infrastructure fail as if missing.
    const bin = path.join(dir, 'bin');
    fs.mkdirSync(bin);
    for (const tool of ['cloudflared', 'docker', 'aws', 'ssh', 'gh'])
      fs.writeFileSync(path.join(bin, tool), `#!/bin/sh\necho "${tool}: not run in tests" >&2\nexit 127\n`, {
        mode: 0o755,
      });
    const env = {
      ...process.env,
      PATH: `${bin}:${process.env['PATH'] ?? ''}`,
      KOPPLER_STATE: path.join(dir, 'state'),
      KOPPLER_TEMP: temp,
      KOPPLER_LOGS: path.join(dir, 'state', 'logs'),
      KOPPLER_CONFIG_DIR: path.join(dir, 'config'),
      KOPPLER_PORT: String(port),
      // A run reads each app's first seconds of log: one second here.
      KOPPLER_EARLY_LOG: '1',
      // Never the profiles of whoever runs the tests.
      AWS_CONFIG_FILE: path.join(dir, 'aws-config'),
    };
    const server = spawn(process.execPath, [path.join(here, '..', 'dist', 'status-watch.mjs')], {
      env,
      stdio: ['ignore', 'pipe', 'pipe'],
    });
    // Kept to say why, when it does not start.
    let said = '';
    const keep = (chunk: Buffer) => {
      said = (said + chunk.toString()).slice(-4000);
    };
    server.stdout.on('data', keep);
    server.stderr.on('data', keep);
    const urlFile = path.join(temp, 'canvas-url');
    try {
      // A busy machine can take a while to start Node; one that exits is not waited for.
      await expect
        .poll(() => fs.existsSync(urlFile) || server.exitCode !== null, { timeout: 20_000 })
        .toBe(true)
        .catch(() => undefined);
      if (!fs.existsSync(urlFile))
        throw new Error(
          `the canvas server did not start (${server.exitCode === null ? 'still running after 20 s' : `exited with ${String(server.exitCode)}`}):\n${said || 'it printed nothing'}`,
        );
      await use({ url: fs.readFileSync(urlFile, 'utf8').trim(), dir, temp });
    } finally {
      server.kill();
      // What a test's run started is detached from the server: stopped here, so none outlives the test.
      spawnSync(process.execPath, [path.join(here, '..', 'dist', 'koppler.mjs'), 'stop', '--all', '--yes'], {
        env,
        stdio: 'ignore',
        timeout: 20_000,
      });
      fs.rmSync(dir, { recursive: true, force: true });
    }
  },
  page: async ({ page, canvas, start }, use) => {
    const errors: string[] = [];
    page.on('pageerror', e => errors.push(String(e)));
    await page.goto(canvas.url + start);
    await use(page);
    expect(errors, 'no script errors on the page').toEqual([]);
  },
});
const clocked = new WeakSet<Page>();
/**
 * A person's pace between two edits: the board takes edits less than 0.7 seconds apart as one step to undo. The page's
 * clock is moved on instead of waited for.
 */
export async function nextEdit(page: Page): Promise<void> {
  if (!clocked.has(page)) {
    clocked.add(page);
    await page.clock.install();
  }
  await page.clock.fastForward(800);
}
/** Long enough for a change to have been saved, or to be sure none was: a save waits for 0.4 seconds of stillness. */
export const saveSettles = (page: Page) => page.waitForTimeout(800);
/** An app's card on the board. */
export const card = (page: Page, id: string) => page.locator(`.svelte-flow__node[data-id="${id}"]`);
/** A card's place on a saved board, run by Koppler on main. */
export const at = (x: number, y: number) => ({ x, y, run: 'cli', branch: 'main' });
/** The next save of the board the server takes. */
export const saved = (page: Page) =>
  page.waitForResponse(r => r.url().includes('/state?') && r.request().method() === 'POST' && r.ok());
/** What the canvas queued for the agent or Koppler. */
export const sent = (temp: string) => {
  const file = path.join(temp, 'prompts.jsonl');
  const lines = fs.existsSync(file) ? fs.readFileSync(file, 'utf8').split('\n').filter(Boolean) : [];
  return lines.map(line => JSON.parse(line) as { tag: string; text: string; data: Record<string, unknown> });
};
export { expect };
/** Picks an item from one of the top bar's menus: Activity or Settings. */
export const fromMenu = async (page: Page, menu: string, item: string | RegExp) => {
  await page.locator('header').getByRole('button', { name: menu, exact: true }).click();
  await page.getByRole('menu', { name: menu }).getByRole('menuitem', { name: item }).click();
};
/** A card's action bar, shown while the card is pointed at. */
export const actions = async (page: Page, id: string) => {
  await page.locator(`.svelte-flow__node[data-id="${id}"] header`).hover();
  return page.locator(`.tools[data-card="${id}"]`);
};
