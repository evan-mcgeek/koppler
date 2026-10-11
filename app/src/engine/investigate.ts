// Goes through every stack app's clone and reports the ports it listens on locally, its calls, port conflicts and gaps
// against stack.json. Suggestions go to temp/stack.suggestions.json; the shared stack is never changed.
// Usage: koppler discover
import fs from 'node:fs';
import path from 'node:path';
import { fail, table } from '../cli/output.ts';
import { frameworkOf, type PackageJson } from '../core/frameworks.ts';
import { defaultPort, detect, of as kindOf, register, type RepoView } from '../core/kinds.ts';
import { describePlan, planTunnels } from '../core/ports.ts';
import { readClones, readStack } from '../data.ts';
import { TEMP } from '../paths.ts';
import { hostsByApp } from './sync.ts';

/** A port an app listens on locally, and where in its clone that is said. */
export interface FoundPort {
  port: number;
  scheme?: string;
  where: string;
}
/** What the report knows about one app. */
interface Investigated {
  id: string;
  ports: Pick<FoundPort, 'port'>[];
  tunnels: { tunnel?: string | undefined; port?: number | undefined }[];
  stackPort?: number | null;
}

const SKIP = new Set([
  'node_modules',
  '.git',
  'bin',
  'obj',
  'build',
  'dist',
  '.dart_tool',
  'Pods',
  'coverage',
  '.next',
  'vendor',
  'target',
]);

const read = (file: string) => {
  try {
    return fs.readFileSync(file, 'utf8');
  } catch {
    return null;
  }
};

/** Files up to a few levels deep whose name matches, skipping build output and dependencies. */
export function findFiles(
  dir: string,
  test: (name: string, file: string) => boolean,
  depth = 5,
  found: string[] = [],
): string[] {
  let entries: fs.Dirent[];
  try {
    entries = fs.readdirSync(dir, { withFileTypes: true });
  } catch {
    return found;
  }
  for (const entry of entries) {
    const file = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      if (depth > 0 && !SKIP.has(entry.name) && !entry.name.startsWith('.')) findFiles(file, test, depth - 1, found);
    } else if (test(entry.name, file)) found.push(file);
  }
  return found;
}

const LISTENS = String.raw`(?:localhost|127\.0\.0\.1|0\.0\.0\.0|\*|\+):(\d{2,5})`;
export const urlsIn = (text: string): { scheme: string; port: number }[] =>
  [...text.matchAll(new RegExp(`(https?)://${LISTENS}`, 'g'))].map(match => ({
    scheme: match[1] ?? '',
    port: Number(match[2]),
  }));
export const portsIn = (text: string): number[] => [
  ...new Set([...text.matchAll(new RegExp(LISTENS, 'g'))].map(match => Number(match[1]))),
];

/** .NET: every launch profile's applicationUrl. */
export function dotnetPorts(launchSettingsText: string): FoundPort[] {
  let profiles: Record<string, { applicationUrl?: string } | null>;
  try {
    const settings = JSON.parse(launchSettingsText.replace(/^﻿/, '')) as { profiles?: typeof profiles };
    profiles = settings.profiles ?? {};
  } catch {
    return portsIn(launchSettingsText).map(port => ({ port, where: 'launchSettings.json' }));
  }
  return Object.entries(profiles).flatMap(([name, profile]) =>
    urlsIn(profile?.applicationUrl ?? '').map(url => ({ ...url, where: `profile ${name}` })),
  );
}

/** Node: PORT in .env files, a dev server port in vite/serverless config, --port in package.json scripts. */
export function nodePorts(files: Record<string, string | null>): FoundPort[] {
  const out: FoundPort[] = [];
  const add = (text: string, pattern: RegExp, where: string) => {
    for (const match of text.matchAll(pattern)) out.push({ port: Number(match[1]), where });
  };
  for (const [name, text] of Object.entries(files)) {
    if (!text) continue;
    if (name.startsWith('.env')) add(text, /^\s*PORT\s*=\s*(\d{2,5})/gm, `${name} PORT`);
    if (/^vite\.config|^serverless\./.test(name)) add(text, /\b(?:port|httpPort)\s*[:=]\s*(\d{2,5})/g, name);
    if (name !== 'package.json') continue;
    let scripts: Record<string, unknown> = {};
    try {
      scripts = (JSON.parse(text) as { scripts?: typeof scripts }).scripts ?? {};
    } catch {
      // Not JSON: no scripts to read.
    }
    for (const [script, command] of Object.entries(scripts))
      add(String(command), /(?:--port|-p|--httpPort)[ =](\d{2,5})/g, `npm run ${script}`);
  }
  return out;
}

/** A clone as the kind recipes see it (core/kinds): which files it has, their text, what a folder holds. */
export const repoFiles = (repo: string): RepoView => ({
  has: file => fs.existsSync(path.join(repo, file)),
  read: file => {
    try {
      const full = path.join(repo, file);
      return fs.statSync(full).size < 512 * 1024 ? fs.readFileSync(full, 'utf8') : null;
    } catch {
      return null;
    }
  },
  list: dir => {
    try {
      const entries = fs.readdirSync(path.join(repo, dir), { withFileTypes: true });
      return entries.filter(entry => entry.isDirectory()).map(entry => entry.name);
    } catch {
      return [];
    }
  },
  find: suffix => findFiles(repo, name => name.endsWith(suffix), 4).length > 0,
});
export const detectKind = (repo: string): string | null => detect(repoFiles(repo));

const inProperties = (name: string, file: string) =>
  name === 'launchSettings.json' && file.includes(`${path.sep}Properties${path.sep}`);
const NODE_FILE = /^package\.json$|^\.env|^vite\.config\.|^serverless\./;

export function localPorts(repo: string, kind: string | null | undefined): FoundPort[] {
  if (kind === 'dotnet')
    return findFiles(repo, inProperties).flatMap(file =>
      dotnetPorts(read(file) ?? '').map(found => ({ ...found, where: `${path.relative(repo, file)} ${found.where}` })),
    );
  if (kind === 'node' || kind === 'web') {
    const names = fs.readdirSync(repo).filter(name => NODE_FILE.test(name));
    const found = nodePorts(Object.fromEntries(names.map(name => [name, read(path.join(repo, name))])));
    // A front end with no port set uses its framework's default.
    let pkg: PackageJson | null = null;
    try {
      pkg = JSON.parse(read(path.join(repo, 'package.json')) ?? 'null') as PackageJson | null;
    } catch {
      // Not JSON: no framework to tell.
    }
    const framework = kind === 'web' ? frameworkOf(pkg) : null;
    return found.length || !framework
      ? found
      : [{ port: framework.port, scheme: 'http', where: `${framework.name} default` }];
  }
  const usual = kind ? defaultPort(kind, repoFiles(repo)) : null;
  return usual ? [{ port: usual, scheme: 'http', where: `${kindOf({ kind: kind ?? undefined }).label} default` }] : [];
}

const portOf = (url: string | undefined) => {
  try {
    return Number(new URL(url ?? '').port) || null;
  } catch {
    return null;
  }
};

/** Ports that two different things want at once. A tunnel to one host is one thing, even when several apps need it. */
export function conflicts(apps: Investigated[]): { port: number; who: string[] }[] {
  const owners = new Map<number, Map<string, string[]>>();
  const claim = (port: number, owner: string, label: string) => {
    const claims = owners.get(port) ?? new Map<string, string[]>();
    claims.set(owner, [...(claims.get(owner) ?? []), label]);
    owners.set(port, claims);
  };
  for (const app of apps) {
    const own = app.stackPort ?? app.ports[0]?.port;
    if (own) claim(own, `app:${app.id}`, app.id);
    for (const { tunnel, port } of app.tunnels)
      if (port) claim(port, `tunnel:${String(tunnel)}`, `tunnel to ${String(tunnel)} (for ${app.id})`);
  }
  // Two tunnels on one port are planned by core/ports (share, move or loopback); only clashes involving an app are
  // reported here.
  return [...owners]
    .filter(([, claims]) => claims.size > 1 && [...claims.keys()].some(owner => owner.startsWith('app:')))
    .map(([port, claims]) => ({ port, who: [...claims.values()].map(labels => labels.join(', ')) }));
}

export function investigate({ afterSync = false } = {}): void {
  const stack = readStack() ?? fail('no stack loaded (koppler init)');
  const clones = readClones();
  register(stack.kinds);
  const found = stack.found ?? {};
  const known = hostsByApp(stack);
  const apps = Object.entries(stack.apps).map(([id, app]) => {
    const repo = clones[id]?.path;
    const kind = (app.kind as string | undefined) ?? (repo ? (detectKind(repo) ?? undefined) : undefined);
    return {
      id,
      name: app.name,
      kind,
      repo,
      ports: repo ? localPorts(repo, kind) : [],
      tunnels: (app.prereqs ?? []).filter(need => need.tunnel && need.port),
      stackPort: portOf(app.url),
      stackUrl: app.url ?? null,
      deployed: app.deployedUrl ?? null,
      calls: Object.keys(app.consumes ?? {}),
      found: Object.keys(found[id] ?? {}),
    };
  });
  const portsOf = (app: (typeof apps)[number]) => [...new Set(app.ports.map(found => found.port))];

  const rows = apps.map(app => {
    const listens =
      app.kind === 'flutter'
        ? '(app, calls out only)'
        : portsOf(app).join(', ') || (app.repo ? 'none found' : 'not cloned');
    const counted = [
      app.calls.length && `${String(app.calls.length)} recorded`,
      app.found.length && `${String(app.found.length)} found`,
    ];
    const tunnels = app.tunnels.map(tunnel => tunnel.port).join(', ') || '-';
    return [app.id, app.kind ?? '?', listens, app.stackPort ?? '-', tunnels, counted.filter(Boolean).join(', ') || '-'];
  });
  table([['APP', 'KIND', 'LISTENS ON', 'STACK PORT', 'TUNNELS', 'CALLS'], ...rows]);

  const suggestions: Record<string, Record<string, unknown>> = {};
  console.log('');
  for (const clash of conflicts(apps)) console.log(`CONFLICT port ${String(clash.port)}: ${clash.who.join(', ')}`);
  // Tunnels that clash when the apps needing them run together, and how koppler plan resolves it.
  const needs = apps.flatMap(app =>
    app.tunnels.flatMap(({ tunnel, port, env, connectsAs }) =>
      tunnel && port ? [{ app: app.id, tunnel, port, env, connectsAs }] : [],
    ),
  );
  const clashing = new Set(
    needs
      .filter(need => needs.some(other => other.port === need.port && other.tunnel !== need.tunnel))
      .map(need => need.port),
  );
  for (const port of clashing) {
    const plan = planTunnels(needs.filter(need => need.port === port));
    const who = plan.map(tunnel => `${tunnel.host.split('.')[0] ?? ''} (${tunnel.apps.join(', ')})`);
    console.log(`TUNNELS port ${String(port)}: ${who.join(' and ')} clash when run together`);
    for (const line of describePlan(plan)) console.log(`  RESOLVE ${line}`);
  }
  for (const app of apps) {
    if (!app.repo || app.kind === 'flutter') continue;
    const ports = portsOf(app);
    const [first] = app.ports;
    if (!app.stackUrl && first) {
      const url = `${first.scheme ?? 'http'}://localhost:${String(first.port)}/`;
      (suggestions[app.id] ??= {})['url'] = url;
      console.log(`SUGGEST ${app.id}.url = ${JSON.stringify(url)}  (from ${first.where})`);
    } else if (app.stackPort && ports.length && !ports.includes(app.stackPort))
      console.log(
        `MISMATCH ${app.id}: stack.json says port ${String(app.stackPort)}, the repo uses ${ports.join(', ')}`,
      );
    if (!afterSync && !known[app.id]?.size && kindOf(app).serves)
      console.log(`UNKNOWN ${app.id}: no deployed address in stack.json, so calls to it cannot be found`);
    for (const callee of app.found)
      console.log(`FOUND ${app.id} -> ${callee}: not in stack.json (koppler sync shows where)`);
  }
  const file = path.join(TEMP, 'stack.suggestions.json');
  fs.writeFileSync(file, JSON.stringify({ at: new Date().toISOString(), apps, suggestions }, null, 2) + '\n');
  console.log(`\nFull results and suggestions: ${file}`);
}
