// Migrations: every JSON file Koppler keeps records the Koppler version whose format it is written in. Each Koppler
// version that changes a file's format adds one migration for it, and reading an older file runs every migration after
// its version, in order, on the raw JSON. An older file keeps working without being rewritten; writing the result back
// is a step of its own.

export type Raw = Record<string, unknown>;
/** One change of a file's format, made by the Koppler version that introduced it. */
export interface Migration {
  /** The Koppler version that introduced it, such as 0.2.0. */
  version: string;
  /** What it changes, in one sentence. */
  about: string;
  /** Takes a raw file in the format before this version and gives it in this version's; `say` tells each change. */
  up: (raw: Raw, say: (change: string) => void) => Raw;
}
/** A kind of file: where it says its version, the version this Koppler writes, and how it got there. */
export interface Format {
  /** The file, in words: "the stack". */
  name: string;
  /** The field that holds the version. */
  key: string;
  /** The format this Koppler reads and writes: the newest version that changed it. */
  version: string;
  /** Oldest first. */
  migrations: readonly Migration[];
  /** The version of a file from before it had `key`, when something else in it says. */
  legacy?: (raw: Raw) => string | undefined;
}
export interface Migrated {
  value: Raw;
  /** The version the file was written in; 0.0.0 for one with none. */
  from: string;
  /** What ran, each with the changes it made; empty when the file was up to date. */
  applied: { migration: Migration; changes: string[] }[];
  error?: undefined;
}

const VERSION = /^(\d+)\.(\d+)\.(\d+)$/;
export const isVersion = (text: unknown): text is string => typeof text === 'string' && VERSION.test(text);
/** Orders two versions: below zero when `a` is older. */
export function compareVersions(a: string, b: string): number {
  const [x, y] = [a, b].map(one => (VERSION.exec(one) ?? []).slice(1).map(Number));
  for (let at = 0; at < 3; at++) {
    const diff = (x?.[at] ?? 0) - (y?.[at] ?? 0);
    if (diff) return diff;
  }
  return 0;
}

/** The version a file says it is written in. */
export const versionOf = (raw: Raw, format: Format): string => {
  const own = raw[format.key];
  return isVersion(own) ? own : (format.legacy?.(raw) ?? '0.0.0');
};

/**
 * The one way a file is read: brought up to this Koppler's format by every migration newer than the version it
 * records, oldest first, each on a copy, and stamped with the format. A file from a newer Koppler is refused.
 */
export function migrate(
  raw: Raw,
  format: Format,
): Migrated | { error: string; value?: undefined; applied?: undefined; from?: undefined } {
  const from = versionOf(raw, format);
  if (compareVersions(from, format.version) > 0)
    return {
      error: `${format.name} is written for Koppler ${from}, newer than this one reads (${format.version}); update Koppler`,
    };
  let value = raw;
  const applied: Migrated['applied'] = [];
  for (const migration of format.migrations) {
    if (compareVersions(migration.version, from) <= 0) continue;
    const changes: string[] = [];
    value = migration.up(structuredClone(value), change => changes.push(change));
    applied.push({ migration, changes });
  }
  return { value: { ...value, [format.key]: format.version }, from, applied };
}

/** Whether a format's migrations are in order and none is newer than the format itself. */
export const inOrder = (format: Format): boolean =>
  format.migrations.every(
    (one, at) =>
      isVersion(one.version) &&
      compareVersions(one.version, format.version) <= 0 &&
      (at === 0 || compareVersions(format.migrations[at - 1]?.version ?? '0.0.0', one.version) < 0),
  );
