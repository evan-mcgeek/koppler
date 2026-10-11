// What Koppler can work out about a stack's apps from their clones, offered for the user to accept into stack.json:
// where each runs locally, its deployed address per environment (from Terraform), and which apps call which.
// Nothing is written until the user picks what to keep.
import fs from 'node:fs';
import { localPorts } from './investigate.mjs';
import { ENV_TOKEN, draftApp, readRepo, stackEnv } from './deployed.mjs';
import { grepClone, hostsByApp, missingCalls, urlsInClone, validateStack } from './sync.mjs';
import * as kinds from './core/kinds.ts';
import { readData } from './data.ts';

const deployedOf = (app, env, first) => env === first ? app.deployedUrl : app.envs?.[env]?.deployedUrl;

// An app whose Terraform cannot tell its address often still writes it in its own code (Swagger servers, pipelines):
// a host carrying the repo's name and an environment's name. Returns { id: { env: { host, token, where } } }.
// ponytail: matched by name, so each one is a finding the user accepts; a stack can always state deployedUrl itself.
const GENERIC = new Set(['api', 'app', 'web', 'www', 'service', 'services']);
export function ownAddresses(stack, clones, urls = urlsInClone) {
  const names = Object.fromEntries(Object.entries(stack.apps).map(([id, app]) => {
    const words = (app.slug ?? id).split('/').pop().toLowerCase().split(/[^a-z0-9]+/).filter(Boolean), runs = new Set();
    for (let i = 0; i < words.length; i++) for (let j = i + 1; j <= words.length; j++) if (j - i > 1 || !GENERIC.has(words[i])) runs.add(words.slice(i, j).join(''));
    return [id, runs];
  }));
  const out = {};
  for (const [id, repo] of Object.entries(clones)) {
    const seen = {};
    for (const line of urls(repo)) {
      const m = line.match(/^(.*?:\d+):https?:\/\/([a-z0-9.-]+)$/i), host = m?.[2].toLowerCase().replace(/\.$/, ''), token = host?.match(ENV_TOKEN)?.[1].toLowerCase();
      const env = token && stackEnv(token, stack);
      if (!env) continue;
      const label = host.split('.')[0].replace(new RegExp(`(^|[-_])${token}(?=[-_]|$)`), '').replace(/[^a-z0-9]/g, '');
      const owners = Object.keys(names).filter(a => names[a].has(label));
      if (owners.length === 1 && owners[0] === id) ((seen[env] ||= {})[host] ||= { host, token, where: m[1] });
    }
    for (const [env, hosts] of Object.entries(seen)) {
      // The environment's own name wins over another name for it; two hosts left means it cannot be told.
      const all = Object.values(hosts), exact = all.filter(h => h.token === env), pick = exact.length ? exact : all;
      if (pick.length === 1) (out[id] ||= {})[env] = pick[0];
    }
  }
  return out;
}

// Findings: { id, app, kind: 'alias' | 'url' | 'address' | 'call', env?, to?, value, why, needs? }.
export function discover(stack, clones, { grep = grepClone, urls = urlsInClone } = {}) {
  kinds.register(stack.kinds);
  const out = [], first = stack.envs[0];
  // The repos may call an environment by another name (QA deployed as "dev"). When one stack environment gets no address
  // at all and the repos use exactly one unknown name, that pairing is offered, and the addresses that follow from it.
  const named = new Set(Object.values(clones).flatMap(repo => readRepo(repo, []).map(m => m.token).filter(Boolean)));
  const known = t => stack.envs.includes(t) || Object.values(stack.envAliases ?? {}).flat().includes(t) || stackEnv(t, stack);
  const unknown = [...named].filter(t => !known(t));
  let alias = null;
  if (unknown.length === 1) {
    const missing = stack.envs.filter(env => !Object.values(clones).some(repo => readRepo(repo, [env, ...(stack.envAliases?.[env] ?? [])]).some(m => stackEnv(m.token, stack) === env && m.domains.length)));
    if (missing.length === 1) alias = { env: missing[0], name: unknown[0] };
  }
  if (alias) {
    out.push({ id: `alias:${alias.env}:${alias.name}`, app: null, kind: 'alias', env: alias.env, value: alias.name, why: `the repos deploy to "${alias.name}", and nothing to ${alias.env.toUpperCase()}` });
    stack = { ...stack, envAliases: { ...stack.envAliases, [alias.env]: [...(stack.envAliases?.[alias.env] ?? []), alias.name] } };
  }
  const workspaces = [...new Set(stack.envs.flatMap(e => [e, ...(stack.envAliases?.[e] ?? [])]))];
  const owners = new Map(Object.entries(hostsByApp(stack)).flatMap(([id, hosts]) => [...hosts].map(h => [h, id])));
  const withAddresses = JSON.parse(JSON.stringify(stack));
  for (const [id, app] of Object.entries(stack.apps)) {
    const repo = clones[id];
    if (!repo) continue;
    if (!app.url && !kinds.of(app).platforms) {
      const p = localPorts(repo, app.kind)[0];
      if (p) out.push({ id: `url:${id}`, app: id, kind: 'url', value: `${p.scheme ?? 'http'}://localhost:${p.port}`, why: p.where });
    }
    const drafts = draftApp(id, readRepo(repo, workspaces), stack, owners);
    for (const env of stack.envs) {
      const d = drafts[env];
      if (!d?.deployedUrl || deployedOf(app, env, first)) continue;
      out.push({ id: `address:${id}:${env}`, app: id, kind: 'address', env, value: d.deployedUrl, why: 'its Terraform', ...(alias?.env === env && { needs: `alias:${alias.env}:${alias.name}` }) });
      const target = withAddresses.apps[id];
      if (env === first) target.deployedUrl = d.deployedUrl; else ((target.envs ||= {})[env] ||= {}).deployedUrl = d.deployedUrl;
    }
  }
  for (const [id, envs] of Object.entries(ownAddresses(stack, clones, urls))) for (const env of stack.envs) {
    const target = withAddresses.apps[id], d = envs[env];
    if (!d || deployedOf(target, env, first)) continue;
    out.push({ id: `address:${id}:${env}`, app: id, kind: 'address', env, value: `https://${d.host}/`, why: `its own code, ${d.where}`, ...(alias?.env === env && d.token === alias.name && { needs: `alias:${alias.env}:${alias.name}` }) });
    if (env === first) target.deployedUrl = `https://${d.host}/`; else ((target.envs ||= {})[env] ||= {}).deployedUrl = `https://${d.host}/`;
  }
  // Calls are found by other apps' addresses in a caller's code, so the addresses just found count too.
  const found = missingCalls(withAddresses, (id, hosts) => clones[id] ? grep(clones[id], hosts) : []);
  for (const [caller, calls] of Object.entries(found)) for (const [callee, where] of Object.entries(calls))
    out.push({ id: `call:${caller}:${callee}`, app: caller, kind: 'call', to: callee, value: callee, why: where });
  return out;
}

// Writes the accepted findings into the stack. Only findings discover() still produces can be accepted.
export function applyFindings(stack, findings, ids) {
  const next = JSON.parse(JSON.stringify(stack)), first = stack.envs[0], addressOf = {};
  // A finding that follows from another (an address under an environment's other name) needs that one picked too.
  const picked = findings.filter(f => ids.includes(f.id) && (!f.needs || ids.includes(f.needs)));
  for (const f of picked.filter(f => f.kind === 'address')) addressOf[`${f.app}:${f.env}`] = f.value;
  for (const f of picked) {
    if (f.kind === 'alias') { (next.envAliases ||= {})[f.env] = [...new Set([...(next.envAliases[f.env] ?? []), f.value])]; continue; }
    const app = next.apps[f.app];
    if (f.kind === 'url') app.url = f.value;
    if (f.kind === 'address') { if (f.env === first) app.deployedUrl = f.value; else ((app.envs ||= {})[f.env] ||= {}).deployedUrl = f.value; }
    if (f.kind === 'call') (app.consumes ||= {})[f.to] = { how: 'unknown', found: f.why, ...((stack.apps[f.to].deployedUrl ?? addressOf[`${f.to}:${first}`]) && { deployed: stack.apps[f.to].deployedUrl ?? addressOf[`${f.to}:${first}`] }) };
  }
  const errors = validateStack(next);
  return errors.length ? { error: errors.join('; ') } : { stack: next, applied: picked.length };
}

// The stack in use and its clones, as the canvas and the command see them.
export function current() {
  const registry = readData('registry'), local = readData('local')?.apps ?? {};
  if (!registry?.source) return null;
  const stack = JSON.parse(fs.readFileSync(registry.source, 'utf8'));
  return { source: registry.source, stack, clones: Object.fromEntries(Object.entries(local).filter(([, l]) => l?.path).map(([id, l]) => [id, l.path])) };
}

// koppler discover [--apply]: what was found; with --apply, all of it goes into the stack.
export function discoverCommand(args) {
  const c = current();
  if (!c) { console.error('koppler: no stack in use (koppler init)'); process.exit(1); }
  const findings = discover(c.stack, c.clones), name = id => c.stack.apps[id]?.name ?? id;
  if (!findings.length) return console.log('Nothing new found.');
  for (const f of findings) console.log(f.kind === 'alias' ? `ALIAS   "${f.value}" in the repos means ${f.env.toUpperCase()}  (${f.why})` : `${f.kind.toUpperCase().padEnd(7)} ${name(f.app)}: ${f.kind === 'url' ? `runs locally on ${f.value}` : f.kind === 'address' ? `${f.env.toUpperCase()} address ${f.value}` : `calls ${name(f.to)}`}  (${f.why})`);
  if (!args.includes('--apply')) return console.log(`\n${findings.length} found. Add them to stack.json with: koppler discover --apply`);
  const r = applyFindings(c.stack, findings, findings.map(f => f.id));
  if (r.error) { console.error(`koppler: ${r.error}`); process.exit(1); }
  fs.writeFileSync(c.source, JSON.stringify(r.stack, null, 2) + '\n');
  console.log(`\nAdded ${r.applied} to ${c.source}. Run koppler sync to load them.`);
}
