// Fields of a stack the user locked on this Mac: no command, no canvas edit and no agent changes them until the user
// unlocks them, on the canvas or in their own terminal. Kept beside the approvals, out of the shared stack file.
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { writeJson } from '../json-files.ts';
import { getAt, parsePath } from '../core/stack-path.ts';

const locksFile = () =>
  path.join(process.env['KOPPLER_CONFIG_DIR'] || path.join(os.homedir(), '.config', 'koppler'), 'locked-fields.json');
const all = (): Record<string, string[] | undefined> => {
  try {
    return JSON.parse(fs.readFileSync(locksFile(), 'utf8')) as Record<string, string[] | undefined>;
  } catch {
    return {};
  }
};

/** The locked fields of the stack kept at this file, as paths. */
export const lockedPaths = (source: string): string[] => all()[source] ?? [];

export function setLock(source: string, at: string, on: boolean): { error?: string } {
  if ('error' in parsePath(at)) return { error: `${at} is not a path such as apps.orders.url` };
  const rest = lockedPaths(source).filter(one => one !== at);
  writeJson(locksFile(), { ...all(), [source]: on ? [...rest, at] : rest });
  return {};
}

/** The first locked field the change would alter, or null when it leaves every one as it was. */
export function brokenLock(source: string, before: unknown, after: unknown): string | null {
  for (const at of lockedPaths(source)) {
    const parts = parsePath(at);
    if ('error' in parts) continue;
    if (JSON.stringify(getAt(before, parts)) !== JSON.stringify(getAt(after, parts))) return at;
  }
  return null;
}

export const LOCKED = (at: string) =>
  `${at} is locked; unlock it on the canvas, or with koppler stack unlock ${at} in your own terminal`;
