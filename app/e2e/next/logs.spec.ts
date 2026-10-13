// The new canvas's logs pane, and asking the agent about a start that failed.
import fs from 'node:fs';
import path from 'node:path';
import type { Page } from '@playwright/test';
import { test, expect } from '../canvas.ts';

const card = (page: Page, id: string) => page.locator(`.svelte-flow__node[data-id="${id}"]`);
const at = (x: number, y: number) => ({ x, y, run: 'cli', branch: 'main' });
test.use({
  start: 'next/',
  board: {
    env: 'qa',
    mode: 'auto',
    zoom: 0.8,
    pan: { x: 80, y: 60 },
    nodes: { web: at(0, 0), orders: at(480, 0) },
    edges: [],
  },
});

test("a card's log opens in a tab, read and laid out, raw on request, and cleared without touching the file", async ({
  page,
  canvas,
}) => {
  const logs = path.join(canvas.dir, 'state', 'logs');
  fs.mkdirSync(logs, { recursive: true });
  const file = path.join(logs, 'orders.log');
  fs.writeFileSync(file, 'info: Now listening on: http://localhost:5001\nwarn: The certificate is about to expire\n');
  fs.writeFileSync(path.join(canvas.temp, 'status.json'), JSON.stringify({ apps: { orders: { port: 1 } } }));

  await card(page, 'orders').getByRole('button', { name: 'Show log' }).click();
  const pane = page.getByRole('region', { name: 'App log' });
  await expect(pane.getByRole('tab', { name: 'Orders API' })).toHaveAttribute('aria-selected', 'true');
  await expect(pane.getByRole('log')).toContainText('Now listening on: http://localhost:5001');
  await expect(pane.locator('.row[data-level="warn"]')).toContainText('The certificate is about to expire');
  await page.screenshot({ path: 'test-results/next-logs.png' });
  // Opening it changed nothing on the board: there is nothing to undo.
  await expect(page.getByRole('button', { name: 'Undo' })).toBeDisabled();

  await pane.getByRole('button', { name: 'Raw' }).click();
  await expect(pane.getByRole('log')).toContainText('warn: The certificate is about to expire');
  await pane.getByRole('button', { name: 'Raw' }).click();

  await pane.getByRole('button', { name: 'Clear' }).click();
  await expect(pane.getByRole('log')).toHaveText('Cleared. New lines show up here.');
  fs.appendFileSync(file, 'info: Application started\n');
  await expect(pane.getByRole('log')).toContainText('Application started');
  await expect(pane.getByRole('log')).not.toContainText('Now listening');
  expect(fs.readFileSync(file, 'utf8')).toContain('Now listening');

  await pane.getByRole('button', { name: 'Close all' }).click();
  await expect(pane).toHaveCount(0);
});

test('the log pane is resized by its grip, by the keyboard and by Expand, and keeps its size', async ({
  page,
  canvas,
}) => {
  const logs = path.join(canvas.dir, 'state', 'logs');
  fs.mkdirSync(logs, { recursive: true });
  fs.writeFileSync(path.join(logs, 'orders.log'), 'one\ntwo\n');
  fs.writeFileSync(path.join(canvas.temp, 'status.json'), JSON.stringify({ apps: { orders: { port: 1 } } }));
  await card(page, 'orders').getByRole('button', { name: 'Show log' }).click();
  const pane = page.getByRole('region', { name: 'App log' });
  const tall = async () => Math.round((await pane.boundingBox())?.height ?? 0);
  const grip = page.getByRole('separator', { name: 'Resize the log' });
  const at = await grip.boundingBox();
  const before = await tall();
  await page.mouse.move((at?.x ?? 0) + 200, (at?.y ?? 0) + 4);
  await page.mouse.down();
  await page.mouse.move((at?.x ?? 0) + 200, (at?.y ?? 0) - 96, { steps: 5 });
  await page.mouse.up();
  expect(await tall()).toBe(before + 100);
  await grip.press('ArrowDown');
  expect(await tall()).toBe(before + 60);
  await pane.getByRole('button', { name: 'Expand' }).click();
  await expect(pane.getByRole('button', { name: 'Shrink' })).toBeVisible();
  const big = await tall();
  expect(big).toBeGreaterThan(before + 200);
  await page.reload();
  await card(page, 'orders').getByRole('button', { name: 'Show log' }).click();
  expect(await tall()).toBe(big);
});

test('a failed start offers to ask the agent, which gets the app and the step', async ({ page, canvas }) => {
  const write = (name: string, value: unknown) => {
    fs.writeFileSync(path.join(canvas.temp, `${name}.json`), JSON.stringify(value));
  };
  write('status', { apps: { orders: { port: 1 } } });
  write('progress', {
    run: 'run12345',
    env: 'qa',
    apps: { orders: [{ label: 'Start', state: 'failed', detail: 'The port is taken.' }] },
  });
  const ask = card(page, 'orders').getByRole('button', { name: 'Ask the agent to fix' });
  await ask.click();
  await expect(card(page, 'orders').getByRole('button', { name: 'Sent to the agent' })).toBeDisabled();
  const lines = () => {
    const file = path.join(canvas.temp, 'prompts.jsonl');
    return fs.existsSync(file) ? fs.readFileSync(file, 'utf8').split('\n').filter(Boolean) : [];
  };
  await expect.poll(() => lines().length).toBe(1);
  const sent = JSON.parse(lines()[0] ?? '{}') as { tag: string; text: string; data: { failures: unknown[] } };
  expect(sent.tag).toBe('koppler-fix');
  expect(sent.text).toContain('APP Orders API (orders)');
  expect(sent.text).toContain('FAILED Start: The port is taken.');
  expect(sent.data.failures).toEqual([
    { connection: 'Orders API', result: 'Failed to start', detail: 'Start: The port is taken.', app: 'orders' },
  ]);
});
