// Finds your local repos (any git host) and the shared stack config, then copies the stack into the run folder as registry.json and
// each app's clone into local.json, for the canvas and the commands.
// Usage: koppler init [--root <dir>]... [--depth <n>] [--stack <dir>]   first-time scan of every repo, remembered
//        koppler sync [--stack <dir>] [--rescan]                        before each run
import fs from 'node:fs';
import path from 'node:path';
import { readJson, writeJson } from '../json-files.ts';
import { of as kindOf } from '../core/kinds.ts';
import { validateStack } from '../core/stack.ts';
import { writeData, type Clone } from '../data.ts';
import { tempDir } from '../paths.ts';
import { checkStack as checkLoadedStack } from './checks.ts';
import { librariesFor, packageOf, type Library } from './libraries.ts';
import { grepClone, hostOwners, hostsByApp, lines, missingCalls } from './calls.ts';
import { CONFIG, expand, fail, type Index, loadConfig, readIndex, type Save, type StackFile, tilde } from './config.ts';
import {
  branchesOf,
  candidateRepos,
  DEFAULT_DEPTH,
  DEFAULT_ROOTS,
  git,
  scan,
  slugMatches,
  findStacks,
} from './repos.ts';
import { currentStack, knownStacks, LOADING, setStack, useStack, writeSetup, privateStacks } from './stacks.ts';

interface Flags {
  roots: string[];
  stack?: string;
  depth?: number;
  rescan?: true;
}

function parseFlags(args: string[]): Flags {
  const flags: Flags = { roots: [] };
  for (let at = 0; at < args.length; at++) {
    const arg = args[at];
    if (arg === '--root') flags.roots.push(expand(args[++at] ?? fail('--root needs a folder')));
    else if (arg === '--stack') flags.stack = expand(args[++at] ?? fail('--stack needs a folder'));
    else if (arg === '--depth') flags.depth = Number(args[++at]);
    else if (arg === '--rescan') flags.rescan = true;
    else fail(`unknown option ${String(arg)}`);
  }
  if (flags.depth !== undefined && !(flags.depth >= 1 && flags.depth <= 8)) fail('--depth must be 1 to 8');
  return flags;
}

/** Copies the stack and resolves each app to a clone from the index; branch and changes are read fresh every time. */
function syncStack(stackDir: string, index: Index): void {
  const source = path.join(stackDir, 'stack.json');
  const stack = (readJson(source) as StackFile | null) ?? fail(`cannot read ${source}`);
  const errors = validateStack(stack);
  if (errors.length) fail(`${source} is invalid:\n  ${errors.join('\n  ')}`);
  fs.mkdirSync(tempDir(), { recursive: true });
  // A copy of the stack file; `source` says which, and that is the one to edit.
  writeData('registry', { ...stack, source });
  const count = String(Object.keys(stack.apps).length);
  console.log(`STACK ${stack.name ?? tilde(stackDir)}: ${count} apps from ${tilde(source)}`);

  const local: Record<string, Clone | null> = {};
  const here = index.repos.filter(repo => fs.existsSync(repo.path));
  // Every clone that publishes a package (Dart or npm), so an app can use the local copy of a library it depends on.
  const packages = here.flatMap((repo): Library[] => {
    const published = packageOf(repo.path);
    return published ? [{ path: repo.path, ...published }] : [];
  });
  for (const [id, app] of Object.entries(stack.apps)) {
    local[id] = null;
    // An outside system has nothing to clone.
    if (app.outside) continue;
    const slug = app.slug ?? '';
    const paths = here.filter(repo => repo.keys.some(key => slugMatches(slug, key))).map(repo => repo.path);
    const [clone, ...others] = paths.sort((a, b) => a.length - b.length);
    if (!clone) {
      const host = slug.split('/')[0]?.includes('.') ? '' : 'github.com/';
      console.log(`MISSING ${id}: git clone https://${host}${slug}.git (then koppler sync --rescan)`);
      continue;
    }
    const dirty = lines(git(clone, 'status', '--porcelain')).length;
    const libraries = librariesFor(clone, packages);
    const branch = git(clone, 'branch', '--show-current') || null;
    local[id] = { path: clone, branch, dirty, branches: branchesOf(clone), ...(libraries.length && { libraries }) };
    const also = others.length ? ` (also: ${others.map(tilde).join(', ')})` : '';
    console.log(`OK ${id}: ${tilde(clone)} [${branch ?? 'detached'}]${dirty ? ` dirty=${String(dirty)}` : ''}${also}`);
  }
  writeData('repos', {
    roots: index.roots.map(tilde),
    stack: tilde(stackDir),
    repos: candidateRepos(index, stack, stackDir),
  });
  writeData('local', { roots: index.roots, at: new Date().toISOString(), apps: local });

  // An empty `consumes` means nobody has mapped that app yet, not that it calls nothing: look in every clone.
  const found = missingCalls(stack, (id, hosts) => {
    const clone = local[id];
    return clone ? grepClone(clone.path, hosts) : [];
  });
  for (const [caller, calls] of Object.entries(found))
    for (const [callee, where] of Object.entries(calls))
      console.log(`FOUND ${caller} -> ${callee}, not in stack.json: ${where}`);
  const known = hostsByApp(stack);
  for (const [id, app] of Object.entries(stack.apps))
    if (!app.outside && !known[id]?.size && kindOf(app, stack).serves)
      console.log(`UNKNOWN ${id}: no deployed address in stack.json, so calls to it cannot be found`);
  for (const [host, ids] of hostOwners(stack).shared)
    console.log(`SHARED ${host} is used by ${ids.join(' and ')}, so calls to it are not attributed`);
  writeData('registry', { ...stack, source, found });
}

const checkStack = (dir: string) => {
  if (!fs.existsSync(path.join(dir, 'stack.json'))) fail(`no stack.json in ${tilde(dir)}`);
};

const keepConfig: Save = () => undefined;

const SEVERAL =
  'Several stacks found. Pick one on the canvas (koppler init --pick), or: koppler init --stack <one of the folders above>';

const NONE =
  'No stack yet. Create one on the canvas (koppler init --pick), or point at an existing one: koppler init --stack <folder with stack.json>';

export function init(args: string[]): void {
  const flags = parseFlags(args);
  if (flags.stack) checkStack(flags.stack);
  const config = loadConfig();
  const usual = () => DEFAULT_ROOTS.map(expand).filter(dir => fs.existsSync(dir));
  const roots = flags.roots.length ? flags.roots : config.roots?.length ? config.roots : usual();
  if (!roots.length) fail('no folder to scan: koppler init --root <folder with your repos>');
  const depth = flags.depth ?? config.depth ?? DEFAULT_DEPTH;
  Object.assign(config, { roots, depth });
  const index = scan(roots, depth);

  const stacks = [...findStacks(index.repos), ...privateStacks()];
  for (const stack of stacks) console.log(`FOUND stack ${tilde(stack)}`);
  const [only] = stacks;
  if (flags.stack) setStack(config, flags.stack, keepConfig);
  else if (!config.stack && stacks.length === 1 && only) setStack(config, only, keepConfig);
  writeJson(CONFIG, config);

  if (!config.stack) {
    console.log(stacks.length ? SEVERAL : NONE);
    writeSetup(index);
    return;
  }
  checkStack(config.stack);
  console.log(`USING stack ${tilde(config.stack)} (change with --stack)`);
  syncStack(config.stack, index);
}

export function sync(args: string[]): void {
  const flags = parseFlags(args);
  const config = loadConfig();
  if (flags.stack) {
    checkStack(flags.stack);
    setStack(config, flags.stack, keepConfig);
  }
  if (flags.roots.length) config.roots = flags.roots;
  if (!config.stack) fail('no stack set yet: koppler init');
  fs.mkdirSync(tempDir(), { recursive: true });
  writeJson(LOADING, { stack: config.stack, pid: process.pid });
  try {
    let index = readIndex();
    if (!index || flags.rescan || flags.roots.length) {
      if (!config.roots?.length) fail('no repos scanned yet: koppler init');
      index = scan(config.roots, config.depth ?? DEFAULT_DEPTH);
    }
    writeJson(CONFIG, config);
    syncStack(config.stack, index);
  } finally {
    fs.rmSync(LOADING, { force: true });
  }
  // A stack says what it needs when it loads: missing programs, and its own checks once they were approved.
  console.log('');
  checkLoadedStack();
}

/** `koppler use`: every stack on this Mac. */
export function stacksCommand(args: string[] = []): void {
  const here = currentStack();
  const list = knownStacks(readIndex());
  if (args.includes('--json')) {
    const shown = list.map(stack => ({
      name: stack.name,
      inUse: stack.dir === here,
      path: stack.path,
      apps: stack.apps,
      envs: stack.envs,
      shared: stack.shared,
      linked: !!stack.linked,
    }));
    console.log(JSON.stringify(shown, null, 2));
    return;
  }
  if (!list.length) console.log('No stack found on this Mac. Create one: koppler init --new "<name>" --envs qa,prod');
  for (const stack of list) {
    const kind = stack.linked ? 'linked from GitHub' : stack.shared ? 'shared' : 'private';
    const about = `${kind}, ${String(stack.apps)} apps, ${stack.envs.join('/')}`;
    console.log(`${stack.dir === here ? '*' : ' '} ${stack.name}  (${about})  ${stack.path}`);
  }
}

/** `koppler use <name or folder>`: switch to one (it must not have anything running). */
export function useCommand(args: string[]): void {
  const want = args.join(' ').trim();
  const list = knownStacks(readIndex());
  if (!want) fail('usage: koppler use <stack name or folder>');
  const folder = path.resolve(expand(want));
  const matches = list.filter(stack => stack.dir === folder || stack.name.toLowerCase() === want.toLowerCase());
  const [match] = matches;
  if (!match || matches.length !== 1)
    fail(
      matches.length
        ? `several stacks are called ${want}; use its folder: koppler use`
        : `no stack called ${want}; see: koppler use`,
    );
  const result = useStack(match.dir);
  if (result.error !== undefined) fail(result.error);
  console.log(`USING ${match.name} (${match.path})`);
  sync([]);
}
