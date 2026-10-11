// Reads the Terraform in every stack app's clone and drafts what stack.json needs: each app's deployed address,
// the names of its settings and secrets, and the apps it calls. Only names and plain addresses are read out, never other values.
// The draft goes to temp/stack.deployed.json; the shared stack is never changed.
// Usage: koppler discover --deployed [app...]
import fs from 'node:fs';
import path from 'node:path';
import vm from 'node:vm';
import { fileURLToPath } from 'node:url';
import { hostsByApp } from './sync.mjs';
import { findFiles } from './investigate.mjs';
import { TEMP } from "./paths.js";
const load = (file, key) => {
    try {
        const sandbox = { window: {} };
        vm.runInNewContext(fs.readFileSync(path.join(TEMP, file), 'utf8'), sandbox);
        return sandbox.window[key];
    }
    catch {
        return null;
    }
};
export const ENV_TOKEN = /(?:^|[-_./])(dev|development|qa|test|uat|staging|stage|prod|production|prd|live)(?=[-_./]|$)/i;
const SYNONYMS = { prod: ['production', 'prd', 'live'], staging: ['stage'], dev: ['development'] };
const HOST = /^(?=.{4,253}$)([a-z0-9-]+\.)+[a-z]{2,}$/i;
const SECRETISH = /secret|password|passwd|token|api_?key|private|credential|connectionstring/i;
// Settings and parameters of AWS's own tooling, which say nothing about the app.
const TOOLING = /^(PARAMETERS_SECRETS_EXTENSION|SECRETS_MANAGER_TTL|AWS_|POWERTOOLS_|\/aws\/)/;
// Terraform text of the same length and lines, with what is inside quotes turned into "_" and comments into spaces, so
// that braces, brackets and comment marks can be counted without mistaking text for code.
// ponytail: heredocs (<<EOF) are read as code; mask them too if a policy written that way is ever misread
function masked(text) {
    let out = '';
    const inside = [];
    for (let i = 0; i < text.length; i++) {
        const c = text[i], two = text.slice(i, i + 2), top = inside.at(-1);
        const keep = n => { const part = text.slice(i, i + n); i += n - 1; return part; }, hide = (n, fill) => keep(n).replace(/[^\n]/g, fill);
        if (top === 'text') {
            if (c === '\\')
                out += hide(2, '_');
            else if (c === '"') {
                inside.pop();
                out += c;
            }
            else if (two === '${') {
                inside.push(0);
                out += hide(2, '_');
            }
            else
                out += hide(1, '_');
        }
        else if (c === '"') {
            inside.push('text');
            out += typeof top === 'number' ? '_' : c;
        }
        else if (typeof top === 'number') {
            if (c === '{')
                inside[inside.length - 1]++;
            else if (c === '}') {
                if (top === 0)
                    inside.pop();
                else
                    inside[inside.length - 1]--;
            }
            out += hide(1, '_');
        }
        else if (c === '#' || two === '//') {
            const end = text.indexOf('\n', i);
            out += hide((end < 0 ? text.length : end) - i, ' ');
        }
        else if (two === '/*') {
            const end = text.indexOf('*/', i + 2);
            out += hide((end < 0 ? text.length : end + 2) - i, ' ');
        }
        else
            out += c;
    }
    return out;
}
// The body between the braces that follow each match of `head`.
export function blocks(text, head) {
    const out = [], code = masked(text);
    for (const m of text.matchAll(head)) {
        // Named inside a comment or a quoted text, it is not a block.
        if (code[m.index] !== text[m.index])
            continue;
        const open = code.indexOf('{', m.index + m[0].length - 1);
        if (open < 0)
            continue;
        let depth = 0, i = open;
        for (; i < code.length; i++) {
            if (code[i] === '{')
                depth++;
            else if (code[i] === '}' && !--depth)
                break;
        }
        out.push({ match: m, body: text.slice(open + 1, i) });
    }
    return out;
}
// `key = value` pairs written directly in a block, with a nested map or list kept whole.
export function assignments(body) {
    const out = [], code = masked(body).split('\n'), lines = body.split('\n').map((l, i) => l.slice(0, code[i].trimEnd().length));
    const count = s => (s.match(/[{[(]/g) ?? []).length - (s.match(/[}\])]/g) ?? []).length;
    for (let i = 0, depth = 0; i < lines.length; i++) {
        const m = depth === 0 && lines[i].match(/^\s*"?([\w.-]+)"?\s*=\s*(.*)$/);
        if (!m) {
            depth += count(code[i]);
            continue;
        }
        let value = m[2], open = count(code[i]);
        while (open > 0 && ++i < lines.length) {
            value += '\n' + lines[i];
            open += count(code[i]);
        }
        out.push([m[1], value.trim().replace(/,$/, '')]);
    }
    return out;
}
// Works out a Terraform expression from variables, locals and the workspace; null when it cannot be told.
export function resolve(raw, ctx, depth = 0) {
    if (raw == null || depth > 12)
        return null;
    const v = String(raw).trim();
    if (/^"[^"]*"$/.test(v) || /^"(?:[^"\\]|\\.|\$\{[^}]*\})*"$/.test(v)) {
        let ok = true;
        const text = v.slice(1, -1).replace(/\$\{([^}]+)\}/g, (_, ref) => { const r = resolve(ref, ctx, depth + 1); if (typeof r !== 'string')
            ok = false; return r; });
        return ok ? text : null;
    }
    if (v.startsWith('{'))
        return Object.fromEntries(assignments(v.slice(1, v.lastIndexOf('}'))));
    if (v === 'terraform.workspace')
        return ctx.workspace ?? null;
    const either = v.match(/^([\w.[\]]+)\s*==\s*"([^"]*)"\s*\?\s*(.+?)\s+:\s+(.+)$/s);
    if (either) {
        const left = resolve(either[1], ctx, depth + 1);
        return typeof left === 'string' ? resolve(left === either[2] ? either[3] : either[4], ctx, depth + 1) : null;
    }
    const index = v.match(/^(.+)\[([^[\]]+)\]$/);
    if (index) {
        const map = resolve(index[1], ctx, depth + 1), key = resolve(index[2], ctx, depth + 1);
        return map && typeof map === 'object' && typeof key === 'string' ? resolve(map[key], ctx, depth + 1) : null;
    }
    const ref = v.match(/^(var|local)\.([\w-]+)$/);
    if (ref)
        return resolve((ref[1] === 'var' ? ctx.vars : ctx.locals)[ref[2]], ctx, depth + 1);
    return null;
}
// An address safe to show: a host, or an http(s) URL with no credentials, no query and no path that could be a token.
export function addressOf(value) {
    if (typeof value !== 'string')
        return null;
    if (HOST.test(value))
        return value.toLowerCase();
    try {
        const u = new URL(value);
        if (!/^https?:$/.test(u.protocol) || u.username || u.password || u.search || !HOST.test(u.hostname))
            return null;
        // A path is kept only when it reads as a plain API prefix (/api/v1); anything else may be a token (a webhook URL).
        const segments = u.pathname.split('/').filter(Boolean);
        return segments.length <= 3 && segments.every(x => /^[a-z][a-z0-9-]{0,19}$/.test(x)) ? `${u.origin}${u.pathname.replace(/\/$/, '')}` : u.origin;
    }
    catch {
        return null;
    }
}
// The smallest {...} around position `at` in `text`.
function around(text, at) {
    let start = at, depth = 0;
    for (; start >= 0; start--) {
        if (text[start] === '}')
            depth++;
        else if (text[start] === '{' && !depth--)
            break;
    }
    let end = at;
    depth = 0;
    for (; end < text.length; end++) {
        if (text[end] === '{')
            depth++;
        else if (text[end] === '}' && !depth--)
            break;
    }
    return text.slice(Math.max(0, start), end + 1);
}
const DEAD_LETTER = /dlq|dead.?letter/i;
// Queues and topics a Terraform folder declares or looks up, and how its app uses each: whether it reads or sends, the
// settings that carry the queue's address, and outside systems that feed it. Dead-letter queues are left out.
export function queueUses(tf) {
    const found = new Map();
    const add = (address, type, body) => { if (!DEAD_LETTER.test(address))
        found.set(address, { address, type, raw: assignments(body).find(([k]) => k === 'name')?.[1] ?? null, reads: false, sends: false, env: new Set(), fedBy: new Set() }); };
    for (const b of blocks(tf, /(resource|data)\s+"(aws_sqs_queue|aws_sns_topic)"\s+"([\w-]+)"\s*\{/g))
        add(`${b.match[1] === 'data' ? 'data.' : ''}${b.match[2]}.${b.match[3]}`, b.match[2] === 'aws_sns_topic' ? 'sns' : 'sqs', b.body);
    for (const b of blocks(tf, /module\s+"([\w-]+)"\s*\{/g)) {
        const source = assignments(b.body).find(([k]) => k === 'source')?.[1] ?? '';
        if (/\b(sqs|sns)\b/i.test(source))
            add(`module.${b.match[1]}`, /\bsns\b/i.test(source) ? 'sns' : 'sqs', b.body);
    }
    const refTo = address => new RegExp(`${address.replace(/\./g, '\\.')}(?:\\[[^\\]]*\\])?\\.(?:arn|url|id|name)\\b`, 'g');
    for (const b of blocks(tf, /(?:resource|data)\s+"([\w-]+)"\s+"[\w-]+"\s*\{/g)) {
        const type = b.match[1];
        for (const q of found.values())
            for (const m of b.body.matchAll(refTo(q.address))) {
                const near = around(b.body, m.index);
                if (/^aws_(sqs_queue|sns_topic)_policy$/.test(type)) {
                    // The queue's own policy says which outside service may send to it.
                    for (const [svc, what] of [['s3', 'S3 bucket notifications'], ['events', 'an EventBridge rule'], ['apigateway', 'an API Gateway route'], ['sns', 'an SNS topic']])
                        if (b.body.includes(`${svc}.amazonaws.com`))
                            q.fedBy.add(what);
                }
                else if (type === 'aws_lambda_event_source_mapping')
                    q.reads = true;
                else if (type === 'aws_s3_bucket_notification')
                    q.fedBy.add('S3 bucket notifications');
                else if (type === 'aws_cloudwatch_event_target')
                    q.fedBy.add('an EventBridge rule');
                else {
                    // One statement can allow both.
                    if (/sqs:SendMessage|sns:Publish|"sqs:\*"/.test(near))
                        q.sends = true;
                    if (/sqs:ReceiveMessage|"sqs:\*"/.test(near))
                        q.reads = true;
                }
            }
    }
    // Settings whose value is the queue's address: what a local run sets to the local queue.
    const settings = [...blocks(tf, /resource\s+"aws_lambda_function"\s+"[\w-]+"\s*\{/g).flatMap(b => blocks(b.body, /variables\s*=\s*\{/g)).flatMap(b => assignments(b.body)),
        ...blocks(tf, /resource\s+"aws_ecs_task_definition"\s+"[\w-]+"\s*\{/g).flatMap(b => [...b.body.matchAll(/name\s*[=:]\s*"([\w.]+)"\s*,?\s*value\s*[=:]\s*([^\s,}]+)/g)].map(m => [m[1], m[2]]))];
    for (const q of found.values())
        for (const [name, raw] of settings)
            if (refTo(q.address).test(raw))
                q.env.add(name);
    return [...found.values()].map(q => ({ ...q, env: [...q.env].sort(), fedBy: [...q.fedBy] }));
}
const hostOf = address => { try {
    return new URL(address.includes('://') ? address : `https://${address}`).hostname;
}
catch {
    return null;
} };
// One Terraform folder: what it declares, worked out once per environment. Environments come from its variable files' names;
// without those, each name in `workspaces` is tried as the Terraform workspace (and as an `environment` variable).
export function readModule(files, workspaces = []) {
    const tf = files.filter(f => f.name.endsWith('.tf')).map(f => f.text).join('\n');
    const defaults = Object.fromEntries(blocks(tf, /variable\s+"([\w-]+)"\s*\{/g).flatMap(b => { const d = assignments(b.body).find(([k]) => k === 'default'); return d ? [[b.match[1], d[1]]] : []; }));
    const locals = Object.fromEntries(blocks(tf, /(^|\n)\s*locals\s*\{/g).flatMap(b => assignments(b.body)));
    const allVarFiles = files.filter(f => f.name.endsWith('.tfvars')).map(f => ({ token: f.name.match(ENV_TOKEN)?.[1].toLowerCase(), vars: Object.fromEntries(assignments(f.text)) }));
    const shared = Object.assign({}, defaults, ...allVarFiles.filter(f => !f.token).map(f => f.vars)), varFiles = allVarFiles.filter(f => f.token);
    const named = token => Object.fromEntries(['environment', 'env', 'stage'].filter(k => !(k in shared)).map(k => [k, `"${token}"`]));
    const contexts = varFiles.length ? varFiles.map(f => ({ token: f.token, workspace: f.token, vars: { ...shared, ...f.vars }, locals }))
        : workspaces.length ? workspaces.map(token => ({ token, workspace: token, vars: { ...named(token), ...shared }, locals })) : [{ token: null, workspace: null, vars: shared, locals }];
    const resources = type => blocks(tf, new RegExp(`(?:resource|data)\\s+"(${type})"\\s+"[\\w-]+"\\s*\\{`, 'g'));
    const pick = (type, key) => resources(type).flatMap(b => assignments(b.body).filter(([k]) => k === key).map(([, raw]) => raw));
    const lists = raw => raw.trim().startsWith('[') ? raw.replace(/^\[|\]$/g, '').split(',').map(s => s.trim()).filter(Boolean) : [raw];
    const declared = {
        domains: [...pick('aws_api_gateway_domain_name|aws_apigatewayv2_domain_name', 'domain_name').map(raw => ({ raw, from: 'api' })),
            ...pick('aws_cloudfront_distribution', 'aliases').flatMap(lists).map(raw => ({ raw, from: 'cdn' })), ...pick('aws_route53_record', 'name').map(raw => ({ raw, from: 'dns' }))],
        settings: [...resources('aws_lambda_function').flatMap(b => blocks(b.body, /environment\s*\{/g)).flatMap(b => blocks(b.body, /variables\s*=\s*\{/g)).flatMap(b => assignments(b.body)),
            ...resources('aws_ecs_task_definition').flatMap(b => [...b.body.matchAll(/name\s*[=:]\s*"([\w.]+)"\s*,?\s*value\s*[=:]\s*("[^"\n]*"|[^\s,}]+)/g)].map(m => [m[1], m[2]]))],
        secrets: [...pick('aws_secretsmanager_secret', 'name'), ...pick('aws_secretsmanager_secret_version', 'secret_id')].map(raw => ({ raw, store: 'Secrets Manager' }))
            .concat(pick('aws_ssm_parameter', 'name').map(raw => ({ raw, store: 'Parameter Store' }))),
    };
    const queues = queueUses(tf);
    return contexts.map(ctx => ({
        token: ctx.token,
        queues: queues.map(q => { const name = resolve(q.raw, ctx); return { ...q, name: typeof name === 'string' ? name : null }; }).filter(q => !DEAD_LETTER.test(q.name ?? '')),
        // Only a variable that names the account, with a value that reads as an id or a name: never a key or a token.
        account: Object.entries(ctx.vars).filter(([k]) => /^(aws_)?account(_?(id|name|alias))?$/i.test(k)).map(([, raw]) => resolve(raw, ctx)).find(v => typeof v === 'string' && /^[\w.-]{1,64}$/.test(v)) ?? null,
        domains: declared.domains.map(d => ({ host: addressOf(resolve(d.raw, ctx) ?? ''), from: d.from })).filter(d => d.host && !d.host.includes('/')),
        settings: declared.settings.filter(([name]) => !TOOLING.test(name)).map(([name, raw]) => ({ name, address: addressOf(resolve(raw, ctx)), secret: SECRETISH.test(name) || /secret|sensitive/i.test(raw) })),
        // A name partly built at deploy time keeps its written form ("svc-${random}"); one that is all code is only counted.
        secrets: declared.secrets.map(s => { const name = resolve(s.raw, ctx); return { store: s.store, raw: s.raw.trim(), name: typeof name === 'string' ? name : /^"[^"]*"$/.test(s.raw.trim()) ? s.raw.trim().slice(1, -1) : null }; }).filter(s => !TOOLING.test(s.name ?? '')),
    }));
}
// Which stack environment a Terraform environment name means: the same name, a common synonym, or one listed in the stack's envAliases.
export function stackEnv(token, stack) {
    if (!token)
        return stack.envs.length === 1 ? stack.envs[0] : null;
    return stack.envs.find(e => e === token || SYNONYMS[e]?.includes(token) || stack.envAliases?.[e]?.includes(token)) ?? null;
}
// The domains a SAM app deploys to, per samconfig.toml environment: its domain-like deploy parameters (HostedZoneName,
// DomainName, ...), the way Terraform's domain resources are read.
export function samDomains(toml) {
    const out = [];
    for (const m of toml.matchAll(/\[([\w-]+)\.deploy\.parameters\]([\s\S]*?)(?=\n\[|$)/g)) {
        // One text or a list of them, in double or single quotes; a commented-out line is not read.
        const value = m[2].match(/^[ \t]*parameter_overrides\s*=\s*(\[[\s\S]*?\]|"(?:[^"\\]|\\.)*"|'[^']*')/m)?.[1] ?? '';
        const line = [...value.matchAll(/"((?:[^"\\]|\\.)*)"|'([^']*)'/g)].map(t => t[2] ?? t[1].replace(/\\(.)/g, '$1')).join(' ');
        // Only parameters that name the app's own domain: a database or cache host is someone else's address.
        const domains = [...line.matchAll(/(\w+)=(?:"([^"]*)"|(\S+))/g)].map(([, k, quoted, bare]) => [k, quoted ?? bare])
            .filter(([k, v]) => /(domain|hostedzone)(name)?$/i.test(k) && addressOf(v) && !v.includes('/')).map(([, v]) => ({ host: v.toLowerCase(), from: 'api' }));
        out.push({ token: m[1].toLowerCase(), domains });
    }
    return out.filter(x => x.domains.length);
}
// Every Terraform folder of a clone, read per environment; a SAM app's samconfig.toml adds its domains.
export function readRepo(repo, workspaces = []) {
    const byDir = new Map();
    for (const file of findFiles(repo, name => /\.(tf|tfvars)$/.test(name), 7)) {
        let text;
        try {
            text = fs.readFileSync(file, 'utf8');
        }
        catch {
            continue;
        }
        const dir = path.dirname(file);
        byDir.set(dir, [...(byDir.get(dir) ?? []), { name: path.basename(file), text }]);
    }
    const terraform = [...byDir].filter(([, files]) => files.some(f => f.name.endsWith('.tf'))).flatMap(([dir, files]) => readModule(files, workspaces).map(m => ({ ...m, dir: path.relative(repo, dir) })));
    let sam = [];
    try {
        sam = samDomains(fs.readFileSync(path.join(repo, 'samconfig.toml'), 'utf8')).map(x => ({ token: x.token, account: null, domains: x.domains, settings: [], secrets: [], queues: [], dir: 'samconfig.toml' }));
    }
    catch { }
    return [...terraform, ...sam];
}
// The draft for one app: per stack environment its address, account, settings, secrets and calls.
export function draftApp(id, modules, stack, owners) {
    const draft = {};
    // What a repo says under the environment's own name wins over what it says under an alias.
    const own = m => stack.envs.includes(m.token);
    for (const m of [...modules].sort((a, b) => own(a) - own(b))) {
        const env = stackEnv(m.token, stack);
        if (!env)
            continue;
        const d = draft[env] ||= { domains: [], settings: new Map(), secrets: new Map(), accounts: new Set(), queues: new Map() };
        if (own(m) && m.domains.length)
            d.domains = d.domains.filter(x => x.own);
        d.domains.push(...m.domains.map(x => ({ ...x, own: own(m) })));
        if (m.account)
            d.accounts.add(m.account);
        for (const s of m.settings)
            d.settings.set(s.name, { ...d.settings.get(s.name), ...s, address: s.address ?? d.settings.get(s.name)?.address ?? null });
        for (const s of m.secrets)
            d.secrets.set(`${s.store}:${s.name ?? s.raw}`, s);
        for (const q of m.queues ?? []) {
            const key = q.name ?? `${m.dir}:${q.address}`, had = d.queues.get(key);
            d.queues.set(key, { type: q.type, name: q.name, address: q.address, reads: !!(had?.reads || q.reads), sends: !!(had?.sends || q.sends), env: [...new Set([...(had?.env ?? []), ...q.env])].sort(), fedBy: [...new Set([...(had?.fedBy ?? []), ...q.fedBy])] });
        }
    }
    return Object.fromEntries(Object.entries(draft).map(([env, d]) => {
        const rank = { api: 0, cdn: 1, dns: 2 }, domains = [...new Map(d.domains.sort((a, b) => rank[a.from] - rank[b.from]).map(x => [x.host, x])).values()];
        const settings = [...d.settings.values()];
        const calls = settings.flatMap(s => { const callee = s.address && owners.get(hostOf(s.address)); return callee && callee !== id ? [{ to: callee, setting: s.name, deployed: s.address }] : []; });
        // The address the stack already has, when Terraform names it too, stays the app's address.
        const have = hostOf((env === stack.envs[0] ? stack.apps[id]?.deployedUrl : stack.apps[id]?.envs?.[env]?.deployedUrl) ?? '');
        domains.sort((a, b) => (b.host === have) - (a.host === have));
        return [env, { deployedUrl: domains[0] ? `https://${domains[0].host}/` : null, otherAddresses: domains.slice(1).map(x => x.host), accounts: [...d.accounts],
                settingsWithAddress: settings.filter(s => !s.secret && s.address).map(s => ({ name: s.name, address: s.address })),
                settings: settings.filter(s => !s.secret).map(s => s.name).sort(), secretSettings: settings.filter(s => s.secret).map(s => s.name).sort(), secrets: [...d.secrets.values()].filter(x => x.name).map(x => ({ store: x.store, name: x.name })), unnamedSecrets: [...d.secrets.values()].filter(x => !x.name).length, calls, queues: [...d.queues.values()] }];
    }));
}
// One entry per queue across the apps, by its name in the first environment: who sends, who reads, what feeds it.
// A queue only one app touches, with nothing outside feeding it, is internal to that app and not a link.
export function linkQueues(drafts, stack) {
    const byName = new Map();
    for (const [app, envs] of Object.entries(drafts))
        for (const [env, d] of Object.entries(envs))
            for (const q of d.queues ?? []) {
                const key = env === stack.envs[0] ? q.name ?? `${app}:${q.address}` : null;
                if (!key)
                    continue;
                const e = byName.get(key) ?? { queue: q.name, address: q.address, type: q.type, users: new Map(), fedBy: new Set(), envs: {} };
                const u = e.users.get(app) ?? { reads: false, sends: false, env: new Set() };
                e.users.set(app, { reads: u.reads || q.reads, sends: u.sends || q.sends, env: new Set([...u.env, ...q.env]) });
                q.fedBy.forEach(f => e.fedBy.add(f));
                byName.set(key, e);
            }
    // The same queue's name in the other environments, from the app that declares it.
    for (const [app, envs] of Object.entries(drafts))
        for (const [env, d] of Object.entries(envs))
            if (env !== stack.envs[0])
                for (const q of d.queues ?? []) {
                    const first = drafts[app][stack.envs[0]]?.queues?.find(x => x.address === q.address)?.name, e = first && byName.get(first);
                    if (e && q.name && q.name !== first)
                        e.envs[env] = q.name;
                }
    // A queue or topic no app sends to or reads, and nothing feeds (an alarm topic, a spare dead-letter queue), is not a link.
    return [...byName.values()].filter(e => e.fedBy.size || [...e.users.values()].some(u => u.reads || u.sends || u.env.size)).map(e => {
        const users = [...e.users], id = e.queue ? queueId(e.queue) : `${users[0][0]}-${e.address.split('.').pop().replace(/_/g, '-')}`;
        // An app that only carries the address and neither sends nor reads by itself is taken to send.
        const reads = users.filter(([, u]) => u.reads).map(([a]) => a), sends = users.filter(([, u]) => u.sends || (!u.reads && u.env.size)).map(([a]) => a);
        return { id, queue: e.queue, type: e.type, envs: e.envs, reads, sends, fedBy: [...e.fedBy], env: Object.fromEntries(users.map(([a, u]) => [a, [...u.env].sort()])),
            // Internal: one app both sends and reads, and nothing outside feeds it. One side unknown is a link still to find.
            inside: users.length === 1 && !e.fedBy.size && reads.length && sends.length ? users[0][0] : null, address: e.address, owner: users[0][0] };
    });
}
// "bookings-sqs-queue-dev" and "user-media-thumbnail-queue" become "bookings" and "user-media-thumbnail".
export const queueId = name => String(name).toLowerCase().replace(/\.fifo$/, '').split(/[^a-z0-9]+/).filter(w => w && !ENV_TOKEN.test(`-${w}-`) && !['sqs', 'sns', 'queue', 'topic'].includes(w)).join('-') || 'queue';
// What stack.json would need for the queues it does not list yet: the queue, and publishes / reads on each app.
// A queue the stack already has, by its id or its real name.
export const inStack = (q, stack) => !!stack.queues?.[q.id] || Object.values(stack.queues ?? {}).some(x => x.queue && x.queue === q.queue);
export function queueDraft(queues, stack) {
    const out = { queues: {}, apps: {} };
    for (const q of queues.filter(q => !q.inside && !inStack(q, stack))) {
        out.queues[q.id] = { name: q.id.split('-').map(w => w[0].toUpperCase() + w.slice(1)).join(' '), type: q.type, ...(q.queue && { queue: q.queue }), ...(Object.keys(q.envs).length && { envs: Object.fromEntries(Object.entries(q.envs).map(([e, n]) => [e, { queue: n }])) }), ...(q.fedBy.length && { note: `Fed by ${q.fedBy.join(' and ')}` }) };
        for (const [key, apps] of [['publishes', q.sends], ['reads', q.reads]])
            for (const a of apps)
                ((out.apps[a] ||= {})[key] ||= {})[q.id] = q.env[a]?.length ? { env: q.env[a] } : {};
    }
    return out;
}
// Outside systems recognised by their addresses: never run locally, each environment uses its own (a sandbox below PROD).
export const OUTSIDE = [
    { id: 'salesforce', name: 'Salesforce', test: /(^|\.)(my\.salesforce\.com|my\.site\.com|force\.com|salesforce-scrt\.com|my\.salesforce-sites\.com)$/i,
        why: 'the Salesforce org: never runs locally; each environment uses its own org, a sandbox below PROD' },
];
// Each outside system an app reaches, per stack environment: from its Terraform settings and its appsettings.<Env>.json files.
export function outsideCalls(repo, drafts, stack) {
    const found = {}, add = (provider, env, host, setting) => { const p = ((found[provider.id] ||= {})[env] ||= { hosts: new Set(), settings: new Set() }); p.hosts.add(host); if (setting)
        p.settings.add(setting); };
    for (const [env, d] of Object.entries(drafts))
        for (const s of d.settingsWithAddress ?? []) {
            const host = hostOf(s.address), provider = host && OUTSIDE.find(o => o.test.test(host));
            if (provider)
                add(provider, env, host, s.name);
        }
    for (const file of findFiles(repo, name => /^appsettings\.[\w-]+\.json$/i.test(name), 6)) {
        const env = stackEnv(path.basename(file).match(ENV_TOKEN)?.[1].toLowerCase(), stack);
        if (!env)
            continue;
        let text;
        try {
            text = fs.readFileSync(file, 'utf8');
        }
        catch {
            continue;
        }
        for (const m of text.matchAll(/"([\w.:-]+)"\s*:\s*"(https?:\/\/[^"\s]+)"/g)) {
            const host = hostOf(m[2]), provider = host && OUTSIDE.find(o => o.test.test(host));
            if (provider)
                add(provider, env, host, m[1].replace(/:/g, '__'));
        }
    }
    return found;
}
export function deployed(args = []) {
    const stack = load('registry.js', 'REGISTRY'), local = load('local.js', 'LOCAL')?.apps ?? {};
    if (!stack) {
        console.error('koppler: no stack loaded (koppler init)');
        process.exit(1);
    }
    const ids = args.filter(a => !a.startsWith('--'));
    for (const id of ids)
        if (!stack.apps[id]) {
            console.error(`koppler: ${id} is not an app in the stack`);
            process.exit(1);
        }
    const workspaces = [...new Set(stack.envs.flatMap(e => [e, ...(stack.envAliases?.[e] ?? [])]))];
    const repos = Object.fromEntries(Object.keys(stack.apps).filter(id => local[id]?.path).map(id => [id, readRepo(local[id].path, workspaces)]));
    // Hosts the stack already knows, plus the addresses drafted here, so calls to apps without an address yet are found too.
    const owners = new Map(Object.entries(hostsByApp(stack)).flatMap(([id, hosts]) => [...hosts].map(h => [h, id])));
    const firstPass = Object.fromEntries(Object.entries(repos).map(([id, modules]) => [id, draftApp(id, modules, stack, owners)]));
    for (const [id, envs] of Object.entries(firstPass))
        for (const d of Object.values(envs)) {
            const h = d.deployedUrl && hostOf(d.deployedUrl);
            if (h && !owners.has(h))
                owners.set(h, id);
        }
    const drafts = Object.fromEntries(Object.entries(repos).map(([id, modules]) => [id, draftApp(id, modules, stack, owners)]));
    const known = (id, env) => env === stack.envs[0] ? stack.apps[id].deployedUrl : stack.apps[id].envs?.[env]?.deployedUrl;
    for (const id of ids.length ? ids : Object.keys(stack.apps)) {
        const app = stack.apps[id], envs = drafts[id];
        console.log(`\n${app.name} (${id})`);
        if (!local[id]?.path) {
            console.log('  not cloned');
            continue;
        }
        if (!repos[id].length) {
            console.log('  no Terraform in its clone');
            continue;
        }
        if (!Object.keys(envs).length) {
            console.log(`  Terraform found, but none of its environments (${[...new Set(repos[id].map(m => m.token ?? 'unnamed'))].join(', ')}) matches the stack's (${stack.envs.join(', ')}); list them in envAliases`);
            continue;
        }
        const lines = Object.fromEntries(Object.entries(envs).map(([env, d]) => {
            const have = known(id, env), same = have && d.deployedUrl && hostOf(have) === hostOf(d.deployedUrl);
            return [env, [
                    `address   ${d.deployedUrl ?? 'not found'}${!d.deployedUrl ? (have ? `  (stack.json has ${have})` : '') : same ? '  (matches stack.json)' : have ? `  OTHER than stack.json: ${have}` : '  NEW'}`,
                    d.otherAddresses.length && `also      ${d.otherAddresses.join(', ')}`,
                    d.accounts.length && `account   ${d.accounts.join(', ')}`,
                    ...d.calls.map(c => `calls     ${c.to} through ${c.setting}${app.consumes?.[c.to] ? '  (in stack.json)' : '  NEW'}`),
                    d.settings.length && `settings  ${d.settings.join(', ')}`,
                    d.secretSettings.length && `settings that hold or point to a secret  ${d.secretSettings.join(', ')}`,
                    ...d.secrets.map(x => `${x.store === 'Secrets Manager' ? 'secret   ' : 'parameter'} ${x.name}`),
                    d.unnamedSecrets && `secrets   ${d.unnamedSecrets} more, named when deployed`,
                ].filter(Boolean)];
        }));
        // What every environment shares is printed once.
        const all = Object.values(lines), common = all.length > 1 ? all[0].filter(l => all.every(ls => ls.includes(l))) : [];
        for (const [env, ls] of Object.entries(lines)) {
            const own = ls.filter(l => !common.includes(l));
            if (own.length)
                console.log(`  ${env.toUpperCase()}`);
            for (const l of own)
                console.log(`    ${l}`);
        }
        if (common.length) {
            console.log('  EVERY ENVIRONMENT');
            for (const l of common)
                console.log(`    ${l}`);
        }
    }
    // Ready to copy into stack.json: only what it does not have yet.
    const suggestions = {};
    for (const [id, envs] of Object.entries(drafts))
        for (const [env, d] of Object.entries(envs)) {
            const target = env === stack.envs[0] ? (suggestions[id] ||= {}) : (((suggestions[id] ||= {}).envs ||= {})[env] ||= {});
            if (d.deployedUrl && !known(id, env))
                target.deployedUrl = d.deployedUrl;
            for (const c of d.calls)
                if (!stack.apps[id].consumes?.[c.to])
                    (target.consumes ||= {})[c.to] = { how: 'env', env: [c.setting], deployed: c.deployed };
        }
    for (const [id, x] of Object.entries(suggestions)) {
        for (const [env, e] of Object.entries(x.envs ?? {}))
            if (!Object.keys(e).length)
                delete x.envs[env];
        if (x.envs && !Object.keys(x.envs).length)
            delete x.envs;
        if (!Object.keys(x).length)
            delete suggestions[id];
    }
    const queues = linkQueues(drafts, stack);
    // Other apps whose code or settings name a queue: likely its other side, for the user to confirm.
    const named = q => [q.queue, ...Object.values(q.envs)].filter(Boolean).map(n => n.replace(/\.fifo$/, ''));
    const texts = Object.fromEntries(Object.keys(stack.apps).filter(id => local[id]?.path).map(id => [id, findFiles(local[id].path, n => /\.(json|cs|ts|js|py|go|java|kt|dart|yaml|yml|env)$/.test(n) && !/lock|\.min\./.test(n), 6)
            .map(f => { try {
            const st = fs.statSync(f);
            return st.size < 512 * 1024 ? fs.readFileSync(f, 'utf8') : '';
        }
        catch {
            return '';
        } }).join('\n')]));
    for (const q of queues)
        q.namedIn = Object.keys(texts).filter(id => ![...q.sends, ...q.reads].includes(id) && named(q).some(n => texts[id].includes(n)));
    if (queues.length) {
        console.log('\nQueues and topics');
        for (const q of queues) {
            const users = [...q.sends.map(a => `${stack.apps[a].name} sends`), ...q.reads.map(a => `${stack.apps[a].name} reads`), ...q.fedBy.map(f => `fed by ${f}`)];
            const missing = !q.inside && !q.fedBy.length ? (!q.reads.length ? ', reader not found' : !q.sends.length ? ', sender not found' : '') : '';
            if (q.namedIn.length)
                users.push(`named in ${q.namedIn.map(a => stack.apps[a].name).join(', ')}'s code`);
            console.log(`  ${q.queue ?? `${q.address} in ${stack.apps[q.owner].name}, named when deployed`} (${q.type.toUpperCase()})  ${users.join(', ') || 'no use found'}${missing}${q.inside ? `  (inside ${stack.apps[q.inside].name} only)` : inStack(q, stack) ? '  (in stack.json)' : '  NEW'}`);
        }
    }
    // Outside systems the apps reach, with the address each environment uses.
    const outside = {};
    for (const [id, envs] of Object.entries(drafts))
        for (const [provider, byEnv] of Object.entries(outsideCalls(local[id].path, envs, stack)))
            for (const [env, x] of Object.entries(byEnv)) {
                const o = ((outside[provider] ||= {})[env] ||= { hosts: new Set(), apps: {} });
                x.hosts.forEach(h => o.hosts.add(h));
                o.apps[id] = [...new Set([...(o.apps[id] ?? []), ...x.settings])];
            }
    const outsideSuggestions = { apps: {} };
    for (const [provider, byEnv] of Object.entries(outside)) {
        const def = OUTSIDE.find(o => o.id === provider), known = stack.apps[provider];
        console.log(`\n${def.name} (outside)${known ? '  (in stack.json)' : '  NEW'}`);
        for (const env of stack.envs.filter(e => byEnv[e]))
            console.log(`  ${env.toUpperCase()}  ${[...byEnv[env].hosts].join(', ')}  used by ${Object.keys(byEnv[env].apps).map(a => stack.apps[a].name).join(', ')}`);
        // The address each environment uses: the one most apps name.
        const pick = env => { const hs = [...(byEnv[env]?.hosts ?? [])]; return hs.length ? `https://${hs.sort((a, b) => b.length - a.length).find(h => /\.my\.site\.com$|\.my\.salesforce\.com$/.test(h)) ?? hs[0]}` : null; };
        if (!known) {
            const first = pick(stack.envs[0]), more = Object.fromEntries(stack.envs.slice(1).map(e => [e, pick(e)]).filter(([, u]) => u).map(([e, u]) => [e, { deployedUrl: u }]));
            outsideSuggestions.apps[provider] = { name: def.name, kind: 'other', outside: def.why, ...(first && { deployedUrl: first }), ...(Object.keys(more).length && { envs: more }) };
        }
        for (const env of Object.keys(byEnv))
            for (const [app, settings] of Object.entries(byEnv[env].apps))
                if (!stack.apps[app].consumes?.[provider])
                    ((outsideSuggestions.apps[app] ||= {}).consumes ||= {})[provider] = { how: 'env', env: settings.length ? settings : undefined };
    }
    const queueSuggestions = queueDraft(queues, stack);
    const file = path.join(TEMP, 'stack.deployed.json');
    fs.writeFileSync(file, JSON.stringify({ at: new Date().toISOString(), suggestions, queueSuggestions, outsideSuggestions, apps: drafts }, null, 2) + '\n');
    if (Object.keys(queueSuggestions.queues).length)
        console.log(`${Object.keys(queueSuggestions.queues).length} queues are new for stack.json (queueSuggestions in the draft).`);
    console.log(`\n${Object.keys(suggestions).length} apps have something new for stack.json. Draft for review: ${file}`);
}
if (process.argv[1] && fs.realpathSync(process.argv[1]) === fileURLToPath(import.meta.url))
    deployed(process.argv.slice(2));
//# sourceMappingURL=deployed.mjs.map