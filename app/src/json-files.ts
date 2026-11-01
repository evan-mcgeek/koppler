// JSON files on disk: read without throwing, written whole or not at all, readable by the user alone.
import fs from 'node:fs';
import path from 'node:path';

/** The file's content, or `fallback` when it is missing or not JSON. A byte order mark, as editors on Windows add, is fine. */
export function readJson(file: string): unknown;
export function readJson<T>(file: string, fallback: T): T;
export function readJson<T>(file: string, fallback: T | null = null): T | null {
  try {
    return JSON.parse(fs.readFileSync(file, 'utf8').replace(/^\uFEFF/, '')) as T;
  } catch {
    return fallback;
  }
}

/** Written beside the file and moved into place, so a reader never sees half of it. */
export function writeJson(file: string, value: unknown): void {
  fs.mkdirSync(path.dirname(file), { recursive: true, mode: 0o700 });
  const beside = `${file}.${String(process.pid)}.tmp`;
  fs.writeFileSync(beside, `${JSON.stringify(value, null, 2)}\n`, { mode: 0o600 });
  fs.renameSync(beside, file);
}

/** Runs `work` while no other process does so for `file`: one read-change-write at a time. */
export function locked<T>(file: string, work: () => T): T {
  const lock = `${file}.lock`;
  fs.mkdirSync(path.dirname(file), { recursive: true, mode: 0o700 });
  for (let tries = 0; ; tries++) {
    try {
      fs.mkdirSync(lock);
      break;
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== 'EEXIST') throw error;
      // A lock left by a process that died is taken over.
      const age = Date.now() - (fs.statSync(lock, { throwIfNoEntry: false })?.mtimeMs ?? 0);
      if (tries > 200 || age > 5000) fs.rmSync(lock, { recursive: true, force: true });
      else Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, 10);
    }
  }
  try {
    return work();
  } finally {
    fs.rmSync(lock, { recursive: true, force: true });
  }
}

/**
 * `read(file)` again only once the file changed (written anew, or moved into place), else what it gave last time: for a
 * file read over and over, such as the stack while the canvas runs. What it gives is shared, so it is never changed.
 */
export function whenChanged<T>(read: (file: string) => T): (file: string) => T {
  const seen = new Map<string, { key: string; value: T }>();
  return file => {
    const at = fs.statSync(file, { throwIfNoEntry: false });
    const key = at ? `${String(at.ino)}:${String(at.mtimeMs)}:${String(at.size)}` : 'none';
    const last = seen.get(file);
    if (last?.key === key) return last.value;
    const value = read(file);
    seen.set(file, { key, value });
    return value;
  };
}
