// Stacks used straight from GitHub. Koppler keeps a copy in the private config; what it learns goes into that copy,
// shows as changes not in the shared stack yet, and reaches the team only through a pull request the user opens.
// Next to the copy, .source.json holds the link and `base`: the shared file as it was when last fetched.
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { fileUrl, githubFile, proposeFile, readFile } from './github.ts';
import { validateStack } from './core/stack.ts';
import { setStack } from './sync.mjs';

const configDir = () => process.env.KOPPLER_CONFIG_DIR || path.join(os.homedir(), '.config', 'koppler');
const SOURCE = '.source.json';
const readJson = file => { try { return JSON.parse(fs.readFileSync(file, 'utf8')); } catch { return null; } };
const writeJson = (file, value) => { fs.mkdirSync(path.dirname(file), { recursive: true, mode: 0o700 }); fs.writeFileSync(file, JSON.stringify(value, null, 2) + '\n'); };
const same = (a, b) => JSON.stringify(a) === JSON.stringify(b);
export const sourceOf = dir => readJson(path.join(dir, SOURCE));

async function fetchStack(f, read = readFile) {
  const text = await read(f);
  if (text === null) return { error: 'Could not read that file. Check the link, and that gh is signed in for a private repo.' };
  let stack; try { stack = JSON.parse(text); } catch { return { error: 'That file is not JSON.' }; }
  const errors = validateStack(stack);
  return errors.length ? { error: `That is not a stack Koppler can use: ${errors.slice(0, 3).join('; ')}` } : { stack };
}

// Links a stack on GitHub and makes it the one in use.
export async function linkStack(link, { config, save, read } = {}) {
  const f = githubFile(link);
  if (!f) return { error: 'Paste a link to a stack.json on GitHub, e.g. https://github.com/<owner>/<repo>/blob/main/stacks/<name>/stack.json' };
  const got = await fetchStack(f, read);
  if (got.error) return got;
  const slug = `${f.owner}-${f.repo}-${path.basename(path.dirname(f.path)) || 'stack'}`.toLowerCase().replace(/[^a-z0-9]+/g, '-');
  const dir = path.join(configDir(), 'stacks', slug);
  const old = sourceOf(dir);
  if (old && old.url !== fileUrl(f)) return { error: `A different linked stack already uses the name ${slug}.` };
  if (!old) {
    writeJson(path.join(dir, 'stack.json'), got.stack);
    writeJson(path.join(dir, SOURCE), { url: fileUrl(f), file: f, base: got.stack, fetchedAt: new Date().toISOString() });
  }
  setStack(config ?? readJson(path.join(configDir(), 'config.json')) ?? {}, dir, save ?? (c => writeJson(path.join(configDir(), 'config.json'), c)));
  return { stack: dir, name: got.stack.name };
}

// What differs between the shared stack as last fetched and the copy here, in plain lines.
export function changes(base, local) {
  const out = [], name = (s, id) => s?.apps?.[id]?.name ?? id;
  for (const id of Object.keys(local.apps ?? {})) if (!base.apps?.[id]) out.push(`added ${name(local, id)}`);
  for (const id of Object.keys(base.apps ?? {})) if (!local.apps?.[id]) out.push(`removed ${name(base, id)}`);
  for (const id of Object.keys(local.apps ?? {})) if (base.apps?.[id] && !same(base.apps[id], local.apps[id])) {
    const keys = [...new Set([...Object.keys(base.apps[id]), ...Object.keys(local.apps[id])])].filter(k => !same(base.apps[id][k], local.apps[id][k]));
    out.push(`changed ${name(local, id)}: ${keys.join(', ')}`);
  }
  for (const k of [...new Set([...Object.keys(base), ...Object.keys(local)])].filter(k => k !== 'apps' && !same(base[k], local[k]))) out.push(`changed ${k}`);
  return out;
}

export function linkedStatus(dir) {
  const src = sourceOf(dir), local = readJson(path.join(dir, 'stack.json'));
  if (!src || !local) return null;
  return { url: src.url, fetchedAt: src.fetchedAt, changes: changes(src.base, local), ...(src.pr && { pr: src.pr }) };
}

// Brings in what changed on GitHub. A copy with changes of its own is only updated when nothing would be lost.
export async function updateStack(dir, { read } = {}) {
  const src = sourceOf(dir), local = readJson(path.join(dir, 'stack.json'));
  if (!src) return { error: 'That stack is not linked to GitHub.' };
  const got = await fetchStack(src.file, read);
  if (got.error) return got;
  const remote = got.stack, base = src.base;
  const keep = next => { writeJson(path.join(dir, SOURCE), { ...src, ...next, fetchedAt: new Date().toISOString() }); };
  if (same(remote, base)) { keep({}); return { updated: false, message: 'Already up to date.' }; }
  if (same(local, base) || same(local, remote)) {
    writeJson(path.join(dir, 'stack.json'), remote);
    const { pr, ...rest } = src;
    keep({ ...rest, base: remote, pr: same(local, remote) ? undefined : pr });
    return { updated: true, message: same(local, remote) ? 'Your changes are in the shared stack now.' : 'Updated from GitHub.' };
  }
  return { error: 'The shared stack changed on GitHub, and this copy has changes of its own. Open a pull request with yours first, or discard them, then check again.' };
}

export function discardChanges(dir) {
  const src = sourceOf(dir);
  if (!src) return { error: 'That stack is not linked to GitHub.' };
  writeJson(path.join(dir, 'stack.json'), src.base);
  return { discarded: true };
}

// A pull request with this copy's changes. Outward-facing: only from the user's own confirmation on the canvas or in the terminal.
export async function proposeChanges(dir, { propose = proposeFile } = {}) {
  const src = sourceOf(dir), local = readJson(path.join(dir, 'stack.json'));
  if (!src || !local) return { error: 'That stack is not linked to GitHub.' };
  const list = changes(src.base, local);
  if (!list.length) return { error: 'There is nothing to share: this copy matches the shared stack.' };
  const branch = `koppler/${(local.name ?? 'stack').toLowerCase().replace(/[^a-z0-9]+/g, '-')}-${Date.now().toString(36)}`;
  const result = await propose(src.file, JSON.stringify(local, null, 2) + '\n', {
    branch, title: `${local.name}: ${list.length} ${list.length === 1 ? 'change' : 'changes'} from Koppler`,
    body: `What Koppler learned while running these apps locally:\n\n${list.map(l => `- ${l}`).join('\n')}\n\nNames and addresses only; no secret values.`,
  });
  if (result.url) writeJson(path.join(dir, SOURCE), { ...src, pr: result.url });
  return result;
}
