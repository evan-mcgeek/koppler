// The canvas server. Publishes temp/status.json plus live port state and log tails as temp/status.js, which the canvas
// re-loads on a timer, and runs a loopback-only, token-protected HTTP server: the standalone canvas page, layout
// autosaves (the board, state.json) and Send/Stop prompts (temp/prompts.jsonl).
// Usage: node status-watch.mjs [--once]   (port 4747 or KOPPLER_PORT, token kept across restarts so the page URL in temp/canvas-url stays the same)
import crypto from 'node:crypto';
import fs from 'node:fs';
import http from 'node:http';
import type { AddressInfo } from 'node:net';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { stateDir, tempDir } from './paths.ts';
import { failRequest, gate, logged } from './server/gate.ts';
import { publish } from './server/status.ts';

const PORT = Number(process.env['KOPPLER_PORT']) || 4747;
const INTERVAL_MS = 1500;

/** The page's token: kept across restarts, so an open canvas tab keeps working. */
function pageToken(): string {
  const file = path.join(stateDir(), 'canvas-token');
  try {
    const kept = fs.readFileSync(file, 'utf8').trim();
    if (/^[0-9a-f]{48}$/.test(kept)) return kept;
  } catch {
    // The first start on this Mac.
  }
  const token = crypto.randomBytes(24).toString('hex');
  fs.mkdirSync(stateDir(), { recursive: true, mode: 0o700 });
  fs.writeFileSync(file, token + '\n', { mode: 0o600 });
  return token;
}

/** Loopback only, token-protected. Serves the canvas standalone, takes layout autosaves and Send/Stop prompts. */
function startServer(): void {
  const token = pageToken();
  const server = http.createServer((req, res) => {
    try {
      gate(req, res, token, String((server.address() as AddressInfo).port));
    } catch (error) {
      failRequest(res, error);
    }
  });
  server.on('error', (error: NodeJS.ErrnoException) => {
    const said =
      error.code === 'EADDRINUSE' ? `port ${String(PORT)} is in use (another watcher? koppler status)` : error.message;
    console.error(`status-watch: ${said}`);
    process.exit(1);
  });
  server.listen(PORT, '127.0.0.1', () => {
    const page = `http://127.0.0.1:${String((server.address() as AddressInfo).port)}/s/${token}/`;
    fs.writeFileSync(path.join(tempDir(), 'canvas-url'), page + '\n', { mode: 0o600 });
    console.log(`canvas: ${page}`);
  });
}

if (process.argv[1] && fs.realpathSync(process.argv[1]) === fileURLToPath(import.meta.url)) {
  // With --once the status is published a single time and nothing is served.
  const serving = !process.argv.includes('--once');
  // On a machine where Koppler never ran, nothing has made its folder yet.
  fs.mkdirSync(tempDir(), { recursive: true, mode: 0o700 });
  // Said from the very first status on: a page that loaded can only have come from this server.
  if (serving) startServer();
  // A status that cannot be put together is said, not the end of the canvas.
  await publish(serving).catch(logged);
  if (serving) {
    // A slow publish is not started again on top of itself.
    let publishing = false;
    setInterval(() => {
      if (publishing) return;
      publishing = true;
      publish(serving)
        .catch((error: unknown) => {
          console.error(`status-watch: ${(error as Partial<Error> | null)?.message ?? String(error)}`);
        })
        .finally(() => {
          publishing = false;
        });
    }, INTERVAL_MS);
    // Whatever still slips through (a callback of a finished request) is logged; the canvas stays up.
    process.on('uncaughtException', logged);
    process.on('unhandledRejection', logged);
  }
}
