// The canvas page's access token: in its address, kept across restarts so an open tab keeps working, and replaced on
// request so every address given out before stops working.
import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { stateDir, tempDir } from '../paths.ts';

const file = () => path.join(stateDir(), 'canvas-token');
let current: string | null = null;

const keep = (token: string) => {
  fs.mkdirSync(stateDir(), { recursive: true, mode: 0o700 });
  fs.writeFileSync(file(), token + '\n', { mode: 0o600 });
  return token;
};

/** The token in use: the one kept, else a new one. */
export function pageToken(): string {
  if (current) return current;
  try {
    const kept = fs.readFileSync(file(), 'utf8').trim();
    if (/^[0-9a-f]{48}$/.test(kept)) return (current = kept);
  } catch {
    // The first start on this Mac.
  }
  return (current = keep(crypto.randomBytes(24).toString('hex')));
}

/** A new token: the page's old address stops working at once. */
export function newToken(): string {
  return (current = keep(crypto.randomBytes(24).toString('hex')));
}

/** The page's address with the token in use, kept where `koppler canvas` finds it. */
export function writePageUrl(port: string): string {
  const page = `http://127.0.0.1:${port}/s/${pageToken()}/`;
  fs.writeFileSync(path.join(tempDir(), 'canvas-url'), page + '\n', { mode: 0o600 });
  return page;
}
