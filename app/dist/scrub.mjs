// Text made safe to post in a public issue: secrets masked, and everything that names the user, their company or their
// stack (apps, repos, hosts, queues, paths, ticket ids, accounts) replaced by stable placeholders, so a log keeps its shape.
import os from 'node:os';
// Logs can echo connection strings or tokens on errors; mask them before they reach the page or an agent.
export const redact = text => text
    .replace(/\x1b\[[0-9;]*[A-Za-z]/g, '')
    .replace(/(password|passwd|pwd|secret|token|api[_-]?key|access[_-]?key)(\\?["']?\s*[=:]\s*)(?:(\\?["'])[^\n]*?\3|[^;"'\s,}&]+)/gi, (m, key, sep, quote = '') => `${key}${sep}${quote}***${quote}`)
    .replace(/\b([a-z][a-z0-9+.-]*:\/\/)[^\s/:@]+:[^\s/@]+@/gi, '$1***:***@')
    .replace(/\beyJ[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{5,}/g, '***jwt***')
    .replace(/\b(Bearer\s+)[A-Za-z0-9._~+/=-]{8,}/g, '$1***')
    .replace(/\b(gh[pousr]_|github_pat_|glpat-|npm_|xox[abpsr]-|sk-|[sr]k_(?:live|test)_)[A-Za-z0-9_-]{10,}/g, '***token***')
    .replace(/\b(AKIA|ASIA)[A-Z0-9]{16}\b/g, '***aws-key***');
const HOST = /\b(?:[a-z0-9](?:[a-z0-9-]*[a-z0-9])?\.)+[a-z][a-z0-9-]*[a-z0-9]\b/gi;
const GENERIC = new Set(['localhost', 'example.com', 'github.com', 'host.docker.internal']);
const escape = s => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
// Every name the stacks give away, each with its placeholder; a log can come from a stack used before this one.
export function namesOf(registries) {
    const out = new Map(), add = (term, as) => { term = String(term ?? '').trim(); if (term.length > 2 && !out.has(term.toLowerCase()))
        out.set(term.toLowerCase(), { term, as }); };
    let apps = 0, queues = 0, stacks = 0, boards = 0;
    for (const registry of [].concat(registries ?? []).filter(Boolean)) {
        const named = (name, as) => { add(name, as); add(String(name ?? '').replace(/[\s_-]+/g, ''), as.replace(/\s+/g, '')); };
        named(registry.name, `my-stack-${++stacks}`);
        for (const [id, a] of Object.entries(registry.apps ?? {})) {
            const n = ++apps;
            named(a.name, `App ${n}`);
            add(id, `app-${n}`);
            for (const part of String(a.slug ?? '').split('/').slice(-2))
                add(part, `repo-${n}`);
        }
        for (const p of [].concat(registry.presets ?? []))
            named(p?.name, `Board ${++boards}`);
        for (const [id, q] of Object.entries(registry.queues ?? {})) {
            const n = ++queues;
            named(q.name, `Queue ${n}`);
            add(id, `queue-${n}`);
            add(q.queue, `queue-${n}`);
            for (const e of Object.values(q.envs ?? {}))
                add(e.queue, `queue-${n}`);
        }
    }
    const hosts = new Set(JSON.stringify(registries ?? {}).match(HOST) ?? []);
    [...hosts].filter(h => !GENERIC.has(h.toLowerCase()) && !/\.(json|js|mjs|ya?ml|toml|cs|dart|md)$/i.test(h)).forEach((h, i) => add(h, `host-${i + 1}.example`));
    return out;
}
export function scrub(text, registries, { home = os.homedir(), user = os.userInfo().username } = {}) {
    let s = redact(String(text));
    if (home)
        s = s.split(home).join('~');
    // Longest first, so "orders-api.acme.dev" goes before "orders-api".
    for (const { term, as } of [...namesOf(registries).values()].sort((a, b) => b.term.length - a.term.length))
        // A long name is replaced even when glued to other text (".NETOrders API"); a short one only as a whole word.
        s = s.replace(term.length >= 8 ? new RegExp(escape(term), 'gi') : new RegExp(`(?<![\\w-])${escape(term)}(?![\\w-])`, 'gi'), as);
    return s
        .replace(new RegExp(`(?<![\\w-])${escape(user)}(?![\\w-])`, 'gi'), 'user')
        .replace(/[\w.+-]+@[\w-]+(?:\.[\w-]+)+/g, 'someone@example.com')
        .replace(/\b[A-Z][A-Z0-9]+-\d+\b/g, 'TICKET-1')
        .replace(/\b\d{12}\b/g, '<account>')
        .replace(/\b(?!127\.|0\.0\.0\.0)(?:\d{1,3}\.){3}\d{1,3}\b/g, '<ip>');
}
//# sourceMappingURL=scrub.mjs.map