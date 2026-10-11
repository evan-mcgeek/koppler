// Runs: every Send and Stop from the canvas is kept as a record (what was asked, the plan the user confirmed, how it ended),
// and the board last applied is kept as the live state the next plan is compared with. Names only, never secret values.
// Usage: koppler plan [--json]                      what the newest unapplied Send will do, checked against what is running
//        koppler history --done [<id>] [--failed <why>]    the agent finished (or gave up on) a run
//        koppler history                            recent runs and how they ended
import fs from 'node:fs';
import path from 'node:path';
import vm from 'node:vm';
import kp from './plan.cjs';
import { STATE, TEMP } from "./paths.js";
import { redact } from './scrub.mjs';
const temp = () => process.env.KOPPLER_TEMP || TEMP;
const stateDir = () => process.env.KOPPLER_STATE || STATE;
const historyFile = () => path.join(temp(), 'history.jsonl'), liveFile = () => path.join(temp(), 'live.json');
const ID = /^[a-z0-9-]{1,64}$/, RUN_ID = /^[a-z0-9]{6,40}$/, MAX_RUNS = 200;
const text = (v, max = 200) => typeof v === 'string' ? v.slice(0, max) : '';
const ids = list => (Array.isArray(list) ? list : []).filter(x => ID.test(x?.id ?? '')).slice(0, 100).map(x => ({ id: x.id, why: (Array.isArray(x.why) ? x.why : []).slice(0, 10).map(w => text(w, 200)) }));
// What is kept of a prompt from the canvas: only known fields, so the file cannot be used to store anything else.
export function runRecord(prompt) {
    const d = prompt?.data ?? {};
    if (!RUN_ID.test(d.id ?? ''))
        return null;
    const stop = prompt.tag === 'koppler-stop', b = kp.board(stop ? {} : d);
    // An app with nothing to run here (`outside` in the stack: a SaaS, a library, a config repo) is never part of a run.
    const reg = registry();
    const nodes = Object.fromEntries(Object.entries(b.nodes).filter(([id]) => ID.test(id) && !reg?.apps?.[id]?.outside).map(([id, n]) => [id, { branch: text(n.branch), run: text(n.run, 16), ...(n.platform && { platform: text(n.platform, 16) }), ...(n.note && { note: text(n.note, 4000) }), ...(n.tunnels === false && { tunnels: false }), ...(['set-aside', 'take-along'].includes(n.changes) && { changes: n.changes }), ...(Array.isArray(n.libraries) && n.libraries.length && { libraries: n.libraries.filter(l => typeof l === 'string' && /^[\w@./-]{1,100}$/.test(l)).slice(0, 20) }) }]));
    // Queues the board switched to a local copy; the rest stay the deployed ones.
    const queues = Object.fromEntries(Object.entries(d.queues ?? {}).filter(([q, v]) => ID.test(q) && v === 'local').slice(0, 50));
    return { id: d.id, at: prompt.at ?? new Date().toISOString(), kind: stop ? 'stop' : 'run', env: stop ? null : text(d.env, 16), mode: stop ? null : text(d.mode, 16), ...(d.note && { note: text(d.note, 4000) }),
        nodes, edges: b.edges.filter(e => nodes[e.from] && nodes[e.to]), ...(Object.keys(queues).length && { queues }), plan: { starts: ids(d.plan?.starts), restarts: ids(d.plan?.restarts), stops: ids(d.plan?.stops), keeps: ids(d.plan?.keeps) } };
}
export const appendRun = record => fs.appendFileSync(historyFile(), JSON.stringify(record) + '\n', { mode: 0o600 });
export const appendEvent = (id, event, reason) => fs.appendFileSync(historyFile(), JSON.stringify({ id, event, at: new Date().toISOString(), ...(reason && { reason: text(reason, 500) }) }) + '\n', { mode: 0o600 });
// The code changes in the action log, as removed and added lines per app and file, for the History's diffs.
// Kept with the run, so a past run still shows them after a revert. Bounded, and passed through `clean` (secret redaction).
const CODE_KINDS = ['edit', 'profile', 'env-file', 'checkout'];
export function codeChanges(actions, { clean = x => x, profileEnv = () => null } = {}) {
    const lines = v => String(v ?? '').split('\n').slice(0, 60).map(l => clean(l).slice(0, 300));
    const env = o => o && typeof o === 'object' ? Object.entries(o).slice(0, 60).map(([k, v]) => clean(`${k}=${v}`).slice(0, 300)) : [];
    return (Array.isArray(actions) ? actions : []).filter(a => CODE_KINDS.includes(a?.kind)).slice(0, 40).map(a => {
        const base = { app: text(a.app ?? a.repo, 64), kind: a.kind, file: text(a.file, 300) };
        if (a.kind === 'edit')
            return { ...base, title: 'Temporary edit', removed: lines(a.before), added: lines(a.after) };
        if (a.kind === 'env-file')
            return { ...base, title: a.created ? 'New file' : 'Lines added', removed: [], added: (Array.isArray(a.lines) ? a.lines : lines(a.lines)).slice(0, 60).map(l => clean(String(l)).slice(0, 300)) };
        if (a.kind === 'checkout')
            return { ...base, title: 'Branch switched', removed: [text(a.from)], added: [text(a.to)] };
        return { ...base, title: `${a.created ? 'New' : 'Changed'} launch profile ${text(a.name, 80)}`, removed: env(a.previous), added: env(profileEnv(a)) };
    });
}
// Runs oldest first, each with its state: waiting (nobody picked it up), applying, done, failed, or replaced by a newer Send before it was picked up.
export function readRuns(raw) {
    const runs = new Map();
    for (const line of String(raw ?? '').split('\n')) {
        let o;
        try {
            o = JSON.parse(line);
        }
        catch {
            continue;
        }
        if (!o || !RUN_ID.test(o.id ?? ''))
            continue;
        if (o.event) {
            const r = runs.get(o.id);
            if (r)
                Object.assign(r, o.event === 'picked' ? { state: r.state === 'waiting' ? 'applying' : r.state } : { state: o.event === 'failed' ? 'failed' : 'done', endedAt: o.at, ...(Array.isArray(o.changes) && { changes: o.changes }), ...(o.reason && { reason: o.reason }) });
        }
        else if (o.nodes)
            runs.set(o.id, { ...o, state: 'waiting' });
    }
    const list = [...runs.values()];
    // A waiting Send is replaced by any newer one; one being applied only by a newer one the agent picked up.
    list.forEach((r, i) => { const later = list.slice(i + 1); if ((r.state === 'waiting' && later.some(n => n.kind)) || (r.state === 'applying' && later.some(n => n.kind && n.state !== 'waiting' && n.state !== 'replaced')))
        r.state = 'replaced'; });
    return list.slice(-MAX_RUNS);
}
export const runs = () => { try {
    return readRuns(fs.readFileSync(historyFile(), 'utf8'));
}
catch {
    return [];
} };
export const live = () => { try {
    return JSON.parse(fs.readFileSync(liveFile(), 'utf8'));
}
catch {
    return null;
} };
// What a listener hands the agent from the queue: of the Sends and Stops only the newest (it replaces the rest, which then
// show as replaced), every other prompt as it is; each with the minutes it waited, so a stale one is asked about first.
export function pickPrompts(lines, now = Date.now()) {
    const all = lines.map(l => { try {
        return JSON.parse(l);
    }
    catch {
        return null;
    } }).filter(Boolean);
    const boards = all.filter(p => p.tag === 'koppler' || p.tag === 'koppler-stop'), newest = boards.at(-1);
    return all.filter(p => !boards.includes(p) || p === newest).map(p => ({ ...p, waited: Math.max(0, Math.round((now - Date.parse(p.at ?? '')) / 60000)) || 0 }));
}
// What Koppler is running right now (apps, tunnels, the canvas), with the environment a stack app was started on by id.
function runningRecords() {
    const dir = path.join(stateDir(), 'procs');
    try {
        return fs.readdirSync(dir).filter(f => f.endsWith('.json')).map(f => { try {
            return JSON.parse(fs.readFileSync(path.join(dir, f), 'utf8'));
        }
        catch {
            return null;
        } })
            .filter(r => r?.pid && (() => { try {
            process.kill(r.pid, 0);
            return true;
        }
        catch {
            return false;
        } })());
    }
    catch {
        return [];
    }
}
export const runningNames = () => runningRecords().map(r => r.name);
export const runningEnvs = () => Object.fromEntries(runningRecords().filter(r => r.env).map(r => [r.name, r.env]));
// The part of a board that really runs: apps Koppler runs now, and apps the user starts in an IDE; `off` lists the rest.
export function runningPart(board, names = runningNames()) {
    const on = id => names.includes(id) || board.nodes[id]?.run === 'ide';
    const nodes = Object.fromEntries(Object.entries(board.nodes ?? {}).filter(([id]) => on(id)));
    return { nodes, edges: (board.edges ?? []).filter(e => nodes[e.from] && nodes[e.to]), off: Object.keys(board.nodes ?? {}).filter(id => !on(id)) };
}
// Apps Koppler runs that the applied board does not explain.
export const strays = (liveBoard, names, appIds) => names.filter(n => appIds.includes(n) && !liveBoard?.nodes?.[n]);
const registry = () => { try {
    const sandbox = { window: {} };
    vm.runInNewContext(fs.readFileSync(path.join(temp(), 'registry.js'), 'utf8'), sandbox);
    return sandbox.window.REGISTRY;
}
catch {
    return null;
} };
const fail = message => { console.error(`koppler: ${message}`); process.exit(1); };
// The plan for the newest Send that has not been applied, worked out again now, and whether it is still what the user confirmed.
// What running a board would start, restart, stop and keep, against what runs now.
export function planFor(board) {
    const reg = registry(), names = runningNames(), envs = runningEnvs(), liveBoard = live();
    return kp.plan(liveBoard, board, { name: id => reg?.apps?.[id]?.name ?? id, running: id => names.includes(id), strays: strays(liveBoard, names, Object.keys(reg?.apps ?? {})), startedOn: id => envs[id], queuesOf: id => kp.queuesOf(reg, id) });
}
export function currentPlan() {
    const all = runs(), run = [...all].reverse().find(r => r.kind === 'run' && (r.state === 'waiting' || r.state === 'applying'));
    if (!run)
        return null;
    const reg = registry(), plan = planFor(run);
    return { run, plan, confirmed: kp.same(plan, run.plan), name: id => reg?.apps?.[id]?.name ?? id };
}
export function planCommand(args) {
    const p = currentPlan();
    if (!p)
        return console.log('No Send is waiting to be applied.');
    if (args.includes('--json'))
        return console.log(JSON.stringify({ id: p.run.id, env: p.run.env, mode: p.run.mode, confirmed: p.confirmed, plan: p.plan, asConfirmed: p.run.plan }, null, 2));
    console.log(`Run ${p.run.id} on ${String(p.run.env).toUpperCase()} (${p.run.mode}), sent ${p.run.at}`);
    for (const line of kp.describe(p.plan, { name: p.name }))
        console.log(`  ${line}`);
    console.log(p.confirmed ? '  This is what the user confirmed on the canvas.'
        : `  DIFFERS from what the user confirmed (${kp.describe(p.run.plan, { name: p.name }).join(' | ')}): things changed since. Tell the user and ask before doing anything.`);
}
// The environment variables a launch profile has right now, read from the app's clone.
function profileEnvIn(local) {
    return a => {
        try {
            const repo = local?.apps?.[a.app]?.path, file = path.isAbsolute(a.file ?? '') ? a.file : repo && path.join(repo, a.file);
            return JSON.parse(fs.readFileSync(file, 'utf8').replace(/^\uFEFF/, '')).profiles?.[a.name]?.environmentVariables ?? null;
        }
        catch {
            return null;
        }
    };
}
const localClones = () => { try {
    const sandbox = { window: {} };
    vm.runInNewContext(fs.readFileSync(path.join(temp(), 'local.js'), 'utf8'), sandbox);
    return sandbox.window.LOCAL;
}
catch {
    return null;
} };
export async function appliedCommand(args) {
    const failAt = args.indexOf('--failed'), reason = failAt >= 0 ? args[failAt + 1] : null, given = args.find((a, i) => !a.startsWith('--') && (failAt < 0 || i !== failAt + 1));
    const all = runs(), run = given ? all.find(r => r.id === given) : [...all].reverse().find(r => r.state === 'waiting' || r.state === 'applying');
    if (!run)
        fail(given ? `no run ${given} in the history` : 'no run is waiting to be applied');
    if (failAt >= 0 && !reason)
        fail('say why: koppler history --done --failed "<what went wrong>"');
    // The code changes in effect after this run are kept with it; ones a previous run already showed are not marked new.
    let changes = [];
    try {
        const seen = new Set(all.filter(r => r.id !== run.id).flatMap(r => r.changes ?? []).map(c => JSON.stringify({ ...c, fresh: undefined })));
        changes = codeChanges(JSON.parse(fs.readFileSync(path.join(temp(), 'actions.json'), 'utf8')), { clean: redact, profileEnv: profileEnvIn(localClones()) })
            .map(c => ({ ...c, ...(!seen.has(JSON.stringify(c)) && { fresh: true }) }));
    }
    catch { /* no action log yet: nothing was changed */ }
    // How each remembered change did on this Mac, and when; private, never in the shared stack.
    try {
        const { markRuns } = await import('./recipes.mjs');
        markRuns(path.join(temp(), 'actions.json'), failAt < 0);
    }
    catch { }
    fs.appendFileSync(historyFile(), JSON.stringify({ id: run.id, event: failAt >= 0 ? 'failed' : 'done', at: new Date().toISOString(), ...(reason && { reason: text(reason, 500) }), ...(changes.length && { changes }) }) + '\n', { mode: 0o600 });
    // The live state is what really runs from this board, done or failed: what Koppler runs, and what the user starts in an IDE.
    // An app that did not start is left out and named, so the next Send starts it instead of keeping a ghost.
    const { nodes, edges, off } = runningPart(run);
    fs.writeFileSync(liveFile(), JSON.stringify({ id: run.id, at: new Date().toISOString(), env: run.env, nodes, edges, ...(run.queues && { queues: run.queues }) }, null, 2) + '\n', { mode: 0o600 });
    // While Koppler itself is worked on, a finished Stop ends a session: it is gathered, and the agent is asked to review it.
    if (run.kind === 'stop' && failAt < 0)
        try {
            const { isDev, collectSession } = await import('./session.mjs');
            if (isDev()) {
                const dir = collectSession({ temp: temp(), logsDir: path.join(stateDir(), 'logs'), stop: run, runs: runs() });
                fs.appendFileSync(path.join(temp(), 'prompts.jsonl'), JSON.stringify({ tag: 'koppler-review', at: new Date().toISOString(), text: `The session ended with a full Stop. Review it using the koppler-run skill: read ${dir}/summary.md and the files next to it, find every problem the user ran into, fix them in Koppler, verify each fix, and report.`, data: { dir } }) + '\n', { mode: 0o600 });
                console.log(`Session gathered in ${dir}; a review request is queued for the agent.`);
            }
        }
        catch (e) {
            console.error(`koppler: could not gather the session (${e.message})`);
        }
    console.log(`${run.kind === 'stop' ? 'Stop' : 'Run'} ${run.id}: ${failAt >= 0 ? `failed (${reason})` : 'done'}; live state is now ${Object.keys(nodes).length ? Object.keys(nodes).join(', ') : 'empty'}`);
    if (off.length) {
        const reg = registry();
        console.log(`Not running: ${off.map(id => reg?.apps?.[id]?.name ?? id).join(', ')}. The next Send starts ${off.length === 1 ? 'it' : 'them'} again.`);
    }
}
export function historyCommand(args = []) {
    const all = runs().slice(-15);
    if (args.includes('--json'))
        return console.log(JSON.stringify(all, null, 2));
    if (!all.length)
        return console.log('No runs yet.');
    for (const r of all)
        console.log(`${r.at}  ${r.id}  ${r.kind === 'stop' ? 'stop and revert' : `${String(r.env).toUpperCase()} ${r.mode}: ${Object.keys(r.nodes).join(', ')}`}  [${r.state}${r.reason ? `: ${r.reason}` : ''}]`);
}
//# sourceMappingURL=runs.mjs.map