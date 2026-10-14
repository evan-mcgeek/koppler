// `koppler watch <app>`: started by a run beside an app whose card asks for it, and stopped with it. When a file in the
// app's clone changes, the app starts again exactly as it was started, its wiring included.
import fs from 'node:fs';
import path from 'node:path';
import { positional } from '../cli/output.ts';
import { readClones, readStack } from '../data.ts';
import { fail } from '../failure.ts';
import { NAME, readRecord, startProcess, stopOne } from './processes.ts';

/** What changes all the time without being a change to the app: its tools' and builds' own folders. */
const NOISE = [
  '.git',
  'node_modules',
  'bin',
  'obj',
  'build',
  'dist',
  '.dart_tool',
  '.next',
  '.idea',
  '.vs',
  'coverage',
];
/** The watcher of an app, as a process of its own. */
export const watcherOf = (id: string) => `${id.slice(0, 58)}-watch`;

/** Whether a changed path, relative to the clone, is one that never restarts the app. */
export function ignored(file: string, ignore: string[]): boolean {
  const parts = file.split(/[\\/]/);
  return (
    parts.some(part => NOISE.includes(part)) ||
    ignore.some(one => {
      const at = one.replace(/^\.\/|\/$/g, '');
      return file === at || file.startsWith(`${at}/`) || parts.includes(at);
    })
  );
}

export function watchCommand(args: string[]): void {
  const [id = ''] = positional(args);
  if (!NAME.test(id)) fail('usage: koppler watch <app>');
  const repo = readClones()[id]?.path ?? fail(`${id} is not cloned`);
  const ignore = readStack()?.apps[id]?.watch?.ignore ?? [];
  let timer: NodeJS.Timeout | undefined;
  let busy = false;
  let changed = '';
  const restart = async () => {
    if (busy) return;
    const record = readRecord(id);
    if (!record?.start) {
      console.log(`${id} no longer runs: the watch ends`);
      process.exit(0);
    }
    busy = true;
    console.log(`${new Date().toLocaleTimeString()} ${changed} changed: restarting ${id}`);
    try {
      console.log(await stopOne(record));
      await startProcess(record.start);
    } catch (error) {
      console.log(`${id} did not start again: ${(error as Error).message}`);
    }
    busy = false;
  };
  fs.watch(repo, { recursive: true }, (_, file) => {
    if (!file || ignored(file, ignore)) return;
    changed = path.normalize(file);
    clearTimeout(timer);
    timer = setTimeout(() => void restart(), 800);
  });
  console.log(`watching ${repo} for ${id}`);
}
