// What Koppler can work out about a stack's apps from their clones, offered for the user to accept into stack.json:
// where each runs locally, its deployed address per environment (from Terraform), and which apps call which.
// Nothing is written until the user picks what to keep.
import fs from 'node:fs';
import { fail } from '../failure.ts';
import { of as kindOf } from '../core/kinds.ts';
import { validateStack } from '../core/stack.ts';
import { readClones, readStack } from '../data.ts';
import { draftApp, ENV_TOKEN, readRepo, stackEnv } from './deployed.ts';
import { localPorts } from './investigate.ts';
import { grepClone, hostsByApp, missingCalls, saveStack, urlsInClone } from './sync.ts';

interface AppFile {
  name?: string;
  kind?: string;
  slug?: string;
  url?: string;
  deployedUrl?: string;
  consumes?: Record<string, { deployed?: string } & Record<string, unknown>>;
  envs?: Record<string, Record<string, unknown>>;
}
/** A stack file as it is read and written here. */
export interface StackFile {
  envs: string[];
  envAliases?: Record<string, string[]>;
  kinds?: unknown;
  apps: Record<string, AppFile>;
}
/** Something the clones say that the stack does not. */
export interface Finding {
  id: string;
  app: string | null;
  kind: 'alias' | 'url' | 'address' | 'call';
  env?: string;
  /** The app a call goes to. */
  to?: string;
  value: string;
  why: string;
  /** The finding this one follows from, which has to be accepted with it. */
  needs?: string;
}
type Clones = Record<string, string>;
/** A host an app's own code names for an environment. */
interface OwnHost {
  host: string;
  token: string;
  where: string;
}

const deployedOf = (app: AppFile | undefined, env: string, first: string | undefined) =>
  env === first ? app?.deployedUrl : (app?.envs?.[env]?.['deployedUrl'] as string | undefined);
/** Writes an address where the stack keeps it for that environment. */
const setDeployed = (app: AppFile | undefined, env: string, first: string | undefined, url: string) => {
  if (!app) return;
  if (env === first) app.deployedUrl = url;
  else ((app.envs ??= {})[env] ??= {})['deployedUrl'] = url;
};
const copyOf = (stack: StackFile) => JSON.parse(JSON.stringify(stack)) as StackFile;

// ponytail: matched by name, so each one is a finding the user accepts; a stack can always state deployedUrl itself.
const GENERIC = new Set(['api', 'app', 'web', 'www', 'service', 'services']);
/**
 * An app whose Terraform cannot tell its address often still writes it in its own code (Swagger servers, pipelines):
 * a host carrying the repo's name and an environment's name. By app, then environment.
 */
export function ownAddresses(
  stack: StackFile,
  clones: Clones,
  urls: (repo: string) => string[] = urlsInClone,
): Record<string, Record<string, OwnHost>> {
  // Every run of words of an app's repo name, joined: "orders-api" is known as orders, ordersapi (never just api).
  const names = Object.entries(stack.apps).map(([id, app]): [string, Set<string>] => {
    const repo = (app.slug ?? id).split('/').pop() ?? '';
    const words = repo
      .toLowerCase()
      .split(/[^a-z0-9]+/)
      .filter(Boolean);
    const runs = new Set<string>();
    words.forEach((word, from) => {
      for (let to = from + 1; to <= words.length; to++)
        if (to - from > 1 || !GENERIC.has(word)) runs.add(words.slice(from, to).join(''));
    });
    return [id, runs];
  });
  const out: Record<string, Record<string, OwnHost>> = {};
  for (const [id, repo] of Object.entries(clones)) {
    const seen: Record<string, Record<string, OwnHost>> = {};
    for (const line of urls(repo)) {
      const [, where = '', written] = /^(.*?:\d+):https?:\/\/([a-z0-9.-]+)$/i.exec(line) ?? [];
      const host = written?.toLowerCase().replace(/\.$/, '');
      const token = host && ENV_TOKEN.exec(host)?.[1]?.toLowerCase();
      const env = token && stackEnv(token, stack);
      if (!host || !token || !env) continue;
      const label = (host.split('.')[0] ?? '')
        .replace(new RegExp(`(^|[-_])${token}(?=[-_]|$)`), '')
        .replace(/[^a-z0-9]/g, '');
      const owners = names.filter(([, runs]) => runs.has(label));
      if (owners.length === 1 && owners[0]?.[0] === id) (seen[env] ??= {})[host] ??= { host, token, where };
    }
    for (const [env, hosts] of Object.entries(seen)) {
      // The environment's own name wins over another name for it; two hosts left means it cannot be told.
      const all = Object.values(hosts);
      const exact = all.filter(found => found.token === env);
      const [pick, ...others] = exact.length ? exact : all;
      if (pick && !others.length) (out[id] ??= {})[env] = pick;
    }
  }
  return out;
}

/**
 * The repos may call an environment by another name (QA deployed as "dev"). When one stack environment gets no
 * address at all and the repos use exactly one unknown name, that pairing is offered.
 */
function aliasIn(stack: StackFile, clones: Clones): { env: string; name: string } | null {
  const repos = Object.values(clones);
  const aliases = stack.envAliases ?? {};
  const tokens = new Set(repos.flatMap(repo => readRepo(repo, []).flatMap(module => module.token ?? [])));
  const known = (token: string) =>
    stack.envs.includes(token) || Object.values(aliases).flat().includes(token) || stackEnv(token, stack);
  const [name, ...moreNames] = [...tokens].filter(token => !known(token));
  if (!name || moreNames.length) return null;
  const hasAddress = (env: string) =>
    repos.some(repo =>
      readRepo(repo, [env, ...(aliases[env] ?? [])]).some(
        module => stackEnv(module.token, stack) === env && module.domains.length,
      ),
    );
  const [env, ...moreEnvs] = stack.envs.filter(one => !hasAddress(one));
  return env && !moreEnvs.length ? { env, name } : null;
}

/** What the clones say that the stack does not: an environment's other name, local addresses, deployed addresses, calls. */
export function discover(
  given: StackFile,
  clones: Clones,
  { grep = grepClone, urls = urlsInClone }: { grep?: typeof grepClone; urls?: typeof urlsInClone } = {},
): Finding[] {
  const out: Finding[] = [];
  const [first] = given.envs;
  const alias = aliasIn(given, clones);
  const aliasId = alias && `alias:${alias.env}:${alias.name}`;
  let stack = given;
  if (alias && aliasId) {
    const why = `the repos deploy to "${alias.name}", and nothing to ${alias.env.toUpperCase()}`;
    out.push({ id: aliasId, app: null, kind: 'alias', env: alias.env, value: alias.name, why });
    // The addresses that follow from that pairing are found with it in place.
    const names = [...(given.envAliases?.[alias.env] ?? []), alias.name];
    stack = { ...given, envAliases: { ...given.envAliases, [alias.env]: names } };
  }
  const workspaces = [...new Set(stack.envs.flatMap(env => [env, ...(stack.envAliases?.[env] ?? [])]))];
  const owners = new Map<string | null, string>(
    Object.entries(hostsByApp(stack)).flatMap(([id, hosts]) => [...hosts].map((host): [string, string] => [host, id])),
  );
  const withAddresses = copyOf(stack);
  for (const [id, app] of Object.entries(stack.apps)) {
    const repo = clones[id];
    if (!repo) continue;
    if (!app.url && !kindOf(app).platforms) {
      const [port] = localPorts(repo, app.kind, given);
      if (port)
        out.push({
          id: `url:${id}`,
          app: id,
          kind: 'url',
          value: `${port.scheme ?? 'http'}://localhost:${String(port.port)}`,
          why: port.where,
        });
    }
    const drafts = draftApp(id, readRepo(repo, workspaces), stack, owners);
    for (const env of stack.envs) {
      const url = drafts[env]?.deployedUrl;
      if (!url || deployedOf(app, env, first)) continue;
      const needs = alias?.env === env && aliasId;
      out.push({
        id: `address:${id}:${env}`,
        app: id,
        kind: 'address',
        env,
        value: url,
        why: 'its Terraform',
        ...(needs && { needs }),
      });
      setDeployed(withAddresses.apps[id], env, first, url);
    }
  }
  for (const [id, envs] of Object.entries(ownAddresses(stack, clones, urls)))
    for (const env of stack.envs) {
      const target = withAddresses.apps[id];
      const found = envs[env];
      if (!found || deployedOf(target, env, first)) continue;
      const url = `https://${found.host}/`;
      const needs = alias?.env === env && found.token === alias.name && aliasId;
      const why = `its own code, ${found.where}`;
      out.push({ id: `address:${id}:${env}`, app: id, kind: 'address', env, value: url, why, ...(needs && { needs }) });
      setDeployed(target, env, first, url);
    }
  // Calls are found by other apps' addresses in a caller's code, so the addresses just found count too.
  const calls = missingCalls(withAddresses, (id, hosts) => {
    const repo = clones[id];
    return repo ? grep(repo, hosts) : [];
  });
  for (const [caller, callees] of Object.entries(calls))
    for (const [callee, where] of Object.entries(callees))
      out.push({ id: `call:${caller}:${callee}`, app: caller, kind: 'call', to: callee, value: callee, why: where });
  return out;
}

/** Writes the accepted findings into the stack. Only findings discover() still produces can be accepted. */
export function applyFindings(
  stack: StackFile,
  findings: Finding[],
  ids: string[],
): { stack: StackFile; applied: number; error?: undefined } | { error: string } {
  const next = copyOf(stack);
  const [first] = stack.envs;
  // A finding that follows from another (an address under an environment's other name) needs that one picked too.
  const picked = findings.filter(found => ids.includes(found.id) && (!found.needs || ids.includes(found.needs)));
  const firstAddress = (app: string) =>
    picked.findLast(found => found.kind === 'address' && found.app === app && found.env === first)?.value;
  for (const found of picked) {
    const { kind, env = '', value } = found;
    if (kind === 'alias') {
      const aliases = (next.envAliases ??= {});
      aliases[env] = [...new Set([...(aliases[env] ?? []), value])];
      continue;
    }
    const app = next.apps[found.app ?? ''];
    if (!app) continue;
    if (kind === 'url') app.url = value;
    if (kind === 'address') setDeployed(app, env, first, value);
    if (kind === 'call' && found.to) {
      const deployed = stack.apps[found.to]?.deployedUrl ?? firstAddress(found.to);
      (app.consumes ??= {})[found.to] = { how: 'unknown', found: found.why, ...(deployed && { deployed }) };
    }
  }
  const errors = validateStack(next);
  return errors.length ? { error: errors.join('; ') } : { stack: next, applied: picked.length };
}

/** The stack in use and its clones, as the canvas and the command see them. */
export function current(): { source: string; stack: StackFile; clones: Clones } | null {
  const source = readStack()?.source;
  if (!source) return null;
  const clones = Object.entries(readClones()).flatMap(([id, clone]): [string, string][] =>
    clone?.path ? [[id, clone.path]] : [],
  );
  const stack = JSON.parse(fs.readFileSync(source, 'utf8')) as StackFile;
  return { source, stack, clones: Object.fromEntries(clones) };
}

/** `koppler discover [--apply]`: what was found; with --apply, all of it goes into the stack. */
export function discoverCommand(args: string[]): void {
  const { source, stack, clones } = current() ?? fail('no stack in use (koppler init)');
  const findings = discover(stack, clones);
  const name = (id: string | null | undefined) => stack.apps[id ?? '']?.name ?? String(id);
  if (!findings.length) {
    console.log('Nothing new found.');
    return;
  }
  for (const found of findings) {
    const { kind, value, why } = found;
    const ENV = (found.env ?? '').toUpperCase();
    if (kind === 'alias') {
      console.log(`ALIAS   "${value}" in the repos means ${ENV}  (${why})`);
      continue;
    }
    const what =
      kind === 'url'
        ? `runs locally on ${value}`
        : kind === 'address'
          ? `${ENV} address ${value}`
          : `calls ${name(found.to)}`;
    console.log(`${kind.toUpperCase().padEnd(7)} ${name(found.app)}: ${what}  (${why})`);
  }
  if (!args.includes('--apply')) {
    console.log(`\n${String(findings.length)} found. Add them to stack.json with: koppler discover --apply`);
    return;
  }
  const applied = applyFindings(
    stack,
    findings,
    findings.map(found => found.id),
  );
  if (applied.error !== undefined) fail(applied.error);
  const refused = saveStack(source, JSON.parse(fs.readFileSync(source, 'utf8')), applied.stack);
  if (refused) fail(refused.error);
  console.log(`\nAdded ${String(applied.applied)} to ${source}. Run koppler sync to load them.`);
}
