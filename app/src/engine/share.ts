// Sharing a board with the team: it joins the stack's team boards through a pull request on the stack's repo on
// GitHub, made from the shared file as it is there, so nothing else of this Mac's copy goes with it and the clone here
// is never touched. A stack that is not on GitHub keeps the board in its file here, for the user to commit.
import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { migrate, type StoredPreset } from '../core/presets.ts';
import { validateStack } from '../core/stack.ts';
import { fileUrl, proposeFile, readFile, gh, type GithubFile } from '../github.ts';
import { readJson } from '../json-files.ts';
import { sourceOf } from './linked.ts';
import { saveStack } from './stack-file.ts';

type Failed = { error: string };
/** Where a pull request for the stack would go, or why there is none. */
export type Target = { file: GithubFile; repo: string; error?: undefined } | Failed;

const git = (cwd: string, ...args: string[]) => {
  try {
    return execFileSync('git', ['-C', cwd, ...args], { encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] }).trim();
  } catch {
    return '';
  }
};

/** A GitHub remote as owner and repo: git@github.com:o/r.git, https://github.com/o/r(.git), ssh://git@github.com/o/r. */
export function githubRepo(remote: string): { owner: string; repo: string } | null {
  const found =
    /^(?:git@github\.com:|(?:https|ssh):\/\/(?:[\w.-]+@)?github\.com\/)([\w.-]+)\/([\w.-]+?)(?:\.git)?\/?$/.exec(
      remote.trim(),
    );
  return found?.[1] && found[2] ? { owner: found[1], repo: found[2] } : null;
}

/** The stack file on GitHub a pull request goes to: a linked stack's source, else the GitHub repo its folder is in. */
export async function shareTarget(dir: string): Promise<Target> {
  const linked = sourceOf(dir);
  if (linked?.file) return { file: linked.file, repo: `${linked.file.owner}/${linked.file.repo}` };
  const top = git(dir, 'rev-parse', '--show-toplevel');
  const remote = top ? githubRepo(git(dir, 'remote', 'get-url', 'origin')) : null;
  if (!top || !remote) return { error: "The stack's folder is not a clone of a repo on GitHub." };
  const branch = await gh([`repos/${remote.owner}/${remote.repo}`, '--jq', '.default_branch']);
  if (!branch.ok) return { error: `Could not reach ${remote.owner}/${remote.repo}. Check that gh is signed in.` };
  // Git names the clone by its real path: a folder reached through a link (/var is /private/var on macOS) is too.
  const stackPath = path
    .relative(top, path.join(fs.realpathSync(dir), 'stack.json'))
    .split(path.sep)
    .join('/');
  if (stackPath.startsWith('..')) return { error: "The stack's file is not inside its repo." };
  return { file: { ...remote, ref: branch.out.trim(), path: stackPath }, repo: `${remote.owner}/${remote.repo}` };
}

/** The team's stack with this board among its team boards: replacing one of the same name, else added at the end. */
export function withBoard(stack: Record<string, unknown>, board: StoredPreset): Record<string, unknown> {
  const presets = (Array.isArray(stack['presets']) ? stack['presets'] : []) as StoredPreset[];
  const at = presets.findIndex(one => one.name === board.name);
  return { ...stack, presets: at < 0 ? [...presets, board] : presets.map((one, n) => (n === at ? board : one)) };
}

/** What of a board the team gets: its apps, cables and places, never this Mac's own notes on it. */
export function teamBoard(preset: StoredPreset): { board: StoredPreset; error?: undefined } | Failed {
  const checked = migrate(preset);
  if (checked.error !== undefined) return { error: checked.error };
  const { name, version, nodes, edges } = checked.preset;
  const { layout, outside } = preset;
  return {
    board: {
      name,
      ...(version !== undefined && { version }),
      nodes,
      edges,
      ...(layout ? { layout } : {}),
      ...(outside ? { outside } : {}),
    },
  };
}

/** Shared: a pull request on GitHub, or, for a stack not on GitHub, the board kept in its file here to commit. */
export type Shared =
  | { url: string; repo: string; local?: undefined; error?: undefined }
  | { local: true; url?: undefined; error?: undefined }
  | Failed;

/** Opens the pull request that adds the board to the stack's team boards on GitHub. */
export async function shareBoard(dir: string, preset: StoredPreset): Promise<Shared> {
  const team = teamBoard(preset);
  if (team.error !== undefined) return { error: `${preset.name}: ${team.error}` };
  const { board } = team;
  const target = await shareTarget(dir);
  if (target.error !== undefined) {
    if (!sourceOf(dir) && !git(dir, 'rev-parse', '--show-toplevel').length) return keepHere(dir, board);
    const remote = githubRepo(git(dir, 'remote', 'get-url', 'origin'));
    return remote ? target : keepHere(dir, board);
  }
  const text = await readFile(target.file);
  if (text === null) return { error: `Could not read ${fileUrl(target.file)}. Check that gh is signed in.` };
  let shared: Record<string, unknown>;
  try {
    shared = JSON.parse(text) as Record<string, unknown>;
  } catch {
    return { error: `${fileUrl(target.file)} is not JSON.` };
  }
  const next = withBoard(shared, board);
  const problems = validateStack(next);
  if (problems.length)
    return { error: `The team's stack would not pass its check: ${problems.slice(0, 3).join('; ')}` };
  const replaces = ((shared['presets'] ?? []) as StoredPreset[]).some(one => one.name === board.name);
  const slug =
    board.name
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, '-')
      .replace(/^-|-$/g, '')
      .slice(0, 40) || 'board';
  const title = `${replaces ? 'Update' : 'Add'} the "${board.name}" board`;
  const opened = await proposeFile(target.file, `${JSON.stringify(next, null, 2)}\n`, {
    branch: `koppler/board-${slug}-${Date.now().toString(36)}`,
    title,
    body: `${title} among the team boards of this stack, as shared from the Koppler canvas.\n\nOnce merged, it shows under Team boards for everyone who uses the stack.`,
  });
  return opened.error !== undefined ? opened : { url: opened.url, repo: target.repo };
}

/** A stack that is not on GitHub: the board joins its file here, for the user to commit. */
function keepHere(dir: string, board: StoredPreset): Shared | Failed {
  const source = path.join(dir, 'stack.json');
  const before = readJson(source) as Record<string, unknown> | null;
  if (!before) return { error: `cannot read ${source}` };
  const next = withBoard(before, board);
  const problems = validateStack(next);
  if (problems.length) return { error: `The stack would not pass its check: ${problems.slice(0, 3).join('; ')}` };
  return saveStack(source, before, next) ?? { local: true };
}
