// The run files the engine, the server and the page share: the stack in use, the clones on this machine, the repos
// found, and the board. Each is one JSON file in the run folder.
import fs from 'node:fs';
import path from 'node:path';
import type { Stack } from './core/stack.ts';
import { readJson, writeJson } from './json-files.ts';
import { TEMP } from './paths.ts';

export type DataName = 'registry' | 'local' | 'repos' | 'state' | 'board-edits';
export type Data = Record<string, unknown>;

// Read at each call: the tests, and a stack switch, change where the run folder is while the process lives.
const folder = () => process.env['KOPPLER_TEMP'] ?? TEMP;
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
  const value = readJson(dataFile(name)) ?? readOldForm(name);
  return isData(value) ? value : null;
}

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
/** The stack in use. It passed the stack check when it was copied here, so it is read as one. */
export const readStack = () => readData('registry') as Registry | null;
/** The clones the last sync found, by app. */
export const readClones = () => (readData('local')?.['apps'] ?? {}) as Record<string, Clone | null | undefined>;

export function writeData(name: DataName, value: Data): void {
  writeJson(dataFile(name), value);
  fs.rmSync(path.join(folder(), `${name}.js`), { force: true });
}
