// What the user has to do before a set of apps can start, in plain words with one command each, checked live.
// Usage: koppler doctor [app...] [--env <env>] [--no-tunnels <app,app>] [--json]   (default: the apps on the canvas)
import { APPROVE, approved, checksFor, envGaps, stackCommands, startsFromStack } from './checks.mjs';
import fs from 'node:fs';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import * as tunnelPlan from './core/ports.ts';
import * as kp from './core/plan.ts';
import { readData } from './data.ts';

// "Cache (Valkey)" -> "Valkey cache", "Database" -> "database": what an address leads to, in plain words.
const friendly = host => { const k = tunnelPlan.tunnelKind({ tunnel: host }); const m = k.match(/^(\w+) \((.+)\)$/); return m ? `${m[2]} ${m[1].toLowerCase()}` : k === 'Tunnel' ? 'private' : k.toLowerCase(); };
// A secret's condition: "always" or none means it is needed; anything else is only needed in that case.
const always = when => !when || /^always\b/i.test(when.trim());

const run = (cmd, args, timeout = 8000) => { try { return { ok: true, out: execFileSync(cmd, args, { encoding: 'utf8', timeout, stdio: ['ignore', 'pipe', 'ignore'] }) }; } catch { return { ok: false, out: '' }; } };

// One step per prerequisite: plain title, why the app needs it, the command, where to run it, and how to tell it is done.
export function stepsFor(appName, prereqs, ctx = {}) {
  const steps = [];
  for (const p of prereqs) {
    if (p.sso) steps.push({ id: `sso:${p.sso}`, title: `Sign in to AWS (${p.sso})`, why: `${appName} reads its settings from AWS when it starts.`, command: `aws sso login --profile ${p.sso}`, where: 'anywhere', check: { sso: p.sso }, browser: true });
    if (p.hosts) steps.push({ id: `hosts:${p.hosts}`, title: `Point the ${friendly(p.hosts)} address at your Mac`, why: `${appName} connects to ${p.hosts}; on your Mac that name has to lead to the local tunnel.`, command: `echo "127.0.0.1 ${p.hosts}" | sudo tee -a /etc/hosts`, where: 'your terminal (asks for your Mac password)', check: { hosts: p.hosts } });
    if (p.devCerts) steps.push({ id: 'devcerts', title: 'Trust the local HTTPS certificate', why: `${appName} serves https on your Mac; your browser and other apps must trust it.`, command: 'dotnet dev-certs https --trust', where: 'anywhere', check: { devCerts: true } });
    if (p.nuget) steps.push({ id: 'nuget', title: 'Connect to the private package feed', why: `${appName} downloads company packages while it builds.`, command: null, where: null, how: p.note, check: { stackCheck: /nuget/i } });
  }
  for (const s of ctx.secrets ?? []) {
    const skillPath = t => t?.replaceAll('<skill>', ctx.skill);
    const onlyIf = always(s.when) ? undefined : s.when, store = ctx.store ?? ctx.appId;
    if (s.env) steps.push({ id: `secret:${store}:${s.env}`, title: `Store ${s.env} for ${appName}`, why: `${appName} needs it to start.`, onlyIf,
      command: skillPath(s.fetch?.cli) ?? `koppler secret set ${store} ${s.env}`, where: 'your own terminal, not the agent (the value must not land in the conversation)',
      alt: skillPath(s.fetch?.ui), check: { secret: [store, s.env] } });
    if (s.file) steps.push({ id: `file:${ctx.appId}:${s.file}`, title: `Put ${path.basename(s.file)} in place for ${appName}`, why: `${appName} reads it when it starts.`, onlyIf,
      command: skillPath(s.fetch?.cli) ?? null, where: 'your own terminal', alt: skillPath(s.fetch?.ui), how: s.note, check: { file: path.join(ctx.repo ?? '', s.file) } });
  }
  return steps;
}

// Live checks: true when done, false when not, null when it cannot be told.
export function isDone(check, env = {}) {
  if (check.sso) return run('aws', ['sts', 'get-caller-identity', '--profile', check.sso]).ok;
  if (check.hosts) { try { return fs.readFileSync(env.hostsFile ?? '/etc/hosts', 'utf8').split('\n').some(l => !l.trim().startsWith('#') && l.split(/\s+/).slice(1).includes(check.hosts)); } catch { return null; } }
  if (check.devCerts) return run('dotnet', ['dev-certs', 'https', '--check', '--trust']).ok;
  if (check.secret) return run(path.join(env.skill, 'bin', 'secret-list'), [check.secret[0]]).out.split(/\s+/).includes(check.secret[1]);
  if (check.file) return check.file ? fs.existsSync(check.file) : null;
  if (check.approved) return false;
  if (check.stackCheck) { const c = (env.checks ?? []).find(c => check.stackCheck.test(c.name)); return c ? run('sh', ['-c', c.run], 20000).ok : null; }
  return null;
}

export function needs(args, { skill, fail, collect = false }) {
  const registry = readData('registry') ?? fail('no stack loaded (koppler init)');
  const local = readData('local')?.apps ?? {};
  const json = args.includes('--json'), envAt = args.indexOf('--env'), offAt = args.indexOf('--no-tunnels');
  // Apps run without their tunnels: no tunnel, and no hosts entry pointing at one.
  const noTunnels = new Set(offAt >= 0 ? (args[offAt + 1] ?? '').split(',').filter(Boolean) : []);
  const env = envAt >= 0 ? args[envAt + 1] : registry.envs[0];
  if (!registry.envs.includes(env)) fail(`unknown env ${env}; the stack has ${registry.envs.join(', ')}`);
  let ids = args.filter((a, i) => !a.startsWith('--') && (envAt < 0 || i !== envAt + 1) && (offAt < 0 || i !== offAt + 1));
  if (!ids.length) ids = Object.keys(readData('state')?.nodes ?? {});
  for (const id of ids) if (!registry.apps[id]) fail(`${id} is not an app in the stack`);
  // What the stack does not say for this environment: never filled in from the first one.
  const gaps = envGaps(registry, env === registry.envs[0] ? '-' : env).filter(g => ids.includes(g.app) && !(noTunnels.has(g.app) && (g.kind === 'tunnel' || g.kind === 'hosts')));
  const borrowed = new Set(gaps.filter(g => g.kind !== 'secret').map(g => g.app));
  const noFetch = new Set(gaps.filter(g => g.kind === 'secret').map(g => `${g.app}:${g.name}`));
  // An app without its own prerequisites here keeps only those that hold anywhere (a certificate, a file); never another environment's tunnels, sign-ins, hosts or secret fetch steps.
  const appFor = id => {
    const a = registry.apps[id], m = env === registry.envs[0] ? a : { ...a, ...(a.envs?.[env] ?? {}) };
    const secrets = m.secrets?.map(s => noFetch.has(`${id}:${s.env}`) ? { ...s, fetch: undefined } : s);
    // Only the first environment's list is borrowed; an environment's own list is its own, even when it misses a kind.
    const prereqs = borrowed.has(id) && !a.envs?.[env]?.prereqs ? (m.prereqs ?? []).filter(p => !p.tunnel && !p.sso && !p.hosts) : m.prereqs ?? [];
    return { ...m, secrets, prereqs: noTunnels.has(id) ? prereqs.filter(p => !p.tunnel && !p.hosts) : prereqs };
  };

  // Steps from every app, one per thing to do even when several apps need it.
  const byId = new Map();
  for (const id of ids) {
    const app = appFor(id);
    for (const step of stepsFor(app.name, app.prereqs ?? [], { appId: id, store: env === registry.envs[0] ? id : `${id}@${env}`, secrets: app.secrets, skill, repo: local[id]?.path })) {
      const seen = byId.get(step.id);
      if (seen) seen.apps.push(app.name); else byId.set(step.id, { ...step, apps: [app.name] });
    }
  }
  for (const g of gaps) byId.set(`gap:${g.app}:${g.kind}:${g.name}`, { id: `gap:${g.app}:${g.kind}:${g.name}`, title: g.detail, why: { tunnel: `Without it ${registry.apps[g.app].name} cannot reach its ${g.name} on ${env.toUpperCase()}; another environment's would be the wrong database.`, 'sign-in': `Another environment's sign-in would give ${registry.apps[g.app].name} the wrong account.`, hosts: `Another environment's address would send ${registry.apps[g.app].name} to the wrong place.`, secret: 'The stack only says how to get it for another environment.' }[g.kind], command: null, where: null, how: `Ask the agent: find the ${env.toUpperCase()} facts for ${registry.apps[g.app].name}. It reads the repo and your local tunnel aliases and proposes the stack.json change.`, check: {}, gap: true, apps: [registry.apps[g.app].name] });
  // The tunnel plan can add sudo steps (a loopback alias); tunnels themselves are Koppler's job.
  const entries = ids.flatMap(id => (appFor(id).prereqs ?? []).filter(p => p.tunnel && p.port).map(p => ({ app: id, tunnel: p.tunnel, port: p.port, env: p.env, connectsAs: p.connectsAs })));
  const plan = tunnelPlan.planTunnels(entries);
  for (const t of plan.filter(t => t.needsAlias)) {
    const steps = tunnelPlan.planSteps(t);
    byId.set(`alias:${t.bind}`, { id: `alias:${t.bind}`, title: `Give ${t.host.split('.')[0]} its own local address`, why: `Another tunnel needs port ${t.port}; this one keeps it on ${t.bind}.`, command: steps.sudo.join(' && '), where: 'your terminal (asks for your Mac password)', undo: steps.undo.join(' && '), apps: t.apps.map(id => registry.apps[id].name), check: { manual: true } });
  }
  const kindsInRun = new Set(ids.map(id => registry.apps[id].kind));
  for (const c of checksFor(registry).filter(c => !c.safe && (!c.kinds || c.kinds.some(k => kindsInRun.has(k))))) {
    if ([...byId.values()].some(s => s.check.stackCheck?.test(c.name))) continue;
    byId.set(`check:${c.name}`, { id: `check:${c.name}`, title: c.fix ?? c.name, doneTitle: c.ok ?? c.name, why: `The stack checks this before a run (${c.name}).`, command: null, apps: [], check: { stackCheck: new RegExp(`^${c.name.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}$`) } });
  }
  // The stack's own checks are shell commands: they run only once the user approved them (koppler doctor --approve).
  const mayRun = approved(registry.source ?? '', registry);
  // What the stack runs or writes for these apps needs the user's yes first: its checks, a start command it gives, a code change.
  const needsYes = !mayRun && (stackCommands(registry).some(c => c.what === 'check') || ids.some(id => startsFromStack(registry, id, env) || registry.apps[id].localChanges?.length));
  if (needsYes) byId.set('approve-stack', { id: 'approve-stack', title: 'Review and allow what this stack runs on your Mac', why: 'The stack carries its own commands or code changes, written by whoever edits it. Koppler runs none of them until you have seen them.', command: APPROVE, where: 'your own terminal', apps: [], check: { approved: true } });
  // In the order they can be done: what the stack is missing, then sign-ins (a secret's fetch needs them), then the rest, secrets last.
  const rank = s => s.gap ? 0 : s.check?.sso ? 1 : s.id.startsWith('secret:') ? 3 : 2;
  const steps = [...byId.values()].sort((a, b) => rank(a) - rank(b)).map(s => { const done = s.gap ? false : isDone(s.check, { skill, checks: mayRun ? checksFor(registry).filter(c => !c.safe) : [] }); return { ...s, done, title: done && s.doneTitle ? s.doneTitle : s.title }; });
  // A tunnel whose port already answers is not opened again.
  const open = port => /\bLISTEN\b/.test(run('lsof', ['-nP', `-iTCP:${port}`, '-sTCP:LISTEN']).out);
  const koppler = [...plan.map(t => `tunnel to ${t.host.split('.')[0]} on ${t.bind}:${t.port}${open(t.port) ? ' (already open)' : ''}`), ...ids.map(id => `start ${registry.apps[id].name}`)];
  const result = { env, apps: ids, steps, koppler, notSetUp: ids.filter(id => registry.apps[id].pending) };
  if (collect) return result;
  if (json) return console.log(JSON.stringify(result, null, 2));

  const todo = steps.filter(s => s.done !== true && !s.onlyIf), maybe = steps.filter(s => s.done !== true && s.onlyIf);
  // An app not set up yet has no prerequisites recorded, so an empty list would wrongly read as "ready".
  const notSetUp = ids.filter(id => registry.apps[id].pending);
  console.log(`Before ${ids.map(id => registry.apps[id].name).join(', ')} can run on ${env.toUpperCase()}:`);
  // On a protected environment, say up front what stays with the user and what Koppler does.
  if (kp.isProtected(registry, env)) console.log(`\n  On ${env.toUpperCase()} only you can: sign in to AWS in your browser, store secrets in your own terminal, run sudo steps, and query data (koppler query, in your terminal). Koppler opens the production tunnels and starts the apps when you press Send to ${env.toUpperCase()}.`);
  if (notSetUp.length) console.log(`\n  Not known yet: ${notSetUp.map(id => registry.apps[id].name).join(', ')} ${notSetUp.length === 1 ? 'is' : 'are'} not set up, so what ${notSetUp.length === 1 ? 'it needs' : 'they need'} (sign-ins, tunnels, secrets) is not known. The agent reads ${notSetUp.length === 1 ? 'its repo' : 'their repos'} first, then lists it here.`);
  if (!todo.length && !notSetUp.length) console.log('  Nothing for you to do.');
  todo.forEach((s, i) => {
    console.log(`\n  ${i + 1}. ${s.title}${s.done === null ? ' (cannot check this one; skip it if you already did)' : ''}`);
    console.log(`     Why: ${s.why}${s.apps.length > 1 ? ` (also for ${s.apps.slice(1).join(', ')})` : ''}`);
    if (s.command) console.log(`     ${s.where && s.where !== 'anywhere' ? `Run in ${s.where}` : 'Run'}:\n       ${s.command}`);
    if (s.browser) console.log('     It opens your browser to approve the sign-in.');
    if (s.alt) console.log(`     Or by hand: ${s.alt}`);
    if (s.how && !s.command) console.log(`     How: ${s.how}`);
    if (s.undo) console.log(`     To undo later: ${s.undo}`);
  });
  if (maybe.length) {
    console.log('\n  Only in some setups:');
    for (const s of maybe) console.log(`   - ${s.title}: only if ${s.onlyIf.replace(/^only\s+(if\s+|with\s+)?/i, '')}\n       ${s.command ? `${s.where && s.where !== 'anywhere' ? `Run in ${s.where}` : 'Run'}: ${s.command}` : s.how ?? ''}`);
  }
  const done = steps.filter(s => s.done === true);
  if (done.length) console.log(`\n  Already done: ${done.map(s => s.title).join('; ')}.`);
  console.log(`\n  Koppler does the rest: ${koppler.join(', ')}.`);
}
