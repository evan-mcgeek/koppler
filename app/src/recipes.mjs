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
import { runs } from './runs.mjs';

const configDir = () => process.env.KOPPLER_CONFIG_DIR || path.join(os.homedir(), '.config', 'koppler');
const privateFile = () => path.join(configDir(), 'recipes.json');
const readJson = (f, fallback) => { try { return JSON.parse(fs.readFileSync(f, 'utf8')); } catch { return fallback; } };
const writeJson = (f, o) => { fs.mkdirSync(path.dirname(f), { recursive: true }); fs.writeFileSync(f, JSON.stringify(o, null, 2) + '\n', { mode: 0o600 }); };

export const recipeId = r => crypto.createHash('sha256').update(JSON.stringify([r.app, r.file, r.find])).digest('hex').slice(0, 12);
// Something only this Mac has: a home folder, a drive path, a loopback alias other than 127.0.0.1, or the user name.
export const onlyHere = (text, user = os.userInfo().username, home = os.homedir()) =>
  [home, `/Users/${user}`, `/home/${user}`].some(p => text.includes(p)) || /(^|[\s"'=(])~\//.test(text) || /\b[A-Z]:\\\\/.test(text) || /\b127\.0\.0\.(?!1\b)\d+\b/.test(text);

const when = w => !w || w === 'always' ? { always: true } : w.startsWith('calls:') ? { calls: w.slice(6) } : w.startsWith('env:') ? { env: w.slice(4) } : { always: true };
// A recipe is for the operating system it was made on (darwin, linux, win32) unless it was widened to any.
export const matches = (r, { env, calls = [], platform = process.platform }) => (!r.os || r.os === 'any' || r.os === platform)
  && (r.when?.always || (r.when?.env && r.when.env === env) || (r.when?.calls && calls.includes(r.when.calls)));

// Every recipe for an app: the stack's, then this Mac's, each with how it did here.
export function recipesFor(registry, app) {
  const mine = readJson(privateFile(), {}), runs = mine.runs ?? {};
  const shared = (registry?.apps?.[app]?.localChanges ?? []).map(r => ({ ...r, app, scope: 'shared' }));
  const own = (mine.stacks?.[registry?.source]?.[app] ?? []).map(r => ({ ...r, app, scope: 'private' }));
  return [...shared, ...own].map(r => ({ ...r, id: recipeId({ ...r, app }), here: runs[recipeId({ ...r, app })] ?? null }));
}

export function remember({ registry, app, edit, why, whenText, forcePrivate, anyOs }) {
  if (!edit) return { error: `no logged edit for ${app} to remember (the agent logs each edit in temp/actions.json first)` };
  const file = (path.isAbsolute(edit.file) && edit.repo ? path.relative(edit.repo, edit.file) : edit.file).split(path.sep).join('/');
  const lf = s => String(s).replace(/\r\n/g, '\n');
  const r = { why: String(why ?? '').slice(0, 200) || 'needed to run locally', when: when(whenText), os: anyOs ? 'any' : process.platform, file, find: lf(edit.before), replace: lf(edit.after) };
  const local = forcePrivate || onlyHere(JSON.stringify(r)) || !registry?.source;
  const id = recipeId({ ...r, app });
  if (local) {
    const mine = readJson(privateFile(), {});
    const list = (((mine.stacks ??= {})[registry?.source ?? 'none'] ??= {})[app] ??= []);
    if (!list.some(x => recipeId({ ...x, app }) === id)) list.push(r);
    writeJson(privateFile(), mine);
  } else {
    const stack = readJson(registry.source, null);
    if (!stack?.apps?.[app]) return { error: `${app} is not in ${registry.source}` };
    const list = (stack.apps[app].localChanges ??= []);
    if (!list.some(x => recipeId({ ...x, app }) === id)) list.push(r);
    fs.writeFileSync(registry.source, JSON.stringify(stack, null, 2) + '\n');
  }
  return { id, scope: local ? 'private' : 'shared' };
}

// Applies each matching recipe once: the original text must be in the file exactly once, else it is reported, never guessed.
export function prepare({ registry, apps, env, calls, repoOf, logFile }) {
  const log = readJson(logFile, []), out = [];
  for (const app of apps) for (const r of recipesFor(registry, app).filter(x => matches(x, { env, calls: calls[app] ?? [] }))) {
    const repo = repoOf(app), file = repo && path.join(repo, r.file);
    if (log.some(a => a.recipe === r.id)) { out.push({ app, id: r.id, state: 'already', why: r.why }); continue; }
    let body; try { body = fs.readFileSync(file, 'utf8'); } catch { out.push({ app, id: r.id, state: 'missing', why: r.why, detail: `${r.file} is not in the clone` }); continue; }
    // Kept with \n line endings; a file with Windows endings is matched in its own.
    const eol = body.includes('\r\n') ? '\r\n' : '\n', find = r.find.replace(/\n/g, eol), replace = r.replace.replace(/\n/g, eol);
    const count = body.split(find).length - 1;
    if (body.includes(replace)) { out.push({ app, id: r.id, state: 'already', why: r.why }); continue; }
    if (count !== 1) { out.push({ app, id: r.id, state: 'moved', why: r.why, detail: `${r.file}: the original text is ${count ? 'there more than once' : 'no longer there'}` }); continue; }
    fs.writeFileSync(file, body.replace(find, replace));
    log.push({ kind: 'edit', app, file, before: find, after: replace, recipe: r.id });
    out.push({ app, id: r.id, state: 'applied', why: r.why, scope: r.scope });
  }
  fs.writeFileSync(logFile, JSON.stringify(log, null, 2) + '\n', { mode: 0o600 });
  return out;
}

// After a run: each recipe it applied worked or not on this Mac, and when.
export function markRuns(logFile, ok) {
  const ids = readJson(logFile, []).map(a => a.recipe).filter(Boolean);
  if (!ids.length) return;
  const mine = readJson(privateFile(), {}), at = new Date().toISOString();
  for (const id of ids) (mine.runs ??= {})[id] = { at, ok };
  writeJson(privateFile(), mine);
}

export function recipesCommand(cmd, args, { load, fail, temp }) {
  const registry = load('registry.js', 'REGISTRY') ?? fail('no stack loaded (koppler init)');
  const logFile = path.join(temp, 'actions.json'), flag = n => { const i = args.indexOf(`--${n}`); return i >= 0 ? args[i + 1] : undefined; };
  const ids = args.filter((a, i) => !a.startsWith('--') && !args[i - 1]?.startsWith('--'));
  const status = r => r.here ? `${r.here.ok ? 'works on my machine' : 'failed here'}, last run ${r.here.at.slice(0, 10)}` : 'not run here yet';
  if (cmd === 'recipes') {
    for (const app of ids.length ? ids : Object.keys(registry.apps)) for (const r of recipesFor(registry, app))
      console.log(`${app}  ${r.file}  (${r.scope}, ${status(r)})\n  ${r.why}; ${r.when.always ? 'always' : r.when.calls ? `when it calls local ${r.when.calls}` : `on ${r.when.env}`}`);
    return;
  }
  if (cmd === 'remember') {
    const app = ids[0] ?? fail('usage: koppler recipes --remember <app> --why "<reason>" [--when always|calls:<app>|env:<env>] [--private]');
    const edit = readJson(logFile, []).filter(a => a.kind === 'edit' && a.app === app && !a.recipe).at(-1);
    const r = remember({ registry, app, edit: edit && { ...edit, repo: load('local.js', 'LOCAL')?.apps?.[app]?.path }, why: flag('why'), whenText: flag('when'), forcePrivate: args.includes('--private'), anyOs: args.includes('--any-os') });
    if (r.error) fail(r.error);
    return console.log(`Remembered for ${app} (${r.scope === 'shared' ? 'in the stack, for the team: commit stack.json' : 'on this Mac only'}); id ${r.id}`);
  }
  // prepare
  // The board the user sent: its environment and which local apps each app calls.
  const run = [...runs()].reverse().find(r => r.kind === 'run'), env = flag('env') ?? run?.env ?? registry.envs[0];
  const calls = Object.fromEntries(ids.map(a => [a, (run?.edges ?? []).filter(e => e.from === a).map(e => e.to)]));
  const local = load('local.js', 'LOCAL')?.apps ?? {};
  const res = prepare({ registry, apps: ids, env, calls, repoOf: a => local[a]?.path, logFile });
  if (!res.length) return console.log('No remembered changes for these apps.');
  for (const r of res) console.log(`${r.app}: ${{ applied: 'applied', already: 'already in place', moved: 'NOT applied, the code moved', missing: 'NOT applied, file missing' }[r.state]}: ${r.why}${r.detail ? ` (${r.detail})` : ''}`);
}
