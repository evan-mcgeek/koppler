// Stacks used straight from GitHub. Koppler keeps a copy in the private config; what it learns goes into that copy,
// shows as changes not in the shared stack yet, and reaches the team only through a pull request the user opens.
// Next to the copy, .source.json holds the link and `base`: the shared file as it was when last fetched.
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { validateStack } from '../core/stack.ts';
import { fileUrl, githubFile, proposeFile, readFile, type GithubFile } from '../github.ts';
import { setStack } from './sync.ts';

/** A stack file, compared key by key. */
type StackJson = Record<string, unknown> & {
  name?: string;
  apps?: Record<string, Record<string, unknown> | undefined>;
};
/** Where a linked copy came from. */
interface Source {
  url: string;
  file: GithubFile;
  /** The shared file as it was when last fetched. */
  base: StackJson;
  fetchedAt?: string;
  /** The pull request that proposes this copy's changes. */
  pr?: string | undefined;
}
type Failed = { error: string };
type Read = (file: GithubFile) => Promise<string | null>;
type Config = Parameters<typeof setStack>[0];

const configDir = () => process.env['KOPPLER_CONFIG_DIR'] || path.join(os.homedir(), '.config', 'koppler');
const SOURCE = '.source.json';
const NOT_LINKED: Failed = { error: 'That stack is not linked to GitHub.' };
function readJson(file: string): unknown {
  try {
    return JSON.parse(fs.readFileSync(file, 'utf8'));
  } catch {
    return null;
  }
}
const writeJson = (file: string, value: unknown) => {
  fs.mkdirSync(path.dirname(file), { recursive: true, mode: 0o700 });
  fs.writeFileSync(file, JSON.stringify(value, null, 2) + '\n');
};
const same = (a: unknown, b: unknown) => JSON.stringify(a) === JSON.stringify(b);
const stamp = () => new Date().toISOString();
export const sourceOf = (dir: string) => readJson(path.join(dir, SOURCE)) as Source | null;
const copyIn = (dir: string) => readJson(path.join(dir, 'stack.json')) as StackJson | null;

async function fetchStack(
  file: GithubFile,
  read: Read = readFile,
): Promise<{ stack: StackJson; error?: undefined } | Failed> {
  const text = await read(file);
  if (text === null)
    return { error: 'Could not read that file. Check the link, and that gh is signed in for a private repo.' };
  let stack: StackJson;
  try {
    stack = JSON.parse(text) as StackJson;
  } catch {
    return { error: 'That file is not JSON.' };
  }
  const errors = validateStack(stack);
  return errors.length ? { error: `That is not a stack Koppler can use: ${errors.slice(0, 3).join('; ')}` } : { stack };
}

/** Links a stack on GitHub and makes it the one in use. */
export async function linkStack(
  link: string,
  { config, save, read }: { config?: Config; save?: (config: Config) => void; read?: Read } = {},
): Promise<{ stack: string; name: string | undefined; error?: undefined } | Failed> {
  const file = githubFile(link);
  if (!file)
    return {
      error:
        'Paste a link to a stack.json on GitHub, e.g. https://github.com/<owner>/<repo>/blob/main/stacks/<name>/stack.json',
    };
  const got = await fetchStack(file, read);
  if (got.error !== undefined) return got;
  const folder = path.basename(path.dirname(file.path)) || 'stack';
  const slug = `${file.owner}-${file.repo}-${folder}`.toLowerCase().replace(/[^a-z0-9]+/g, '-');
  const dir = path.join(configDir(), 'stacks', slug);
  const old = sourceOf(dir);
  if (old && old.url !== fileUrl(file)) return { error: `A different linked stack already uses the name ${slug}.` };
  if (!old) {
    writeJson(path.join(dir, 'stack.json'), got.stack);
    writeJson(path.join(dir, SOURCE), { url: fileUrl(file), file, base: got.stack, fetchedAt: stamp() });
  }
  const configFile = path.join(configDir(), 'config.json');
  setStack(
    config ?? (readJson(configFile) as Config | null) ?? {},
    dir,
    save ??
      (next => {
        writeJson(configFile, next);
      }),
  );
  return { stack: dir, name: got.stack.name };
}

/** What differs between the shared stack as last fetched and the copy here, in plain lines. */
export function changes(base: StackJson, local: StackJson): string[] {
  const out: string[] = [];
  const name = (stack: StackJson, id: string) => (stack.apps?.[id]?.['name'] as string | undefined) ?? id;
  const before = base.apps ?? {};
  const after = local.apps ?? {};
  for (const id of Object.keys(after)) if (!before[id]) out.push(`added ${name(local, id)}`);
  for (const id of Object.keys(before)) if (!after[id]) out.push(`removed ${name(base, id)}`);
  for (const [id, now] of Object.entries(after)) {
    const was = before[id];
    if (!was || !now || same(was, now)) continue;
    const keys = [...new Set([...Object.keys(was), ...Object.keys(now)])].filter(key => !same(was[key], now[key]));
    out.push(`changed ${name(local, id)}: ${keys.join(', ')}`);
  }
  for (const key of new Set([...Object.keys(base), ...Object.keys(local)]))
    if (key !== 'apps' && !same(base[key], local[key])) out.push(`changed ${key}`);
  return out;
}

export function linkedStatus(dir: string) {
  const source = sourceOf(dir);
  const local = copyIn(dir);
  if (!source || !local) return null;
  return {
    url: source.url,
    fetchedAt: source.fetchedAt,
    changes: changes(source.base, local),
    ...(source.pr && { pr: source.pr }),
  };
}

/** Brings in what changed on GitHub. A copy with changes of its own is only updated when nothing would be lost. */
export async function updateStack(
  dir: string,
  { read }: { read?: Read } = {},
): Promise<{ updated: boolean; message: string; error?: undefined } | Failed> {
  const source = sourceOf(dir);
  const local = copyIn(dir);
  if (!source) return NOT_LINKED;
  const got = await fetchStack(source.file, read);
  if (got.error !== undefined) return got;
  const remote = got.stack;
  const keep = (next: Partial<Source>) => {
    writeJson(path.join(dir, SOURCE), { ...source, ...next, fetchedAt: stamp() });
  };
  if (same(remote, source.base)) {
    keep({});
    return { updated: false, message: 'Already up to date.' };
  }
  const merged = same(local, remote);
  if (same(local, source.base) || merged) {
    writeJson(path.join(dir, 'stack.json'), remote);
    keep({ base: remote, pr: merged ? undefined : source.pr });
    return { updated: true, message: merged ? 'Your changes are in the shared stack now.' : 'Updated from GitHub.' };
  }
  return {
    error:
      'The shared stack changed on GitHub, and this copy has changes of its own. Open a pull request with yours first, or discard them, then check again.',
  };
}

export function discardChanges(dir: string): { discarded: true; error?: undefined } | Failed {
  const source = sourceOf(dir);
  if (!source) return NOT_LINKED;
  writeJson(path.join(dir, 'stack.json'), source.base);
  return { discarded: true };
}

/** A pull request with this copy's changes. Outward-facing: only from the user's own confirmation on the canvas or in the terminal. */
export async function proposeChanges(dir: string, { propose = proposeFile } = {}) {
  const source = sourceOf(dir);
  const local = copyIn(dir);
  if (!source || !local) return NOT_LINKED;
  const list = changes(source.base, local);
  if (!list.length) return { error: 'There is nothing to share: this copy matches the shared stack.' };
  const slug = (local.name ?? 'stack').toLowerCase().replace(/[^a-z0-9]+/g, '-');
  const result = await propose(source.file, JSON.stringify(local, null, 2) + '\n', {
    branch: `koppler/${slug}-${Date.now().toString(36)}`,
    title: `${String(local.name)}: ${String(list.length)} ${list.length === 1 ? 'change' : 'changes'} from Koppler`,
    body: `What Koppler learned while running these apps locally:\n\n${list.map(line => `- ${line}`).join('\n')}\n\nNames and addresses only; no secret values.`,
  });
  if (result.error === undefined) writeJson(path.join(dir, SOURCE), { ...source, pr: result.url });
  return result;
}
