// Finds your local repos (any git host) and the shared stack config, then copies the stack into temp/registry.js and
// each app's clone into temp/local.js, for the canvas and scripts.
// Usage: koppler init [--root <dir>]... [--depth <n>] [--stack <dir>]   first-time scan of every repo, remembered
//        koppler sync [--stack <dir>] [--rescan]                        before each run (also: node sync.mjs)
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { execFile, execFileSync } from 'node:child_process';
import crypto from 'node:crypto';
import { fileURLToPath } from 'node:url';
import kinds from './kinds.js';
import presets from './presets.js';
import { TYPES as SECRET_TYPES } from './secret-check.mjs';
import kp from './plan.js';
const QUEUE_TYPES = kp.QUEUE_TYPES;
import { detectKind } from './investigate.mjs';
import { packageOf, librariesFor } from './libraries.mjs';
import { checkStack as checkLoadedStack } from './checks.mjs';
import { TEMP } from './paths.mjs';
import { loadsCode } from './safe-env.mjs';

const here = path.dirname(fileURLToPath(import.meta.url));

const CONFIG_DIR = process.env.KOPPLER_CONFIG_DIR || path.join(os.homedir(), '.config', 'koppler');
const CONFIG = path.join(CONFIG_DIR, 'config.json');
const INDEX = path.join(CONFIG_DIR, 'repos.json');
const SKIP = new Set(['node_modules', 'Library', 'Applications', 'Pictures', 'Music', 'Movies', '.worktrees', 'bin', 'obj', 'build', 'dist', '.dart_tool', 'Pods', 'vendor', 'target']);
const DEFAULT_ROOTS = ['~/development', '~/dev', '~/src', '~/code', '~/projects', '~/workspace', '~/repos', '~/git', '~/github'];
const DEFAULT_DEPTH = 4;
const expand = p => path.resolve(p.replace(/^~/, os.homedir()));
const tilde = p => p.startsWith(os.homedir()) ? '~' + p.slice(os.homedir().length) : p;
const fail = message => { console.error(`koppler: ${message}`); process.exit(1); };

// One key per remote, `host/path`, for any git host: git@github.com:a/b.git and https://github.com/a/b give the same key.
export function remoteKey(url) {
  url = url?.trim();
  if (!url) return null;
  let host, repoPath;
  const scp = url.match(/^(?:[^@/]+@)?([^:/]+):(?!\/)(.+)$/);
  if (/^file:/i.test(url)) return null;
  if (/^[a-z][a-z0-9+.-]*:\/\//i.test(url)) {
    let u;
    try { u = new URL(url); } catch { return null; }
    // A stray % (not an escape) is kept as written.
    host = u.hostname; try { repoPath = decodeURIComponent(u.pathname); } catch { repoPath = u.pathname; }
  } else if (scp) [, host, repoPath] = scp;
  else return null;
  host = host.toLowerCase();
  repoPath = repoPath.replace(/^\/+|\/+$/g, '').replace(/\.git$/i, '').toLowerCase();
  // Azure DevOps spells the same repo three ways.
  if (host === 'ssh.dev.azure.com') { host = 'dev.azure.com'; repoPath = repoPath.replace(/^v3\//, ''); }
  const vs = host.match(/^([^.]+)\.visualstudio\.com$/);
  if (vs) { host = 'dev.azure.com'; repoPath = `${vs[1]}/${repoPath}`; }
  if (host === 'dev.azure.com') repoPath = repoPath.replace('/_git/', '/');
  return repoPath.includes('/') ? `${host}/${repoPath}` : null;
}

// A stack slug without a host (`owner/repo`) matches that path on any host; with a host it must match exactly.
export function slugMatches(slug, key) {
  if (!slug) return false;
  const s = slug.toLowerCase().replace(/\.git$/, '');
  return s.split('/')[0].includes('.') ? key === s : key.endsWith('/' + s) && key.split('/').length === s.split('/').length + 1;
}

function remotesOf(gitDir) {
  let config;
  try { config = fs.readFileSync(path.join(gitDir, 'config'), 'utf8'); } catch { return []; }
  return [...config.matchAll(/^\s*url\s*=\s*(\S+)/gm)].map(m => remoteKey(m[1])).filter(Boolean);
}

export function findRepos(dir, maxDepth = DEFAULT_DEPTH, depth = 0, found = []) {
  let entries;
  try { entries = fs.readdirSync(dir, { withFileTypes: true }); } catch { return found; }
  // Only real clones (.git directory); worktrees have a .git file and are skipped on purpose.
  if (entries.some(e => e.name === '.git' && e.isDirectory())) {
    const keys = [...new Set(remotesOf(path.join(dir, '.git')))];
    if (keys.length) found.push({ path: dir, keys });
  }
  if (depth < maxDepth)
    for (const e of entries)
      if (e.isDirectory() && !e.name.startsWith('.') && !SKIP.has(e.name)) findRepos(path.join(dir, e.name), maxDepth, depth + 1, found);
  return found;
}

export function findStacks(repos) {
  const stacks = [];
  for (const { path: repo } of repos) {
    if (fs.existsSync(path.join(repo, '.koppler', 'stack.json'))) stacks.push(path.join(repo, '.koppler'));
    let dirs = [];
    try { dirs = fs.readdirSync(path.join(repo, 'stacks'), { withFileTypes: true }); } catch {}
    for (const d of dirs) if (d.isDirectory() && fs.existsSync(path.join(repo, 'stacks', d.name, 'stack.json'))) stacks.push(path.join(repo, 'stacks', d.name));
  }
  return stacks;
}

// Every deployed host each app is known by, from its own deployedUrl and from how other apps call it.
export function hostsByApp(stack) {
  const hosts = {};
  const add = (id, url) => { try { (hosts[id] ||= new Set()).add(new URL(url).hostname.toLowerCase()); } catch {} };
  for (const [id, app] of Object.entries(stack.apps)) {
    add(id, app.deployedUrl);
    for (const env of Object.values(app.envs ?? {})) add(id, env.deployedUrl);
    for (const [dep, call] of Object.entries(app.consumes ?? {})) {
      add(dep, call.deployed);
      for (const env of Object.values(app.envs ?? {})) add(dep, env.consumes?.[dep]?.deployed);
    }
  }
  return hosts;
}

// A host that two apps share (one app's QA address pointing at another) cannot say which app is called, so it is left out.
export function hostOwners(stack) {
  const owners = new Map();
  for (const [id, hosts] of Object.entries(hostsByApp(stack))) for (const h of hosts) owners.set(h, [...(owners.get(h) ?? []), id]);
  return { unique: new Map([...owners].filter(([, ids]) => ids.length === 1).map(([h, [id]]) => [h, id])), shared: [...owners].filter(([, ids]) => ids.length > 1) };
}

// Calls found in the caller's repo (a line naming another app's deployed host) that the stack does not list yet.
export function missingCalls(stack, grepRepo) {
  const { unique } = hostOwners(stack), found = {};
  for (const [caller, app] of Object.entries(stack.apps)) {
    const hosts = [...unique].filter(([, owner]) => owner !== caller).map(([h]) => h);
    if (!hosts.length) continue;
    for (const line of grepRepo(caller, hosts)) {
      const host = hosts.find(h => line.toLowerCase().includes(h));
      const callee = unique.get(host);
      if (!callee || app.consumes?.[callee] || found[caller]?.[callee]) continue;
      (found[caller] ||= {})[callee] = line.slice(0, 200);
    }
  }
  return found;
}

// Tests, docs, lock files and one-off migration tools mention hosts without being the app's own calls.
const NOT_CODE = ['*.lock', 'package-lock.json', '*.md', '**/test/**', '**/tests/**', '**/*Test*/**', '**/docs/**', '**/*Migration*/**'].map(g => `:(exclude,glob)${g.includes('/') ? g : '**/' + g}`);
export function grepClone(repo, hosts) {
  try { return execFileSync('git', ['-C', repo, 'grep', '-n', '-I', '-F', '-i', ...hosts.flatMap(h => ['-e', h]), '--', ...NOT_CODE], { encoding: 'utf8', maxBuffer: 16 * 1024 * 1024 }).split('\n').filter(Boolean); }
  catch { return []; }
}
// Every http(s) address written in a clone's code, as "file:line:url".
export function urlsInClone(repo) {
  try { return execFileSync('git', ['-C', repo, 'grep', '-n', '-I', '-o', '-i', '-E', 'https?://[a-z0-9.-]+', '--', ...NOT_CODE], { encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'], maxBuffer: 16 * 1024 * 1024 }).split('\n').filter(Boolean); }
  catch { return []; }
}

// The shared config is reviewed by people, so reject a malformed one loudly instead of drawing a broken canvas.
const HOST = /^(?=.{1,253}$)[A-Za-z0-9](?:[A-Za-z0-9-]{0,61}[A-Za-z0-9])?(?:\.[A-Za-z0-9](?:[A-Za-z0-9-]{0,61}[A-Za-z0-9])?)*$/;
const NAME = /^[\w.-]{1,128}$/, SETTING = /^[A-Za-z_][\w.:-]{0,127}$/, SLUG = /^[\w.-]+(?:\/[\w.-]+)+$/;
export function validateStack(stack) {
  const errors = [];
  // Names are looked up as a stack's own (`constructor` is no app), and every part has the shape the later steps rely on.
  const isObject = v => !!v && typeof v === 'object' && !Array.isArray(v), has = (o, key) => isObject(o) && Object.hasOwn(o, key);
  if (!isObject(stack)) return ['a stack is an object with envs and apps'];
  if (!Array.isArray(stack.envs) || !stack.envs.length || !stack.envs.every(e => typeof e === 'string' && /^[a-z0-9-]+$/.test(e)) || new Set(stack.envs).size !== stack.envs.length) errors.push('envs: a non-empty list of lowercase names, each once');
  if (!isObject(stack.apps)) errors.push('apps: an object keyed by app id');
  for (const [key, what] of [['kinds', 'kind id'], ['queues', 'queue id'], ['envAliases', 'environment']]) if (stack[key] !== undefined && !isObject(stack[key])) errors.push(`${key}: an object keyed by ${what}`);
  if (stack.presets !== undefined && !Array.isArray(stack.presets)) errors.push('presets: a list');
  if (errors.length) return errors;
  if (stack?.protected !== undefined && !(Array.isArray(stack.protected) && stack.protected.every(e => stack.envs?.includes(e)))) errors.push('protected: a list of environments from envs (the ones that ask before every secret read and get the careful review)');
  for (const [env, names] of Object.entries(stack?.envAliases ?? {})) if (!stack.envs?.includes(env) || !Array.isArray(names) || !names.every(n => typeof n === 'string')) errors.push(`envAliases.${env}: must be one of envs, with a list of names`);
  for (const [id, k] of Object.entries(stack?.kinds ?? {})) {
    if (!/^[a-z0-9-]{1,32}$/.test(id)) errors.push(`kinds.${id}: id must be lowercase letters, digits and dashes`);
    else if (BUILT_IN_KINDS.includes(id)) errors.push(`kinds.${id}: Koppler already has a kind with this id`);
    if (!k || typeof k !== 'object' || typeof k.label !== 'string' || !k.label) errors.push(`kinds.${id}.label: required`);
    if (k?.start !== undefined && typeof k.start !== 'string') errors.push(`kinds.${id}.start: a shell command`);
    if (k?.detect !== undefined && ![].concat(k.detect).every(f => typeof f === 'string')) errors.push(`kinds.${id}.detect: file names`);
  }
  // What gets approved is what runs: a check list or command too long to show in full is refused, never cut short.
  if (stack?.checks !== undefined && (!Array.isArray(stack.checks) || stack.checks.length > 50)) errors.push('checks: a list of at most 50 checks');
  for (const [n, c] of (Array.isArray(stack?.checks) ? stack.checks : []).entries()) if (typeof c?.name !== 'string' || !c.name || c.name.length > 80 || typeof c?.run !== 'string' || !c.run || c.run.length > 2000) errors.push(`checks[${n}]: needs a name (up to 80 characters) and a run command (up to 2000)`);
  for (const [id, q] of Object.entries(stack?.queues ?? {})) {
    for (const [where, name] of [['queue', q?.queue], ...Object.entries(q?.envs ?? {}).map(([env, e]) => [`envs.${env}.queue`, e?.queue])]) if (name !== undefined && !(typeof name === 'string' && NAME.test(name))) errors.push(`queues.${id}.${where}: a queue or topic name`);
    if (!/^[a-z0-9-]{1,64}$/.test(id)) errors.push(`queues.${id}: id must be lowercase letters, digits and dashes`);
    if (typeof q?.name !== 'string' || !q.name) errors.push(`queues.${id}.name: required`);
    if (!QUEUE_TYPES.includes(q?.type)) errors.push(`queues.${id}.type: one of ${QUEUE_TYPES.join(', ')}`);
  }
  for (const [id, app] of Object.entries(stack?.apps ?? {})) {
    if (!/^[a-z0-9-]+$/.test(id)) errors.push(`apps.${id}: id must be lowercase letters, digits and dashes`);
    const shapes = [...['consumes', 'publishes', 'reads', 'envs'].map(key => [key, isObject, 'an object']), ...['prereqs', 'secrets'].map(key => [key, Array.isArray, 'a list'])];
    const wrong = !isObject(app) ? [`apps.${id}: an object`] : [
      ...shapes.filter(([key, ok]) => app[key] !== undefined && !ok(app[key])).map(([key, , what]) => `apps.${id}.${key}: ${what}`),
      ...(isObject(app.consumes) ? Object.entries(app.consumes).filter(([, call]) => !isObject(call)).map(([dep]) => `apps.${id}.consumes.${dep}: an object (how the call is made; {} when not known yet)`) : []),
      ...(isObject(app.envs) ? Object.entries(app.envs).flatMap(([env, e]) => [
        ...(stack.envs.includes(env) ? [] : [`apps.${id}.envs.${env}: not one of envs (${stack.envs.join(', ')})`]),
        ...(isObject(e) ? ['prereqs', 'secrets'].filter(key => e[key] !== undefined && !Array.isArray(e[key])).map(key => `apps.${id}.envs.${env}.${key}: a list`) : [`apps.${id}.envs.${env}: an object`]),
      ]) : []),
    ];
    // An app with a part of the wrong shape is not looked into further.
    if (wrong.length) { errors.push(...wrong); continue; }
    if (typeof app?.kind === 'string' && app.kind && !BUILT_IN_KINDS.includes(app.kind) && !has(stack.kinds, app.kind)) errors.push(`apps.${id}.kind: "${app.kind}" is not a kind Koppler knows; define it under "kinds", or use "other" with a "start" command`);
    // An outside system (Salesforce, a SaaS) may have no repo of its own.
    for (const key of app?.outside ? ['name', 'kind'] : ['name', 'kind', 'slug']) if (typeof app?.[key] !== 'string' || !app[key]) errors.push(`apps.${id}.${key}: required`);
    for (const dep of Object.keys(app?.consumes ?? {})) if (!has(stack.apps, dep)) errors.push(`apps.${id}.consumes.${dep}: no such app`);
    for (const key of ['publishes', 'reads']) for (const q of Object.keys(app?.[key] ?? {})) if (!has(stack.queues, q)) errors.push(`apps.${id}.${key}.${q}: no such queue under "queues"`);
    // A remembered change edits one file inside the app's own clone: a path that could leave it is refused.
    for (const [n, c] of (Array.isArray(app?.localChanges) ? app.localChanges : app?.localChanges === undefined ? [] : [null]).entries())
      if (!c || typeof c.file !== 'string' || !c.file || typeof c.find !== 'string' || !c.find || typeof c.replace !== 'string' || path.isAbsolute(c.file) || c.file.split(/[\\/]/).includes('..'))
        errors.push(`apps.${id}.localChanges[${n}]: needs file (a path inside the app's clone, no .. or leading /), find and replace`);
    for (const [where, start] of [['start', app?.start], ...Object.entries(app?.envs ?? {}).map(([env, e]) => [`envs.${env}.start`, e?.start])]) if (start !== undefined && (typeof start !== 'string' || !start || start.length > 2000)) errors.push(`apps.${id}.${where}: a shell command (up to 2000 characters)`);
    // Values that end up in commands (tunnels, sign-ins, hosts entries, secret steps, clone commands) must look like
    // what they are, so a shared stack.json cannot smuggle shell syntax into them.
    if (app?.slug !== undefined && !(typeof app.slug === 'string' && SLUG.test(app.slug))) errors.push(`apps.${id}.slug: owner/repo, or host/path/to/repo`);
    for (const [where, list] of [['prereqs', app?.prereqs], ...Object.entries(app?.envs ?? {}).map(([env, e]) => [`envs.${env}.prereqs`, e?.prereqs])])
      for (const [n, p] of (Array.isArray(list) ? list : []).entries()) {
        // A tunnel's port is a number: it reaches the page, shell commands and the port probe.
        if (p?.port !== undefined && !(Number.isInteger(p.port) && p.port > 0 && p.port < 65536)) errors.push(`apps.${id}.${where}[${n}].port: a port number from 1 to 65535`);
        for (const key of ['tunnel', 'connectsAs', 'hosts']) if (p?.[key] !== undefined && !(typeof p[key] === 'string' && HOST.test(p[key]))) errors.push(`apps.${id}.${where}[${n}].${key}: a host name`);
        if (p?.sso !== undefined && !(typeof p.sso === 'string' && NAME.test(p.sso))) errors.push(`apps.${id}.${where}[${n}].sso: an AWS profile name`);
        if (p?.env !== undefined && !(typeof p.env === 'string' && SETTING.test(p.env))) errors.push(`apps.${id}.${where}[${n}].env: a setting name`);
      }
    for (const [where, list] of [['secrets', app?.secrets], ...Object.entries(app?.envs ?? {}).map(([env, e]) => [`envs.${env}.secrets`, e?.secrets])])
      for (const [n, sec] of (Array.isArray(list) ? list : []).entries()) if (sec?.env !== undefined && !(typeof sec.env === 'string' && SETTING.test(sec.env))) errors.push(`apps.${id}.${where}[${n}].env: a setting name`);
    // A secret or a cable's setting named like a variable that makes a runtime load code would run the stack author's code in the app.
    const settings = [...[app?.secrets, ...Object.values(app?.envs ?? {}).map(e => e?.secrets)].flatMap(l => Array.isArray(l) ? l.map(x => x?.env) : []), ...Object.values(app?.consumes ?? {}).flatMap(c => [].concat(c?.env ?? []))];
    for (const name of settings) if (typeof name === 'string' && (loadsCode(name) || name === 'PATH')) errors.push(`apps.${id}: "${name}" cannot be a secret or a cable setting; it changes what code the app runs`);
    for (const [where, list] of [['secrets', app?.secrets], ...Object.entries(app?.envs ?? {}).map(([env, e]) => [`envs.${env}.secrets`, e?.secrets])])
      for (const s of list ?? []) if (s?.type !== undefined && !SECRET_TYPES.includes(s.type)) errors.push(`apps.${id}.${where}: type "${s.type}" is not one Koppler tests (${SECRET_TYPES.join(', ')})`);
  }
  for (const [i, p] of (stack?.presets ?? []).entries()) {
    if (!isObject(p)) { errors.push(`presets[${i}]: an object`); continue; }
    if (p.nodes !== undefined && !isObject(p.nodes)) { errors.push(`presets[${i}].nodes: an object keyed by app id`); continue; }
    if (p.edges !== undefined && !Array.isArray(p.edges)) { errors.push(`presets[${i}].edges: a list of { from, to }`); continue; }
    if (typeof p?.name !== 'string' || !p.name) errors.push(`presets[${i}].name: required`);
    if (!Number.isInteger(p?.version)) errors.push(`presets[${i}].version: required (the current preset format is ${presets.VERSION})`);
    else if (p.version > presets.VERSION) errors.push(`presets[${i}].version: ${p.version} is newer than this Koppler reads (${presets.VERSION}); update Koppler`);
    for (const [id, n] of Object.entries(p.nodes ?? {})) {
      if (!has(stack.apps, id)) errors.push(`presets[${i}].nodes.${id}: no such app`);
      if (!isObject(n)) errors.push(`presets[${i}].nodes.${id}: an object ({} for the defaults)`);
    }
    for (const [n, e] of (p.edges ?? []).entries()) {
      if (typeof e?.from !== 'string' || typeof e?.to !== 'string') errors.push(`presets[${i}].edges[${n}]: needs from and to`);
      else if (!has(p.nodes, e.from) || !has(p.nodes, e.to)) errors.push(`presets[${i}].edges: ${e.from} -> ${e.to} needs both apps in the preset`);
    }
  }
  return errors;
}

const readJson = file => { try { return JSON.parse(fs.readFileSync(file, 'utf8')); } catch { return null; } };
const writeJson = (file, value) => { fs.mkdirSync(path.dirname(file), { recursive: true, mode: 0o700 }); fs.writeFileSync(file, JSON.stringify(value, null, 2) + '\n'); };
const git = (cwd, ...args) => execFileSync('git', args, { cwd, encoding: 'utf8' }).trim();
const MAX_BRANCHES = 300;

// Local and remote-tracking branches, most recently committed first, without remote prefixes or duplicates.
export function branchList(refs) {
  const seen = new Set();
  for (const ref of refs.split('\n').map(r => r.trim()).filter(Boolean)) {
    const name = ref.replace(/^refs\/heads\//, '').replace(/^refs\/remotes\/[^/]+\//, '');
    if (name && name !== 'HEAD') seen.add(name);
  }
  return [...seen].slice(0, MAX_BRANCHES);
}
const branchesOf = repo => { try { return branchList(git(repo, 'for-each-ref', '--sort=-committerdate', '--format=%(refname)', 'refs/heads', 'refs/remotes')); } catch { return []; } };

function parseFlags(args) {
  const flags = { roots: [] };
  for (let i = 0; i < args.length; i++) {
    const a = args[i];
    if (a === '--root') flags.roots.push(expand(args[++i] ?? fail('--root needs a folder')));
    else if (a === '--stack') flags.stack = expand(args[++i] ?? fail('--stack needs a folder'));
    else if (a === '--depth') flags.depth = Number(args[++i]);
    else if (a === '--rescan') flags.rescan = true;
    else fail(`unknown option ${a}`);
  }
  if (flags.depth !== undefined && !(flags.depth >= 1 && flags.depth <= 8)) fail('--depth must be 1 to 8');
  return flags;
}

function loadConfig() {
  const config = readJson(CONFIG) ?? {};
  if (config.root && !config.roots) config.roots = [config.root];
  delete config.root;
  return config;
}

function scan(roots, depth) {
  const started = Date.now();
  const repos = roots.flatMap(r => findRepos(r, depth));
  const index = { at: new Date().toISOString(), roots, depth, repos };
  writeJson(INDEX, index);
  const hosts = {};
  for (const r of repos) for (const h of new Set(r.keys.map(k => k.split('/')[0]))) hosts[h] = (hosts[h] ?? 0) + 1;
  console.log(`REPOS ${repos.length} in ${roots.map(tilde).join(', ')} (${Object.entries(hosts).sort((a, b) => b[1] - a[1]).map(([h, n]) => `${h} ${n}`).join(', ') || 'no remotes'}) in ${((Date.now() - started) / 1000).toFixed(1)}s`);
  return index;
}

// Clones that could join the stack, for the picker on the canvas: where each is, what kind it looks like, and whether it is in already.
const slugOfKey = key => key.startsWith('github.com/') ? key.slice('github.com/'.length) : key;
const WORDS = { api: 'API', ui: 'UI', sdk: 'SDK', db: 'DB', cdr: 'CDR', id: 'ID' };
export const nameFromRepo = repo => repo.split(/[-_.]+/).filter(Boolean).map(w => WORDS[w.toLowerCase()] ?? w[0].toUpperCase() + w.slice(1)).join(' ');
export function candidateRepos(index, stack, stackDir) {
  kinds.register(stack.kinds);
  const seen = new Set();
  return index.repos.filter(r => fs.existsSync(r.path) && !path.resolve(stackDir ?? '/nowhere').startsWith(path.resolve(r.path) + path.sep)).flatMap(r => {
    const slug = slugOfKey(r.keys[0]);
    if (seen.has(slug)) return [];
    seen.add(slug);
    const repo = slug.split('/').pop(), inStack = Object.entries(stack.apps ?? {}).find(([, app]) => r.keys.some(k => slugMatches(app.slug, k)))?.[0] ?? null;
    return [{ slug, name: nameFromRepo(repo), kind: detectKind(r.path), path: tilde(r.path), folder: tilde(path.dirname(r.path)), ...(inStack && { inStack }) }];
  }).sort((a, b) => a.folder.localeCompare(b.folder) || a.name.localeCompare(b.name));
}
const BUILT_IN_KINDS = Object.keys(kinds.KINDS);
const NOT_SET_UP = 'Run facts not collected yet: read the repo (launchSettings/README/infra) and fill run, url, prereqs before using.';
// Adds picked clones to stack.json as apps that are not set up yet. Only clones from the index can be added.
export function addApps(picks, { config = loadConfig(), index = readJson(INDEX) } = {}) {
  if (!config.stack || !index) return { error: 'No stack is set up yet: koppler init' };
  const source = path.join(config.stack, 'stack.json'), stack = readJson(source);
  if (!stack) return { error: `cannot read ${source}` };
  const known = new Map(candidateRepos(index, stack, config.stack).map(c => [c.slug, c])), added = [];
  for (const pick of (Array.isArray(picks) ? picks : []).slice(0, 200)) {
    const c = known.get(pick?.slug);
    if (!c || c.inStack) continue;
    const kind = Object.hasOwn(kinds.KINDS, pick.kind) ? pick.kind : c.kind;
    if (!kind) return { error: `Say what kind of app ${c.slug} is.` };
    const base = c.slug.split('/').pop().toLowerCase().replace(/[^a-z0-9-]+/g, '-').replace(/^-+|-+$/g, '') || 'app';
    let id = base; for (let n = 2; stack.apps[id]; n++) id = `${base}-${n}`;
    stack.apps[id] = { name: (typeof pick.name === 'string' && pick.name.trim() ? pick.name.trim() : c.name).slice(0, 80), kind, slug: c.slug, pending: NOT_SET_UP };
    c.inStack = id; added.push(id);
  }
  if (added.length) writeJson(source, stack);
  return { added };
}

// Takes an app out of the stack. Other apps' calls to it go too, since a call to a missing app makes the stack invalid.
// The clone stays where it is; boards that list the app skip it when they open.
export function removeApp(id, { config = loadConfig() } = {}) {
  if (!config.stack) return { error: 'No stack is set up yet: koppler init' };
  const source = path.join(config.stack, 'stack.json'), stack = readJson(source);
  if (!stack) return { error: `cannot read ${source}` };
  if (!stack.apps?.[id]) return { error: `${id} is not in the stack` };
  const name = stack.apps[id].name ?? id;
  delete stack.apps[id];
  for (const app of Object.values(stack.apps)) if (app.consumes?.[id]) delete app.consumes[id];
  writeJson(source, stack);
  return { removed: id, name };
}

// Each stack keeps its own board, history, live state, action log and notes; switching puts them away and brings the other's back.
const PER_STACK = ['state.js', 'history.jsonl', 'live.json', 'actions.json', 'status.json', 'NOTES.md', 'stack.suggestions.json', 'stack.deployed.json'];
export const stackKey = dir => crypto.createHash('sha1').update(path.resolve(dir)).digest('hex').slice(0, 12);
export function setStack(config, dir, save = c => writeJson(CONFIG, c)) {
  const from = config.stack;
  if (from && path.resolve(from) === path.resolve(dir)) return;
  const shelf = d => path.join(TEMP, 'stacks', stackKey(d));
  if (from) { fs.mkdirSync(shelf(from), { recursive: true }); for (const f of PER_STACK) if (fs.existsSync(path.join(TEMP, f))) fs.renameSync(path.join(TEMP, f), path.join(shelf(from), f)); }
  // With no stack in use before, what lies there is put aside too, never deleted: it may be a run's action log.
  else if (PER_STACK.some(f => fs.existsSync(path.join(TEMP, f)))) { const aside = path.join(TEMP, 'stacks', `unassigned-${Date.now()}`); fs.mkdirSync(aside, { recursive: true }); for (const f of PER_STACK) if (fs.existsSync(path.join(TEMP, f))) fs.renameSync(path.join(TEMP, f), path.join(aside, f)); }
  for (const f of PER_STACK) if (fs.existsSync(path.join(shelf(dir), f))) fs.renameSync(path.join(shelf(dir), f), path.join(TEMP, f));
  config.stack = dir;
  save(config);
}
export const currentStack = () => loadConfig().stack ?? null;
let stacksCache = { at: 0, list: [] };
// The stacks on this Mac for the switcher, looked up again at most every 10 seconds.
export function stacksHere() {
  if (Date.now() - stacksCache.at > 10000) stacksCache = { at: Date.now(), list: knownStacks(readJson(INDEX)).map(({ dir, path: p, name, apps, envs, shared, linked }) => ({ dir, path: p, name, apps, envs, shared, ...(linked && { linked }) })) };
  return stacksCache.list;
}
export function forgetStacks() { stacksCache.at = 0; }

// Stacks the user created here live with their private config until they move one to a shared repo.
const PRIVATE_STACKS = path.join(CONFIG_DIR, 'stacks');
const privateStacks = () => { try { return fs.readdirSync(PRIVATE_STACKS, { withFileTypes: true }).filter(d => d.isDirectory() && fs.existsSync(path.join(PRIVATE_STACKS, d.name, 'stack.json'))).map(d => path.join(PRIVATE_STACKS, d.name)); } catch { return []; } };
// A new, empty stack: a name and its deployed environments (first one is the default). It becomes the stack in use.
export function createStack(input, { config = loadConfig(), dir = PRIVATE_STACKS, save = c => writeJson(CONFIG, c) } = {}) {
  const name = typeof input?.name === 'string' ? input.name.trim().slice(0, 60) : '';
  if (!name) return { error: 'Give the stack a name.' };
  const envs = [...new Set((Array.isArray(input?.envs) ? input.envs : String(input?.envs ?? '').split(/[\s,]+/)).map(e => String(e).trim().toLowerCase()).filter(Boolean))];
  if (!envs.length) return { error: 'Name at least one environment, e.g. qa.' };
  if (envs.length > 8 || !envs.every(e => /^[a-z0-9-]{1,16}$/.test(e))) return { error: 'Environment names are short and use lowercase letters, digits and dashes, e.g. qa, prod.' };
  const folder = path.join(dir, name.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '') || 'stack');
  if (fs.existsSync(path.join(folder, 'stack.json'))) return { error: `You already have a stack called ${name}.` };
  writeJson(path.join(folder, 'stack.json'), { name, envs, apps: {} });
  setStack(config, folder, save);
  return { stack: folder };
}
// Every stack on this Mac: in a cloned repo (shared) or in the private config, with enough to tell them apart.
export function knownStacks(index) {
  return [...findStacks(index?.repos ?? []).map(dir => [dir, true]), ...privateStacks().map(dir => [dir, false])].map(([dir, shared]) => {
    const stack = readJson(path.join(dir, 'stack.json'));
    const linked = readJson(path.join(dir, '.source.json'))?.url;
    return stack && !validateStack(stack).length ? { dir, path: linked ?? tilde(dir), name: stack.name ?? path.basename(dir), apps: Object.keys(stack.apps).length, envs: stack.envs, shared: shared || !!linked, ...(linked && { linked }) } : null;
  }).filter(Boolean);
}
// Switches to one of those stacks; any other folder is refused.
export function useStack(dir, { config = loadConfig(), index = readJson(INDEX), save = c => writeJson(CONFIG, c) } = {}) {
  const found = knownStacks(index).find(s => s.dir === dir);
  if (!found) return { error: 'That is not a stack Koppler found on this Mac. Clone its repo, then run koppler init again.' };
  setStack(config, found.dir, save);
  return { stack: found.dir };
}
// With no stack yet, the canvas still opens: it asks for a name and environments, then for the apps.
function writeSetup(index) {
  fs.mkdirSync(TEMP, { recursive: true });
  fs.writeFileSync(path.join(TEMP, 'registry.js'), `window.REGISTRY = ${JSON.stringify({ name: '', envs: ['dev'], apps: {}, setup: true, stacks: knownStacks(index).map(({ dir, path, name, apps, envs, shared, linked }) => ({ dir, path, name, apps, envs, shared, ...(linked && { linked }) })) }, null, 2)};\n`);
  fs.writeFileSync(path.join(TEMP, 'local.js'), `window.LOCAL = ${JSON.stringify({ roots: index.roots, at: new Date().toISOString(), apps: {} }, null, 2)};\n`);
  fs.writeFileSync(path.join(TEMP, 'repos.js'), `window.REPOS = ${JSON.stringify({ roots: index.roots.map(tilde), stack: null, repos: candidateRepos(index, { apps: {} }, null) }, null, 2)};\n`);
}

// Copies the stack and resolves each app to a clone from the index; branch and changes are read fresh every time.
function syncStack(config, index) {
  const source = path.join(config.stack, 'stack.json');
  const stack = readJson(source) ?? fail(`cannot read ${source}`);
  const errors = validateStack(stack);
  if (errors.length) fail(`${source} is invalid:\n  ${errors.join('\n  ')}`);
  fs.mkdirSync(TEMP, { recursive: true });
  fs.writeFileSync(path.join(TEMP, 'registry.js'), `// Copied from ${source} by koppler sync. Edit that file, not this one.\nwindow.REGISTRY = ${JSON.stringify({ ...stack, source }, null, 2)};\n`);
  console.log(`STACK ${stack.name ?? tilde(config.stack)}: ${Object.keys(stack.apps).length} apps from ${tilde(source)}`);

  const local = {};
  // Every clone that publishes a package (Dart or npm), so an app can use the local copy of a library it depends on.
  const packages = index.repos.filter(r => fs.existsSync(r.path)).map(r => ({ path: r.path, ...packageOf(r.path) })).filter(c => c.name);
  for (const [id, app] of Object.entries(stack.apps)) {
    // An outside system has nothing to clone.
    if (app.outside) { local[id] = null; continue; }
    const paths = index.repos.filter(r => fs.existsSync(r.path) && r.keys.some(k => slugMatches(app.slug, k))).map(r => r.path);
    if (!paths.length) {
      local[id] = null;
      const host = app.slug.split('/')[0].includes('.') ? '' : 'github.com/';
      console.log(`MISSING ${id}: git clone https://${host}${app.slug}.git (then koppler sync --rescan)`);
      continue;
    }
    const p = paths.sort((a, b) => a.length - b.length)[0];
    const dirty = git(p, 'status', '--porcelain').split('\n').filter(Boolean).length;
    const libraries = librariesFor(p, packages);
    local[id] = { path: p, branch: git(p, 'branch', '--show-current') || null, dirty, branches: branchesOf(p), ...(libraries.length && { libraries }) };
    console.log(`OK ${id}: ${tilde(p)} [${local[id].branch ?? 'detached'}]${dirty ? ` dirty=${dirty}` : ''}${paths.length > 1 ? ` (also: ${paths.slice(1).map(tilde).join(', ')})` : ''}`);
  }
  fs.writeFileSync(path.join(TEMP, 'repos.js'), `window.REPOS = ${JSON.stringify({ roots: index.roots.map(tilde), stack: tilde(config.stack), repos: candidateRepos(index, stack, config.stack) }, null, 2)};\n`);
  fs.writeFileSync(path.join(TEMP, 'local.js'), `window.LOCAL = ${JSON.stringify({ roots: index.roots, at: new Date().toISOString(), apps: local }, null, 2)};\n`);

  // An empty `consumes` means nobody has mapped that app yet, not that it calls nothing: look in every clone.
  const found = missingCalls(stack, (id, hosts) => local[id] ? grepClone(local[id].path, hosts) : []);
  for (const [caller, calls] of Object.entries(found))
    for (const [callee, where] of Object.entries(calls)) console.log(`FOUND ${caller} -> ${callee}, not in stack.json: ${where}`);
  const known = hostsByApp(stack), { shared } = hostOwners(stack);
  for (const id of Object.keys(stack.apps).filter(id => !stack.apps[id].outside && !known[id]?.size && kinds.of(stack.apps[id]).serves !== false)) console.log(`UNKNOWN ${id}: no deployed address in stack.json, so calls to it cannot be found`);
  for (const [host, ids] of shared) console.log(`SHARED ${host} is used by ${ids.join(' and ')}, so calls to it are not attributed`);
  fs.writeFileSync(path.join(TEMP, 'registry.js'), `// Copied from ${source} by koppler sync. Edit that file, not this one.\nwindow.REGISTRY = ${JSON.stringify({ ...stack, source, found }, null, 2)};\n`);
}

// What to do with a clone after fetching: fast-forward only a clean branch that is simply behind its upstream.
export function updateAction({ upstream, dirty, ahead, behind }) {
  if (!upstream) return 'no-upstream';
  if (!behind) return 'current';
  if (ahead) return 'diverged';
  return dirty ? 'dirty' : 'fast-forward';
}

// Fetches every clone of the stack (all at once) and fast-forwards the checked-out branch where that loses nothing.
// Never commits, stashes, discards or switches branches; uncommitted or diverged work is only reported.
export async function updateClones() {
  const file = path.join(TEMP, 'local.js');
  const local = fs.existsSync(file) ? JSON.parse(fs.readFileSync(file, 'utf8').replace(/^window\.LOCAL = /, '').replace(/;\s*$/, '')) : null;
  const apps = Object.entries(local?.apps ?? {}).filter(([, a]) => a?.path);
  if (!apps.length) return;
  // No password prompts from a background fetch; a slow remote gives up after a minute.
  const run = (cwd, ...args) => new Promise(resolve => execFile('git', args, { cwd, encoding: 'utf8', timeout: 60000, env: { ...process.env, GIT_TERMINAL_PROMPT: '0' } }, (err, out, errOut) => resolve({ ok: !err, out: (out ?? '').trim(), err: (errOut || err?.message || '').trim().split('\n').pop() })));
  console.log(`FETCH ${apps.length} clones`);
  await Promise.all(apps.map(async ([id, a]) => {
    const fetched = await run(a.path, 'fetch', '--prune', '--quiet');
    if (!fetched.ok) return console.log(`NOFETCH ${id}: ${fetched.err || 'git fetch failed'} (working from what is already on this Mac)`);
    const upstream = (await run(a.path, 'rev-parse', '--abbrev-ref', '@{u}')).out || null;
    const counts = upstream ? (await run(a.path, 'rev-list', '--left-right', '--count', 'HEAD...@{u}')).out.split(/\s+/).map(Number) : [0, 0];
    const dirty = (await run(a.path, 'status', '--porcelain')).out.split('\n').filter(Boolean).length;
    const action = updateAction({ upstream, dirty, ahead: counts[0], behind: counts[1] });
    if (action === 'fast-forward') {
      const merged = await run(a.path, 'merge', '--ff-only', '--quiet', '@{u}');
      console.log(merged.ok ? `UPDATED ${id}: ${a.branch} +${counts[1]} from ${upstream}` : `BEHIND ${id}: ${a.branch} is ${counts[1]} behind ${upstream}, fast-forward failed: ${merged.err}`);
    }
    else if (action === 'dirty') console.log(`BEHIND ${id}: ${a.branch} is ${counts[1]} behind ${upstream}; not updated because of uncommitted changes`);
    else if (action === 'diverged') console.log(`BEHIND ${id}: ${a.branch} is ${counts[1]} behind and ${counts[0]} ahead of ${upstream}; not updated (diverged)`);
    a.branches = branchesOf(a.path); a.dirty = dirty;
  }));
  fs.writeFileSync(file, `window.LOCAL = ${JSON.stringify({ ...local, at: new Date().toISOString() }, null, 2)};\n`);
}

const checkStack = dir => { if (!fs.existsSync(path.join(dir, 'stack.json'))) fail(`no stack.json in ${tilde(dir)}`); };

export function init(args) {
  const flags = parseFlags(args);
  if (flags.stack) checkStack(flags.stack);
  const config = loadConfig();
  const roots = flags.roots.length ? flags.roots : config.roots?.length ? config.roots : DEFAULT_ROOTS.map(expand).filter(d => fs.existsSync(d));
  if (!roots.length) fail('no folder to scan: koppler init --root <folder with your repos>');
  const depth = flags.depth ?? config.depth ?? DEFAULT_DEPTH;
  Object.assign(config, { roots, depth });
  const index = scan(roots, depth);

  const stacks = [...findStacks(index.repos), ...privateStacks()];
  for (const s of stacks) console.log(`FOUND stack ${tilde(s)}`);
  if (flags.stack) setStack(config, flags.stack, () => {});
  else if (!config.stack && stacks.length === 1) setStack(config, stacks[0], () => {});
  writeJson(CONFIG, config);

  if (!config.stack) {
    console.log(stacks.length ? 'Several stacks found. Pick one on the canvas (koppler init --pick), or: koppler init --stack <one of the folders above>' : 'No stack yet. Create one on the canvas (koppler init --pick), or point at an existing one: koppler init --stack <folder with stack.json>');
    writeSetup(index);
    return;
  }
  checkStack(config.stack);
  console.log(`USING stack ${tilde(config.stack)} (change with --stack)`);
  syncStack(config, index);
}

export function sync(args) {
  const flags = parseFlags(args);
  const config = loadConfig();
  if (flags.stack) { checkStack(flags.stack); setStack(config, flags.stack, () => {}); }
  if (flags.roots.length) config.roots = flags.roots;
  if (!config.stack) fail('no stack set yet: koppler init');
  let index = readJson(INDEX);
  if (!index || flags.rescan || flags.roots.length) {
    if (!config.roots?.length) fail('no repos scanned yet: koppler init');
    index = scan(config.roots, config.depth ?? DEFAULT_DEPTH);
  }
  writeJson(CONFIG, config);
  syncStack(config, index);
  // A stack says what it needs when it loads: missing programs, and its own checks once they were approved.
  console.log(''); checkLoadedStack();
}

// koppler use: every stack on this Mac. koppler use <name or folder>: switch to one (it must not have anything running).
export function stacksCommand(args = []) {
  const here = currentStack(), list = knownStacks(readJson(INDEX));
  if (args.includes('--json')) return console.log(JSON.stringify(list.map(s => ({ name: s.name, inUse: s.dir === here, path: s.path, apps: s.apps, envs: s.envs, shared: s.shared, linked: !!s.linked })), null, 2));
  if (!list.length) return console.log('No stack found on this Mac. Create one: koppler init --new "<name>" --envs qa,prod');
  for (const s of list) console.log(`${s.dir === here ? '*' : ' '} ${s.name}  (${s.linked ? 'linked from GitHub' : s.shared ? 'shared' : 'private'}, ${s.apps} apps, ${s.envs.join('/')})  ${s.path}`);
}
export function useCommand(args) {
  const want = args.join(' ').trim(), list = knownStacks(readJson(INDEX));
  if (!want) fail('usage: koppler use <stack name or folder>');
  const matches = list.filter(s => s.dir === path.resolve(expand(want)) || s.name.toLowerCase() === want.toLowerCase());
  if (matches.length !== 1) fail(matches.length ? `several stacks are called ${want}; use its folder: koppler use` : `no stack called ${want}; see: koppler use`);
  const result = useStack(matches[0].dir);
  if (result.error) fail(result.error);
  console.log(`USING ${matches[0].name} (${matches[0].path})`);
  sync([]);
}

if (process.argv[1] && fs.realpathSync(process.argv[1]) === fileURLToPath(import.meta.url)) sync(process.argv.slice(2));
