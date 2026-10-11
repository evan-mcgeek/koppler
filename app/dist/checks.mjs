// What a stack needs on this Mac, checked when the stack loads. Koppler itself needs only git and Node.
// The rest comes from the stack: the programs its kinds of app are started with, the programs its own commands call
// (a tunnel's command, an AWS sign-in), and its `checks`, which are shell commands and so run only once the user approved them.
// Usage: koppler doctor [--json]      run them and say what is missing
//        koppler doctor --approve     show the stack's own check commands and allow them to run (again after they change)
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import vm from 'node:vm';
import crypto from 'node:crypto';
import { execFileSync } from 'node:child_process';
import kinds from './kinds.cjs';
import { TEMP } from "./paths.js";
const temp = () => process.env.KOPPLER_TEMP || TEMP;
const approvalsFile = () => path.join(process.env.KOPPLER_CONFIG_DIR || path.join(os.homedir(), '.config', 'koppler'), 'approved-checks.json');
const TOOL = /^[A-Za-z0-9._+-]{1,64}$/;
const text = (v, max = 300) => typeof v === 'string' ? v.slice(0, max) : '';
// The checks a stack calls for. `safe` ones only ask whether a program is installed; the stack's own `checks` are shell.
export function checksFor(registry) {
    const apps = Object.entries(registry?.apps ?? {}), list = new Map();
    const tool = (name, who, fix) => { if (!TOOL.test(name ?? ''))
        return; const c = list.get(name) ?? { name, tool: name, safe: true, for: [], fix: '' }; if (who && !c.for.includes(who))
        c.for.push(who); c.fix ||= fix || ''; list.set(name, c); };
    tool('git', 'Koppler', 'xcode-select --install');
    tool('node', 'Koppler', 'Install Node 22 or newer');
    if (registry?.kinds)
        kinds.register?.(registry.kinds);
    for (const [, app] of apps.filter(([, a]) => !a.outside)) {
        for (const n of kinds.of(app).needs ?? [])
            tool(n.tool, kinds.of(app).label, n.fix);
        // Every environment's prerequisites: an AWS sign-in uses the aws program, a command is started by its first word.
        for (const p of [...(app.prereqs ?? []), ...Object.values(app.envs ?? {}).flatMap(e => e?.prereqs ?? [])]) {
            if (p?.sso)
                tool('aws', app.name ?? 'an app', registry.install?.aws);
            const first = text(p?.cmd).trim().split(/\s+/)[0];
            if (first)
                tool(first, p.what ?? app.name ?? 'an app', registry.install?.[first]);
        }
    }
    for (const c of list.values())
        c.fix ||= text(registry?.install?.[c.tool]) || `Install ${c.tool} and make sure it is on your PATH`;
    const own = (Array.isArray(registry?.checks) ? registry.checks : []).filter(c => c && typeof c.name === 'string' && typeof c.run === 'string').slice(0, 50)
        .map(c => ({ name: text(c.name, 80), run: text(c.run, 2000), ok: text(c.ok), fix: text(c.fix) || 'This check of the stack fails', safe: false, ...(Array.isArray(c.kinds) && { kinds: c.kinds.filter(k => typeof k === 'string') }) }))
        .filter(c => !c.kinds || apps.some(([, a]) => c.kinds.includes(a.kind)));
    return [...list.values(), ...own];
}
// What the stack does not say for an environment other than the first: a tunnel the first one has, or how to get a secret
// there. Never filled in from the first environment: its hosts and secrets are another environment's.
export function envGaps(registry, only) {
    const [first, ...rest] = registry?.envs ?? [], gaps = [];
    for (const env of rest.filter(e => !only || e === only))
        for (const [id, app] of Object.entries(registry?.apps ?? {})) {
            if (app.outside)
                continue;
            const own = app.envs?.[env] ?? {}, label = String(env).toUpperCase(), from = String(first).toUpperCase();
            // Tunnels, sign-ins and hosts entries belong to one environment: each kind the first one has must be in this one's own list too.
            const has = kind => (own.prereqs ?? []).some(p => p?.[kind]);
            for (const p of app.prereqs ?? []) {
                if (p?.tunnel && !has('tunnel'))
                    gaps.push({ app: id, env, kind: 'tunnel', name: p.what ?? p.tunnel, detail: `No ${label} tunnel for ${app.name ?? id}'s ${p.what ?? 'database'} (${from} uses ${p.tunnel})` });
                if (p?.sso && !has('sso'))
                    gaps.push({ app: id, env, kind: 'sign-in', name: p.sso, detail: `No ${label} sign-in for ${app.name ?? id} (${from} uses the AWS profile ${p.sso})` });
                if (p?.hosts && !has('hosts'))
                    gaps.push({ app: id, env, kind: 'hosts', name: p.hosts, detail: `No ${label} hosts entry for ${app.name ?? id} (${from} uses ${p.hosts})` });
            }
            if (!own.secrets)
                for (const x of (app.secrets ?? []).filter(x => x?.fetch))
                    gaps.push({ app: id, env, kind: 'secret', name: x.env, detail: `No steps for getting ${x.env} for ${app.name ?? id} on ${label}` });
        }
    return gaps;
}
// Apps whose tunnels for `env` are missing: they must not borrow the first environment's.
export const missingTunnels = (registry, env) => [...new Set(envGaps(registry, env).filter(g => g.kind === 'tunnel').map(g => g.app))];
// Changes whenever a command of the stack's own checks changes; names and order of safe checks do not count.
// Everything in the stack that Koppler would run or write on this Mac, beyond the stack's facts: its own checks, the
// start commands it gives (per app, per environment, and per kind it defines), and the code changes it remembers.
// A shared stack can be edited by anyone on the team, so none of it happens until the user has seen exactly this list.
export function stackCommands(registry) {
    const out = [], add = (what, name, run) => { if (typeof run === 'string' && run)
        out.push({ what, name, run }); };
    for (const c of checksFor(registry).filter(c => !c.safe))
        add('check', c.name, c.run);
    for (const [id, k] of Object.entries(registry?.kinds ?? {})) {
        add('start of every', `${id} app`, k?.start);
        add('stop of every', `${id} app`, k?.stop);
    }
    for (const [id, app] of Object.entries(registry?.apps ?? {})) {
        add('start', app?.name ?? id, app?.start);
        for (const [env, e] of Object.entries(app?.envs ?? {}))
            add(`start on ${env}`, app?.name ?? id, e?.start);
        for (const c of Array.isArray(app?.localChanges) ? app.localChanges : [])
            add('code change', `${app?.name ?? id}, ${c?.file}`, `${c?.find}\n  becomes\n${c?.replace}`);
    }
    return out;
}
// Whether this app's start runs a command the stack wrote, on that environment.
export const startsFromStack = (registry, id, env) => { const a = registry?.apps?.[id]; return !!(a && (a.start || a.envs?.[env]?.start || registry?.kinds?.[a.kind]?.start)); };
export const fingerprint = commands => crypto.createHash('sha256').update(JSON.stringify(commands.map(c => [c.what, c.name, c.run]))).digest('hex');
const approvals = () => { try {
    return JSON.parse(fs.readFileSync(approvalsFile(), 'utf8'));
}
catch {
    return {};
} };
// Approved when the stack runs nothing of its own, or the user approved exactly what it runs now.
export const approved = (source, registry) => { const commands = stackCommands(registry); return !commands.length || approvals()[source] === fingerprint(commands); };
export function approve(source, registry) {
    fs.mkdirSync(path.dirname(approvalsFile()), { recursive: true });
    fs.writeFileSync(approvalsFile(), JSON.stringify({ ...approvals(), [source]: fingerprint(stackCommands(registry)) }, null, 2) + '\n', { mode: 0o600 });
}
export const APPROVE = 'koppler doctor --approve';
const has = tool => { try {
    execFileSync('/bin/sh', ['-c', `command -v ${tool}`], { stdio: 'ignore' });
    return true;
}
catch {
    return false;
} };
const passes = run => { try {
    execFileSync('/bin/sh', ['-c', run], { stdio: 'ignore', timeout: 20000 });
    return true;
}
catch {
    return false;
} };
// Runs what may run. A stack check that was not approved stays `pending`: listed, not run.
export function runChecks(registry, { source = registry?.source ?? '', exists = has, shell = passes } = {}) {
    const checks = checksFor(registry), ok = approved(source, registry);
    const gaps = envGaps(registry).map(g => ({ name: `${g.app} ${g.env}`, from: 'stack', state: 'gap', detail: g.detail, app: g.app, env: g.env, kind: g.kind }));
    return [...checks.map(c => {
            const base = { name: c.name, from: c.safe ? 'tool' : 'stack', ...(c.for?.length && { for: c.for }) };
            if (c.safe)
                return exists(c.tool) ? { ...base, state: 'ok', detail: 'installed' } : { ...base, state: 'missing', detail: c.fix };
            if (!ok)
                return { ...base, state: 'pending', detail: 'Waits for your approval: koppler doctor --approve' };
            return shell(c.run) ? { ...base, state: 'ok', detail: c.ok || 'ok' } : { ...base, state: 'missing', detail: c.fix };
        }), ...gaps];
}
const registryNow = () => { try {
    const sandbox = { window: {} };
    vm.runInNewContext(fs.readFileSync(path.join(temp(), 'registry.js'), 'utf8'), sandbox);
    return sandbox.window.REGISTRY;
}
catch {
    return null;
} };
const report = results => { for (const r of results)
    console.log(`${{ ok: 'ok', missing: 'MISSING', pending: 'PENDING', gap: 'GAP' }[r.state].padEnd(8)} ${r.name.padEnd(14)} ${r.detail}${r.for?.length && r.state !== 'ok' ? ` (needed by ${r.for.join(', ')})` : ''}`); };
// Runs the loaded stack's checks, prints them, and leaves the result for the canvas. Returns false when something is missing.
export function checkStack({ quiet = false } = {}) {
    const registry = registryNow();
    if (!registry)
        return true;
    const results = runChecks(registry);
    fs.mkdirSync(temp(), { recursive: true });
    fs.writeFileSync(path.join(temp(), 'checks.json'), JSON.stringify({ at: new Date().toISOString(), stack: registry.name ?? '', results }, null, 2) + '\n');
    if (!quiet)
        report(results);
    return !results.some(r => r.state === 'missing');
}
// The tools and the stack's own checks on this Mac, saved for the canvas. With `approve`, the stack's check commands are
// shown first and run only once `confirm` says yes: they come from a shared file anyone on the team can edit.
export async function checkTools({ approve: wantApprove = false, confirm = async () => false } = {}) {
    const registry = registryNow();
    if (!registry)
        return { error: 'no stack loaded (koppler init)' };
    const commands = stackCommands(registry), source = registry.source ?? '';
    if (wantApprove) {
        if (!commands.length)
            console.log('This stack runs nothing of its own, so there is nothing to approve.');
        else {
            console.log(`The stack at ${source} would run or write these on this Mac. Anyone who can edit the stack wrote them:\n`);
            for (const c of commands)
                console.log(`  ${c.what}: ${c.name}\n${c.run.split('\n').map(l => `    ${l}`).join('\n')}\n`);
            if (!await confirm('Allow all of these?'))
                return { error: 'not approved; the stack\'s own commands and code changes stay off' };
            approve(source, registry);
            console.log('Approved. They are allowed from now on, until any of them changes.\n');
        }
    }
    const results = runChecks(registry);
    fs.writeFileSync(path.join(temp(), 'checks.json'), JSON.stringify({ at: new Date().toISOString(), stack: registry.name ?? '', results }, null, 2) + '\n');
    return { results };
}
export { report };
//# sourceMappingURL=checks.mjs.map