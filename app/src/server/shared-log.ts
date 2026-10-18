// Reads the log of every app it is given into one stream, for the canvas's All apps tab and `koppler logs --all`:
// secrets masked as on the cards, each line with the time Koppler stamped, or the time it was first read.
import fs from 'node:fs';
import { mergeLogs, pairTimes, type Entry, type Source } from '../core/shared-log.ts';
import { readRecord } from '../engine/processes.ts';
import { tail } from './logs.ts';
import { logFile, SOURCE } from './status.ts';

const READ_BYTES = 8 * 1024 * 1024;
const READ_LINES = 20_000;
export type Since = 'run' | 'hour' | 'all';

const numbers = (file: string): number[] => {
  try {
    return fs.readFileSync(file, 'utf8').trimEnd().split('\n').map(Number).filter(Number.isFinite);
  } catch {
    return [];
  }
};
const endsLine = (file: string): boolean => {
  try {
    const fd = fs.openSync(file, 'r');
    const byte = Buffer.alloc(1);
    fs.readSync(fd, byte, 0, 1, Math.max(0, fs.statSync(file).size - 1));
    fs.closeSync(fd);
    return byte[0] === 10;
  } catch {
    return true;
  }
};

/** Per log Koppler only reads: how many lines it had when first read, then, and when each later one was first seen. */
const firstRead = new Map<string, { count: number; at: number; later: number[] }>();
function readTimes(file: string, lines: string[]): number[] {
  const now = Date.now();
  let total = 0;
  try {
    for (const byte of fs.readFileSync(file)) if (byte === 10) total++;
  } catch {
    return lines.map(() => now);
  }
  let seen = firstRead.get(file);
  // Started again, the log is shorter: read from scratch.
  if (!seen || total < seen.count + seen.later.length) seen = { count: total, at: now, later: [] };
  while (seen.count + seen.later.length < total) seen.later.push(now);
  firstRead.set(file, seen);
  const known = seen;
  const timeOf = (index: number) => (index < known.count ? known.at : (known.later[index - known.count] ?? now));
  return lines.map((_, at) => timeOf(Math.max(0, total - lines.length + at)));
}

/** One app's log as read: stamped by Koppler when its times are as new as the log, else timed when read. */
function sourceOf(app: string, named: unknown): Source | null {
  const file = logFile(app, named);
  const text = tail(file, READ_BYTES, READ_LINES);
  if (text === null) return null;
  const lines = text.split('\n');
  const stamps = `${file}.times`;
  let fresh = false;
  try {
    // Started by an older Koppler, an app's log is newer than its last times: those would not match its lines.
    fresh = fs.statSync(stamps).mtimeMs >= fs.statSync(file).mtimeMs - 2000;
  } catch {
    fresh = false;
  }
  return fresh
    ? { app, lines, times: pairTimes(lines, numbers(stamps), endsLine(file)) }
    : { app, lines, times: readTimes(file, lines), approx: true };
}

/**
 * Where "since the run started" begins: the earliest start of these apps as Koppler runs them, which is the stamp of
 * the first line of its log (written just before it starts), else when Koppler recorded it.
 */
function runStart(apps: string[], named: Record<string, unknown>): number {
  const starts = apps.flatMap(app => {
    if (!readRecord(app)) return [];
    const first = numbers(`${logFile(app, named[app])}.times`)[0];
    const at = first ?? Date.parse(readRecord(app)?.startedAt ?? '');
    return Number.isFinite(at) ? [at] : [];
  });
  return starts.length ? Math.min(...starts) : 0;
}

/** The logs an agent named in its status, by app: an app the user starts, whose log Koppler only reads. */
export function namedLogs(): Record<string, unknown> {
  try {
    const status = JSON.parse(fs.readFileSync(SOURCE, 'utf8')) as { apps?: Record<string, { log?: unknown } | null> };
    return Object.fromEntries(Object.entries(status.apps ?? {}).map(([id, app]) => [id, app?.log]));
  } catch {
    return {};
  }
}

/** The apps' lines in one stream, oldest first. `named` gives the log an agent named for an app it reads. */
export function sharedLog(
  apps: string[],
  {
    since = 'run',
    lines,
    named = namedLogs(),
  }: { since?: Since; lines?: number; named?: Record<string, unknown> } = {},
): Entry[] {
  const sources = apps.flatMap(app => sourceOf(app, named[app]) ?? []);
  const from = since === 'hour' ? Date.now() - 3_600_000 : since === 'run' ? runStart(apps, named) : 0;
  return mergeLogs(sources, { since: from, ...(lines && { limit: lines }) });
}
