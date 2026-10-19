// Reading one of Koppler's files brings it up to this Koppler's format and, when that changed it, writes it back with
// its version: there is nothing to run or click to update a file.
import type { Upgrade } from './core/migrations/files.ts';
import type { Raw } from './core/migrations/run.ts';
import { readJson, writeJson } from './json-files.ts';

const isRaw = (value: unknown): value is Raw => typeof value === 'object' && value !== null && !Array.isArray(value);

/**
 * The file in this Koppler's format, written back when it was not, unless `keep` says the result may not be written
 * (it still reads that way). Null for a missing or unreadable file; the reason for one from a newer Koppler.
 */
export function readUpgraded(
  file: string,
  upgrade: Upgrade,
  keep: (before: Raw, after: Raw) => boolean = () => true,
): { value: Raw | null; error?: undefined } | { error: string; value?: undefined } {
  const raw = readJson(file);
  if (!isRaw(raw)) return { value: null };
  const done = upgrade(raw);
  if (done.error !== undefined) return done;
  if (JSON.stringify(done.value) !== JSON.stringify(raw) && keep(raw, done.value)) writeJson(file, done.value);
  return { value: done.value };
}
