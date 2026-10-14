// Remembered code changes ("recipes"): the temporary edit an app needs for a run, kept so it is applied the same way
// next time instead of worked out again. Shared in stack.json (apps.<id>.localChanges) unless it names something only this
// Mac has (a home path, a loopback alias, the user name); then it stays in the private config. How each one did here
// (worked or not, last run) is always private.
// Usage: koppler recipes [app]
//        koppler recipes --remember <app> --why "<reason>" [--when always|calls:<app>|env:<env>] [--private] [--any-os]   from the app's last logged edit
//        koppler recipes --apply <app...> [--env <env>]       apply what matches the latest Send (its environment and cables), logged for Stop
import crypto from 'node:crypto';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { flagValue } from '../cli/output.ts';
import { fail } from '../failure.ts';
import { readClones, readStack } from '../data.ts';
import { TEMP } from '../paths.ts';
import { readActions, updateActions, type Action, type EditAction } from './actions.ts';
import { APPROVE, approved } from './checks.ts';
import { runs } from './runs.ts';
import { saveStack } from './sync.ts';

/** When a remembered change applies: always, when the app calls another local app, or on one environment. */
interface When {
  always?: boolean;
  calls?: string;
  env?: string;
}
/** A remembered change as it is stored. */
interface Stored {
  file: string;
  find: string;
  replace: string;
  why?: string;
  when?: When;
  /** The operating system it was made on, or `any`. */
  os?: string;
}
export interface Recipe extends Stored {
  app: string;
  id: string;
  /** In the stack for the team, or on this Mac only. */
  scope: 'shared' | 'private';
  /** How it did on this Mac, and when. */
  here: { at: string; ok: boolean } | null;
}
/** The stack, as far as remembered changes read it. */
interface RecipeStack {
  source?: string | undefined;
  apps?: Record<string, { localChanges?: unknown } | undefined>;
}
/** This Mac's own remembered changes per stack file and app, and how each change did here. */
interface Private {
  stacks?: Record<string, Record<string, Stored[]>>;
  runs?: Record<string, { at: string; ok: boolean }>;
}
export interface Applied {
  app: string;
  id: string;
  state: 'applied' | 'already' | 'moved' | 'missing' | 'refused';
  why: string | undefined;
  detail?: string;
  scope?: Recipe['scope'];
}

const configDir = () => process.env['KOPPLER_CONFIG_DIR'] || path.join(os.homedir(), '.config', 'koppler');
const privateFile = () => path.join(configDir(), 'recipes.json');
function readJson<T>(file: string, fallback: T): T {
  try {
    return JSON.parse(fs.readFileSync(file, 'utf8')) as T;
  } catch {
    return fallback;
  }
}
const writePrivate = (mine: Private) => {
  fs.mkdirSync(configDir(), { recursive: true });
  fs.writeFileSync(privateFile(), JSON.stringify(mine, null, 2) + '\n', { mode: 0o600 });
};

export const recipeId = (recipe: { app: string; file: string; find: string }): string =>
  crypto
    .createHash('sha256')
    .update(JSON.stringify([recipe.app, recipe.file, recipe.find]))
    .digest('hex')
    .slice(0, 12);
/** Something only this Mac has: a home folder, a drive path, a loopback alias other than 127.0.0.1, or the user name. */
export const onlyHere = (text: string, user = os.userInfo().username, home = os.homedir()): boolean =>
  [home, `/Users/${user}`, `/home/${user}`].some(place => text.includes(place)) ||
  /(^|[\s"'=(])~\//.test(text) ||
  /\b[A-Z]:\\\\/.test(text) ||
  /\b127\.0\.0\.(?!1\b)\d+\b/.test(text);

const whenOf = (given: string | undefined): When => {
  if (given?.startsWith('calls:')) return { calls: given.slice(6) };
  if (given?.startsWith('env:')) return { env: given.slice(4) };
  return { always: true };
};
/** A recipe is for the operating system it was made on (darwin, linux, win32) unless it was widened to any. */
export const matches = (
  recipe: Pick<Stored, 'os' | 'when'>,
  { env, calls = [], platform = process.platform }: { env?: string; calls?: string[]; platform?: string },
): boolean => {
  const { when } = recipe;
  const here = !recipe.os || recipe.os === 'any' || recipe.os === platform;
  return here && !!(when?.always || (when?.env && when.env === env) || (when?.calls && calls.includes(when.calls)));
};

/** Every recipe for an app: the stack's, then this Mac's, each with how it did here. */
export function recipesFor(stack: RecipeStack | null | undefined, app: string): Recipe[] {
  const mine = readJson<Private>(privateFile(), {});
  const shared = (stack?.apps?.[app]?.localChanges ?? []) as Stored[];
  const own = mine.stacks?.[stack?.source ?? '']?.[app] ?? [];
  const scoped = [
    ...shared.map(recipe => ({ ...recipe, app, scope: 'shared' as const })),
    ...own.map(recipe => ({ ...recipe, app, scope: 'private' as const })),
  ];
  return scoped.map(recipe => {
    const id = recipeId(recipe);
    return { ...recipe, id, here: mine.runs?.[id] ?? null };
  });
}

export function remember({
  registry: stack,
  app,
  edit,
  why,
  whenText,
  forcePrivate,
  anyOs,
}: {
  registry: RecipeStack | null | undefined;
  app: string;
  /** The logged edit, with the clone it was made in. */
  edit: (Pick<EditAction, 'file' | 'before' | 'after'> & { repo?: string | undefined }) | undefined;
  why?: string | undefined;
  whenText?: string | undefined;
  forcePrivate?: boolean;
  anyOs?: boolean;
}): { id: string; scope: Recipe['scope']; error?: undefined } | { error: string } {
  if (!edit)
    return { error: `no logged edit for ${app} to remember (the agent logs each edit in temp/actions.json first)` };
  const inRepo = path.isAbsolute(edit.file) && edit.repo ? path.relative(edit.repo, edit.file) : edit.file;
  const unix = (text: string) => text.replace(/\r\n/g, '\n');
  const recipe: Stored = {
    why: (why ?? '').slice(0, 200) || 'needed to run locally',
    when: whenOf(whenText),
    os: anyOs ? 'any' : process.platform,
    file: inRepo.split(path.sep).join('/'),
    find: unix(edit.before),
    replace: unix(edit.after),
  };
  const id = recipeId({ ...recipe, app });
  const add = (list: Stored[]) => {
    if (!list.some(known => recipeId({ ...known, app }) === id)) list.push(recipe);
  };
  const source = stack?.source;
  if (forcePrivate || onlyHere(JSON.stringify(recipe)) || !source) {
    const mine = readJson<Private>(privateFile(), {});
    add((((mine.stacks ??= {})[source ?? 'none'] ??= {})[app] ??= []));
    writePrivate(mine);
    return { id, scope: 'private' };
  }
  const file = readJson<{ apps?: Record<string, { localChanges?: Stored[] } | undefined> } | null>(source, null);
  const shared = file?.apps?.[app];
  if (!shared) return { error: `${app} is not in ${source}` };
  const before = readJson<unknown>(source, null);
  add((shared.localChanges ??= []));
  const refused = saveStack(source, before, file);
  if (refused) return refused;
  return { id, scope: 'shared' };
}

/**
 * A remembered change only ever edits a file inside the app's clone, whatever the shared stack says: no absolute path,
 * no .., and no symlink that leads out. Returns the full path, or null.
 */
export function insideClone(repo: string, rel: unknown): string | null {
  if (typeof rel !== 'string' || !rel || path.isAbsolute(rel) || rel.split(/[\\/]/).includes('..')) return null;
  let root: string;
  try {
    root = fs.realpathSync(repo);
  } catch {
    return null;
  }
  let full = path.join(root, rel);
  try {
    full = fs.realpathSync(full);
  } catch {
    // Not there yet: its own path is as far as it resolves.
  }
  return full.startsWith(root + path.sep) ? full : null;
}

/** Applies each matching recipe once: the original text must be in the file exactly once, else it is reported, never guessed. */
export function prepare({
  registry: stack,
  apps,
  env,
  calls,
  repoOf,
  logFile,
}: {
  registry: RecipeStack | null | undefined;
  apps: string[];
  env: string;
  calls: Record<string, string[]>;
  repoOf: (app: string) => string | undefined;
  logFile: string;
}): Applied[] {
  const log: Action[] = readActions(logFile);
  const out: Applied[] = [];
  for (const app of apps)
    for (const recipe of recipesFor(stack, app).filter(one => matches(one, { env, calls: calls[app] ?? [] }))) {
      const { id, why } = recipe;
      const say = (state: Applied['state'], detail?: string) =>
        out.push({ app, id, state, why, ...(detail && { detail }) });
      const repo = repoOf(app);
      const file = repo ? insideClone(repo, recipe.file) : undefined;
      if (log.some(action => action.kind === 'edit' && action.recipe === id)) {
        say('already');
        continue;
      }
      if (repo && !file) {
        say('refused', `${recipe.file} is not a file inside ${app}'s clone`);
        continue;
      }
      let body: string;
      try {
        body = fs.readFileSync(file as string, 'utf8');
      } catch {
        say('missing', `${recipe.file} is not in the clone`);
        continue;
      }
      // Kept with \n line endings; a file with Windows endings is matched in its own.
      const eol = body.includes('\r\n') ? '\r\n' : '\n';
      const find = recipe.find.replace(/\n/g, eol);
      const replace = recipe.replace.replace(/\n/g, eol);
      const count = body.split(find).length - 1;
      if (body.includes(replace)) {
        say('already');
        continue;
      }
      if (count !== 1) {
        say('moved', `${recipe.file}: the original text is ${count ? 'there more than once' : 'no longer there'}`);
        continue;
      }
      // Logged before the file changes, so a crash part-way still leaves Stop an entry to undo.
      const entry: EditAction = { kind: 'edit', app, file: file as string, before: find, after: replace, recipe: id };
      updateActions(logFile, list => {
        list.push(entry);
      });
      log.push(entry);
      fs.writeFileSync(
        file as string,
        body.replace(find, () => replace),
      );
      out.push({ app, id, state: 'applied', why, scope: recipe.scope });
    }
  return out;
}

/** After a run: each recipe it applied worked or not on this Mac, and when. */
export function markRuns(logFile: string, ok: boolean): void {
  const ids = readJson<{ recipe?: string }[]>(logFile, []).flatMap(action => (action.recipe ? [action.recipe] : []));
  if (!ids.length) return;
  const mine = readJson<Private>(privateFile(), {});
  const at = new Date().toISOString();
  for (const id of ids) (mine.runs ??= {})[id] = { at, ok };
  writePrivate(mine);
}

const OUTCOME = {
  applied: 'applied',
  already: 'already in place',
  moved: 'NOT applied, the code moved',
  missing: 'NOT applied, file missing',
  refused: 'NOT applied, the file is outside the clone',
};
const REMEMBER =
  'usage: koppler recipes --remember <app> --why "<reason>" [--when always|calls:<app>|env:<env>] [--private]';

export function recipesCommand(command: 'recipes' | 'remember' | 'prepare', args: string[]): void {
  const stack = readStack() ?? fail('no stack loaded (koppler init)');
  const logFile = path.join(TEMP, 'actions.json');
  const ids = args.filter((arg, at) => !arg.startsWith('--') && !args[at - 1]?.startsWith('--'));
  if (command === 'recipes') {
    for (const app of ids.length ? ids : Object.keys(stack.apps))
      for (const recipe of recipesFor(stack, app)) {
        const { here, when } = recipe;
        const did = here
          ? `${here.ok ? 'works on my machine' : 'failed here'}, last run ${here.at.slice(0, 10)}`
          : 'not run here yet';
        const applies = when?.always
          ? 'always'
          : when?.calls
            ? `when it calls local ${when.calls}`
            : `on ${String(when?.env)}`;
        console.log(`${app}  ${recipe.file}  (${recipe.scope}, ${did})\n  ${String(recipe.why)}; ${applies}`);
      }
    return;
  }
  if (command === 'remember') {
    const app = ids[0] ?? fail(REMEMBER);
    const logged = readJson<Action[]>(logFile, []);
    const edit = logged.findLast(
      (action): action is EditAction => action.kind === 'edit' && action.app === app && !action.recipe,
    );
    const remembered = remember({
      registry: stack,
      app,
      edit: edit && { ...edit, repo: readClones()[app]?.path },
      why: flagValue(args, '--why'),
      whenText: flagValue(args, '--when'),
      forcePrivate: args.includes('--private'),
      anyOs: args.includes('--any-os'),
    });
    if (remembered.error !== undefined) fail(remembered.error);
    const where = remembered.scope === 'shared' ? 'in the stack, for the team: commit stack.json' : 'on this Mac only';
    console.log(`Remembered for ${app} (${where}); id ${remembered.id}`);
    return;
  }
  // The board the user sent: its environment and which local apps each app calls.
  const run = runs().findLast(one => one.kind === 'run');
  const env = flagValue(args, '--env') ?? run?.env ?? stack.envs[0] ?? '';
  const edges = run?.edges ?? [];
  const calls = Object.fromEntries(ids.map(app => [app, edges.filter(edge => edge.from === app).map(edge => edge.to)]));
  const clones = readClones();
  // A code change the stack remembers is the stack's own doing: applied only once the user allowed it.
  const allowed = approved(stack.source ?? '', stack);
  const held = allowed ? [] : ids.filter(id => stack.apps[id]?.localChanges?.length);
  if (held.length)
    console.log(
      `${held.join(', ')}: the stack's code changes were not applied; the user has to allow them first, in their own terminal: ${APPROVE}`,
    );
  const own = Object.fromEntries(Object.entries(stack.apps).map(([id, app]) => [id, { ...app, localChanges: [] }]));
  const registry = allowed ? stack : { ...stack, apps: own };
  const results = prepare({ registry, apps: ids, env, calls, repoOf: app => clones[app]?.path, logFile });
  if (!results.length) console.log('No remembered changes for these apps.');
  for (const result of results)
    console.log(
      `${result.app}: ${OUTCOME[result.state]}: ${String(result.why)}${result.detail ? ` (${result.detail})` : ''}`,
    );
}
