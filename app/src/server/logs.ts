// The end of an app's log for its card, and the debug log of what the user did on the canvas.
import fs from 'node:fs';
import path from 'node:path';
import { TEMP } from '../paths.ts';
import { redact } from '../scrub.ts';

const TAIL_BYTES = 96 * 1024;
const TAIL_LINES = 600;
/** The last lines of a file, secrets masked and colour codes taken out; null when it cannot be read. */
export function tail(file: string, bytes = TAIL_BYTES, lines = TAIL_LINES): string | null {
  try {
    const { size } = fs.statSync(file);
    const fd = fs.openSync(file, 'r');
    const length = Math.min(size, bytes);
    const buffer = Buffer.alloc(length);
    fs.readSync(fd, buffer, 0, length, size - length);
    fs.closeSync(fd);
    // Color codes, as terminals send them or as `flutter logs` spells them out, are noise on a card.
    const plain = buffer.toString('utf8').replace(/(?:\x1b|\\\^\[)\[[0-9;]*m/g, '');
    const last = redact(plain).trimEnd().split('\n').slice(-lines);
    return last.map(line => (line.length > 4000 ? `${line.slice(0, 4000)} …` : line)).join('\n');
  } catch {
    return null;
  }
}

// The debug log: what the user did on the canvas, one JSON line each, so a concern can be traced afterwards.
// Kept to the last MAX_DEBUG_LINES lines; every text goes through `redact`, and only known fields are kept.
const MAX_DEBUG_LINES = 5000;
const debugFile = () => path.join(TEMP, 'debug.jsonl');
const shown = (value: unknown) => (typeof value === 'string' ? redact(value).slice(0, 300) : undefined);
const count = (value: unknown) => (typeof value === 'number' && Number.isFinite(value) ? value : undefined);
export function cleanDebugEntry(given: unknown): object | null {
  if (!given || typeof given !== 'object') return null;
  const entry = given as Record<string, unknown>;
  const board =
    entry['board'] && typeof entry['board'] === 'object' ? (entry['board'] as Record<string, unknown>) : null;
  const detail = shown(entry['detail']);
  const out = {
    at: shown(entry['at']) ?? new Date().toISOString(),
    kind: shown(entry['kind']) ?? 'event',
    what: shown(entry['what']) ?? '',
    ...(detail && { detail }),
    ...(board && {
      board: {
        apps: count(board['apps']),
        cables: count(board['cables']),
        view: shown(board['view']),
        env: shown(board['env']),
        zoom: count(board['zoom']),
        name: shown(board['name']),
      },
    }),
  };
  return out.what || out.detail ? out : null;
}
export function appendDebugLog(entries: unknown): { kept: number } {
  const lines = (Array.isArray(entries) ? (entries as unknown[]) : [])
    .slice(0, 500)
    .flatMap(entry => cleanDebugEntry(entry) ?? [])
    .map(entry => JSON.stringify(entry));
  if (!lines.length) return { kept: 0 };
  fs.appendFileSync(debugFile(), lines.join('\n') + '\n', { mode: 0o600 });
  const all = fs.readFileSync(debugFile(), 'utf8').split('\n').filter(Boolean);
  if (all.length > MAX_DEBUG_LINES)
    fs.writeFileSync(debugFile(), all.slice(-MAX_DEBUG_LINES).join('\n') + '\n', { mode: 0o600 });
  return { kept: lines.length };
}
export function clearDebugLog(): { cleared: true } {
  fs.rmSync(debugFile(), { force: true });
  return { cleared: true };
}
