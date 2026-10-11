// Goes through every stack app's clone and reports the ports it listens on locally, its calls, port conflicts and gaps
// against stack.json. Suggestions go to temp/stack.suggestions.json; the shared stack is never changed.
// Usage: koppler discover
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { hostsByApp } from './sync.mjs';
import tunnelPlan from './ports.cjs';
import kinds from './kinds.cjs';
import { TEMP } from "./paths.js";
import { readData } from "./data.js";
const SKIP = new Set(['node_modules', '.git', 'bin', 'obj', 'build', 'dist', '.dart_tool', 'Pods', 'coverage', '.next', 'vendor', 'target']);
const read = file => { try {
    return fs.readFileSync(file, 'utf8');
}
catch {
    return null;
} };
// Files up to a few levels deep whose name matches, skipping build output and dependencies.
export function findFiles(dir, test, depth = 5, found = []) {
    let entries;
    try {
        entries = fs.readdirSync(dir, { withFileTypes: true });
    }
    catch {
        return found;
    }
    for (const e of entries) {
        const p = path.join(dir, e.name);
        if (e.isDirectory()) {
            if (depth > 0 && !SKIP.has(e.name) && !e.name.startsWith('.'))
                findFiles(p, test, depth - 1, found);
        }
        else if (test(e.name, p))
            found.push(p);
    }
    return found;
}
export const urlsIn = text => [...String(text).matchAll(/(https?):\/\/(?:localhost|127\.0\.0\.1|0\.0\.0\.0|\*|\+):(\d{2,5})/g)].map(m => ({ scheme: m[1], port: Number(m[2]) }));
export const portsIn = text => [...new Set([...String(text).matchAll(/(?:localhost|127\.0\.0\.1|0\.0\.0\.0|\*|\+):(\d{2,5})/g)].map(m => Number(m[1])))];
// .NET: every launch profile's applicationUrl.
export function dotnetPorts(launchSettingsText) {
    let profiles;
    try {
        profiles = JSON.parse(launchSettingsText.replace(/^\uFEFF/, '')).profiles ?? {};
    }
    catch {
        return portsIn(launchSettingsText).map(port => ({ port, where: 'launchSettings.json' }));
    }
    return Object.entries(profiles).flatMap(([name, p]) => urlsIn(p.applicationUrl ?? '').map(u => ({ ...u, where: `profile ${name}` })));
}
// Node: PORT in .env files, a dev server port in vite/serverless config, --port in package.json scripts.
export function nodePorts(files) {
    const out = [];
    for (const [name, text] of Object.entries(files)) {
        if (!text)
            continue;
        if (name.startsWith('.env'))
            for (const m of text.matchAll(/^\s*PORT\s*=\s*(\d{2,5})/gm))
                out.push({ port: Number(m[1]), where: `${name} PORT` });
        if (/^vite\.config|^serverless\./.test(name))
            for (const m of text.matchAll(/\b(?:port|httpPort)\s*[:=]\s*(\d{2,5})/g))
                out.push({ port: Number(m[1]), where: name });
        if (name === 'package.json') {
            let scripts = {};
            try {
                scripts = JSON.parse(text).scripts ?? {};
            }
            catch { }
            for (const [script, cmd] of Object.entries(scripts))
                for (const m of String(cmd).matchAll(/(?:--port|-p|--httpPort)[ =](\d{2,5})/g))
                    out.push({ port: Number(m[1]), where: `npm run ${script}` });
        }
    }
    return out;
}
// A clone as the kind recipes see it (kinds.cjs): which files it has, their text, what a folder holds.
export const repoFiles = repo => ({
    has: f => fs.existsSync(path.join(repo, f)),
    read: f => { try {
        return fs.statSync(path.join(repo, f)).size < 512 * 1024 ? fs.readFileSync(path.join(repo, f), 'utf8') : null;
    }
    catch {
        return null;
    } },
    list: d => { try {
        return fs.readdirSync(path.join(repo, d), { withFileTypes: true }).filter(e => e.isDirectory()).map(e => e.name);
    }
    catch {
        return [];
    } },
    find: suffix => findFiles(repo, n => n.endsWith(suffix), 4).length > 0,
});
export const detectKind = repo => kinds.detect(repoFiles(repo));
export function localPorts(repo, kind) {
    if (kind === 'dotnet')
        return findFiles(repo, (n, p) => n === 'launchSettings.json' && p.includes(`${path.sep}Properties${path.sep}`))
            .flatMap(f => dotnetPorts(read(f) ?? '').map(x => ({ ...x, where: `${path.relative(repo, f)} ${x.where}` })));
    if (kind === 'node' || kind === 'web') {
        const names = fs.readdirSync(repo).filter(n => n === 'package.json' || n.startsWith('.env') || /^vite\.config\./.test(n) || /^serverless\./.test(n));
        const found = nodePorts(Object.fromEntries(names.map(n => [n, read(path.join(repo, n))])));
        // A front end with no port set uses its framework's default.
        let pkg = null;
        try {
            pkg = JSON.parse(read(path.join(repo, 'package.json')) ?? 'null');
        }
        catch { }
        const fw = kind === 'web' ? kinds.frameworkOf(pkg) : null;
        return found.length || !fw ? found : [{ port: fw.port, scheme: 'http', where: `${fw.name} default` }];
    }
    const usual = kinds.defaultPort(kind, repoFiles(repo));
    return usual ? [{ port: usual, scheme: 'http', where: `${kinds.of({ kind }).label} default` }] : [];
}
const portOf = url => { try {
    const u = new URL(url);
    return Number(u.port) || null;
}
catch {
    return null;
} };
// Ports that two different things want at once. A tunnel to one host is one thing, even when several apps need it.
export function conflicts(apps) {
    const owners = new Map();
    const claim = (port, owner, label) => { const m = owners.get(port) ?? new Map(); m.set(owner, [...(m.get(owner) ?? []), label]); owners.set(port, m); };
    for (const a of apps) {
        const own = a.stackPort ?? a.ports[0]?.port;
        if (own)
            claim(own, `app:${a.id}`, a.id);
        for (const t of a.tunnels)
            claim(t.port, `tunnel:${t.tunnel}`, `tunnel to ${t.tunnel} (for ${a.id})`);
    }
    // Two tunnels on one port are planned by ports.cjs (share, move or loopback); only clashes involving an app are reported here.
    return [...owners].filter(([, m]) => m.size > 1 && [...m.keys()].some(k => k.startsWith('app:'))).map(([port, m]) => ({ port, who: [...m.values()].map(labels => labels.join(', ')) }));
}
export function investigate(_args = [], { afterSync = false } = {}) {
    const registry = readData('registry'), local = readData('local')?.apps ?? {};
    if (!registry) {
        console.error('koppler: no stack loaded (koppler init)');
        process.exit(1);
    }
    kinds.register(registry.kinds);
    const found = registry.found ?? {}, known = hostsByApp(registry);
    const apps = Object.entries(registry.apps).map(([id, app]) => {
        const repo = local[id]?.path;
        const kind = app.kind ?? (repo && detectKind(repo));
        const ports = repo ? localPorts(repo, kind) : [];
        const tunnels = (app.prereqs ?? []).filter(p => p.tunnel && p.port);
        return { id, name: app.name, kind, repo, ports, tunnels, stackPort: portOf(app.url), stackUrl: app.url ?? null, deployed: app.deployedUrl ?? null,
            calls: Object.keys(app.consumes ?? {}), found: Object.keys(found[id] ?? {}) };
    });
    const rows = apps.map(a => {
        const listens = a.kind === 'flutter' ? '(app, calls out only)' : [...new Set(a.ports.map(p => p.port))].join(', ') || (a.repo ? 'none found' : 'not cloned');
        const sockets = [a.calls.length && `${a.calls.length} recorded`, a.found.length && `${a.found.length} found`].filter(Boolean).join(', ') || '-';
        return [a.id, a.kind ?? '?', listens, a.stackPort ?? '-', a.tunnels.map(t => t.port).join(', ') || '-', sockets];
    });
    const table = [['APP', 'KIND', 'LISTENS ON', 'STACK PORT', 'TUNNELS', 'CALLS'], ...rows];
    const widths = table[0].map((_, i) => Math.max(...table.map(r => String(r[i]).length)));
    for (const r of table)
        console.log(r.map((c, i) => String(c).padEnd(widths[i])).join('  ').trimEnd());
    const suggestions = {};
    const suggest = (id, field, value, why) => { (suggestions[id] ||= {})[field] = value; console.log(`SUGGEST ${id}.${field} = ${JSON.stringify(value)}  (${why})`); };
    console.log('');
    for (const c of conflicts(apps))
        console.log(`CONFLICT port ${c.port}: ${c.who.join(', ')}`);
    // Tunnels that clash when the apps needing them run together, and how koppler plan resolves it.
    const entries = apps.flatMap(a => a.tunnels.map(t => ({ app: a.id, tunnel: t.tunnel, port: t.port, env: t.env, connectsAs: t.connectsAs })));
    const clashing = new Set(entries.map(e => e.port).filter((port, i) => entries.filter(e => e.port === port && e.tunnel !== entries[i].tunnel).length));
    for (const port of clashing) {
        const plan = tunnelPlan.planTunnels(entries.filter(e => e.port === port));
        console.log(`TUNNELS port ${port}: ${plan.map(t => `${t.host.split('.')[0]} (${t.apps.join(', ')})`).join(' and ')} clash when run together`);
        for (const line of tunnelPlan.describePlan(plan))
            console.log(`  RESOLVE ${line}`);
    }
    for (const a of apps) {
        if (!a.repo || a.kind === 'flutter')
            continue;
        const ports = [...new Set(a.ports.map(p => p.port))];
        if (!a.stackUrl && ports.length)
            suggest(a.id, 'url', `${a.ports[0].scheme ?? 'http'}://localhost:${a.ports[0].port}/`, `from ${a.ports[0].where}`);
        else if (a.stackPort && ports.length && !ports.includes(a.stackPort))
            console.log(`MISMATCH ${a.id}: stack.json says port ${a.stackPort}, the repo uses ${ports.join(', ')}`);
        if (!afterSync && !known[a.id]?.size && kinds.of(a).serves !== false)
            console.log(`UNKNOWN ${a.id}: no deployed address in stack.json, so calls to it cannot be found`);
        for (const f of a.found)
            console.log(`FOUND ${a.id} -> ${f}: not in stack.json (koppler sync shows where)`);
    }
    fs.writeFileSync(path.join(TEMP, 'stack.suggestions.json'), JSON.stringify({ at: new Date().toISOString(), apps, suggestions }, null, 2) + '\n');
    console.log(`\nFull results and suggestions: ${path.join(TEMP, 'stack.suggestions.json')}`);
}
if (process.argv[1] && fs.realpathSync(process.argv[1]) === fileURLToPath(import.meta.url))
    investigate();
//# sourceMappingURL=investigate.mjs.map