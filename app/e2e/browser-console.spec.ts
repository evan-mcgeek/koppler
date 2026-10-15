// A web app's browser console on its card: its page loads the canvas server's script, which sends each console line,
// and each uncaught error, to the app's log. Only with the app's key.
import fs from 'node:fs';
import http from 'node:http';
import type { AddressInfo } from 'node:net';
import path from 'node:path';
import { expect, test } from './canvas.ts';

test("a page's console lines and uncaught errors reach the app's log, and nothing without its key", async ({
  page,
  canvas,
}) => {
  fs.writeFileSync(path.join(canvas.temp, 'console-keys.json'), JSON.stringify({ web: 'k'.repeat(32) }));
  const origin = new URL(canvas.url).origin;
  const log = path.join(canvas.dir, 'state', 'logs', 'web.log');
  const logs = () => (fs.existsSync(log) ? fs.readFileSync(log, 'utf8') : '');
  // The app's own page, served on this Mac at another origin than the canvas, as its dev server would.
  const html = `<html><head><script src="${origin}/console.js?app=web&key=${'k'.repeat(32)}"></script></head><body></body></html>`;
  const server = http.createServer((_, res) => res.writeHead(200, { 'content-type': 'text/html' }).end(html));
  await new Promise<void>(resolve => server.listen(0, '127.0.0.1', resolve));
  const { port } = server.address() as AddressInfo;
  await page.goto(`http://localhost:${String(port)}/`);
  await page.evaluate(() => {
    console.warn('cache is cold');
    console.log('rendered', { items: 3 });
    // An uncaught error, as the page sees one; thrown for real, the test would fail on it.
    dispatchEvent(new ErrorEvent('error', { error: new Error('cart is undefined'), message: 'cart is undefined' }));
  });
  await expect.poll(logs).toContain('browser warn: cache is cold');
  await expect.poll(logs).toContain('browser log: rendered {"items":3}');
  await expect.poll(logs).toContain('browser error: Error: cart is undefined');

  const wrong = await page.request.get(`${origin}/console.js?app=web&key=${'x'.repeat(32)}`);
  expect(wrong.status()).toBe(404);
  const other = await page.request.get(`${origin}/console.js?app=orders&key=${'k'.repeat(32)}`);
  expect(other.status()).toBe(404);
  server.close();
});
