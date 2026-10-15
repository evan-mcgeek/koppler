// The name Claude Code shows for a session: the one given with /rename, else the title it made up. Both are kept in the
// session's transcript; only those records are read, from its end, where the newest are.
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

const TAIL = 2 * 1024 * 1024;

/** The last `field` of the records of this type in the text, or undefined. */
function last(text: string, type: string, field: string): string | undefined {
  let found: string | undefined;
  for (const line of text.split('\n')) {
    if (!line.includes(`"type":"${type}"`)) continue;
    try {
      const value = (JSON.parse(line) as Record<string, unknown>)[field];
      if (typeof value === 'string' && value.trim()) found = value.trim();
    } catch {
      // A line cut by the tail, or not a record.
    }
  }
  return found;
}

/** The session's name, or undefined when its transcript or a title is not found. */
export function claudeTitle(
  session: string,
  home = process.env['CLAUDE_CONFIG_DIR'] ?? path.join(os.homedir(), '.claude'),
): string | undefined {
  if (!/^[\w-]{8,64}$/.test(session)) return undefined;
  const projects = path.join(home, 'projects');
  let file: string | undefined;
  try {
    file = fs
      .readdirSync(projects)
      .map(folder => path.join(projects, folder, `${session}.jsonl`))
      .find(one => fs.existsSync(one));
  } catch {
    return undefined;
  }
  if (!file) return undefined;
  const read = (whole: boolean) => {
    const size = fs.statSync(file).size;
    const from = whole ? 0 : Math.max(0, size - TAIL);
    const fd = fs.openSync(file, 'r');
    try {
      const buffer = Buffer.alloc(size - from);
      fs.readSync(fd, buffer, 0, buffer.length, from);
      return buffer.toString('utf8');
    } finally {
      fs.closeSync(fd);
    }
  };
  const title = (text: string) => last(text, 'custom-title', 'customTitle') ?? last(text, 'ai-title', 'aiTitle');
  // Long sessions repeat their title often; one renamed long ago may only say so further back.
  return title(read(false)) ?? title(read(true));
}
