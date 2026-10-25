// The run files the engine, the server and the page share: the stack in use, the clones on this machine, the repos
// found, and the board. Each is one JSON file in the run folder.
import fs from 'node:fs';
import path from 'node:path';
import { withDatabases } from './core/databases.ts';
import { resolveExpressions } from './core/expressions.ts';
import { migrateStack } from './core/migrations/stack/index.ts';
import { fail } from './failure.ts';
import { upgradeBoardFile, upgradeStack, type Upgrade } from './core/migrations/files.ts';
import { readUpgraded } from './upgraded.ts';
import type { Stack } from './core/stack.ts';
import { readJson, writeJson } from './json-files.ts';
import { tempDir } from './paths.ts';

export type DataName = 'registry' | 'local' | 'repos' | 'state' | 'board-edits' | 'board-proposals' | 'local-databases';
export type Data = Record<string, unknown>;

// Read at each call: the tests, and a stack switch, change where the run folder is while the process lives.
const folder = tempDir;
export const dataFile = (name: DataName) => path.join(folder(), `${name}.json`);

const isData = (value: unknown): value is Data => typeof value === 'object' && value !== null && !Array.isArray(value);

// Before JSON these were scripts for the page ("window.REGISTRY = {...};"). A board saved that way is still read, so
// nobody loses one; it is written back as JSON the next time it is saved.
// ponytail: drop once nobody can still have a state.js, i.e. after the first release
function readOldForm(name: DataName): unknown {
  try {
    const text = fs.readFileSync(path.join(folder(), `${name}.js`), 'utf8');
    return JSON.parse(text.slice(text.indexOf('{'), text.lastIndexOf('}') + 1));
  } catch {
    return null;
  }
}

/** One of the run files, or null when it is not there yet (before `koppler init`) or unreadable. */
export function readData(name: DataName): Data | null {
  // The stack's copy and the board file are brought up to this Koppler's format as they are read.
  const upgrade = UPGRADES[name];
  const upgraded = upgrade ? readUpgraded(dataFile(name), upgrade) : undefined;
  if (upgraded?.error !== undefined) fail(`${name}: ${upgraded.error}`);
  const value = upgraded?.value ?? readJson(dataFile(name)) ?? readOldForm(name);
  return isData(value) ? value : null;
}
const UPGRADES: Partial<Record<DataName, Upgrade>> = { registry: upgradeStack, state: upgradeBoardFile };

/** The stack in use, as the last sync copied it: the stack file, where it came from, and calls found in the code. */
export type Registry = Stack & {
  source?: string;
  /** Calls the stack does not record, found in the clones: caller, then callee, then where. */
  found?: Record<string, Record<string, string>>;
  /** No stack yet: the canvas asks for one. */
  setup?: boolean;
};
/** An app's clone on this machine. */
export interface Clone {
  path: string;
  branch?: string | null;
  dirty?: number;
  branches?: string[];
  /** Clones of libraries the app depends on, which it can use in place of the published ones. */
  libraries?: { name: string; path: string; ecosystem: 'dart' | 'npm' }[];
}
/**
 * The stack in use as this Koppler reads it: brought up to its format, its expressions filled in, and its databases
 * folded into its apps' needs (those in `local` run on this Mac and bring none). The file itself is left as written.
 */
export const readStack = (local?: ReadonlySet<string>): Registry | null => {
  const raw = readData('registry');
  if (!raw) return null;
  const migrated = migrateStack(raw);
  if (migrated.error !== undefined) fail(`The stack: ${migrated.error}`);
  return withDatabases(resolveExpressions(migrated.value) as Registry, local);
};
/** The clones the last sync found, by app. */
export const readClones = () => (readData('local')?.['apps'] ?? {}) as Record<string, Clone | null | undefined>;

export function writeData(name: DataName, value: Data): void {
  writeJson(dataFile(name), value);
  fs.rmSync(path.join(folder(), `${name}.js`), { force: true });
}
