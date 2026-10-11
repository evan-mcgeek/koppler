// Session review, while Koppler itself is worked on (run from its source folder): after a full Stop and revert, everything
// the session left behind is gathered in one folder, and the agent is asked to find and fix the problems the user ran into.
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { redact } from './scrub.mjs';
const here = path.dirname(fileURLToPath(import.meta.url));
export const isDev = () => !fs.realpathSync(here).split(path.sep).join('/').includes('/plugins/cache/');
const read = f => { try {
    return fs.readFileSync(f, 'utf8');
}
catch {
    return '';
} };
const lastLines = (text, n) => text.trimEnd().split('\n').slice(-n).join('\n');
const jsonl = text => text.split('\n').map(l => { try {
    return JSON.parse(l);
}
catch {
    return null;
} }).filter(Boolean);
const PROBLEM = /\b(error|exception|failed|fatal|unhandled|refused|denied|timed? ?out)\b/i;
// The session is every run after the previous finished Stop, up to and with this one.
export function collectSession({ temp, logsDir, stop, runs }) {
    const at = runs.findIndex(r => r.id === stop.id);
    const before = runs.slice(0, at).findLastIndex(r => r.kind === 'stop' && r.state === 'done');
    const session = runs.slice(before + 1, at + 1), from = session[0]?.at ?? '', to = new Date().toISOString();
    const inRange = o => (o.at ?? '') >= from && (o.at ?? '') <= to;
    const dir = path.join(temp, 'sessions', stop.id);
    fs.mkdirSync(path.join(dir, 'logs'), { recursive: true });
    const write = (name, body) => fs.writeFileSync(path.join(dir, name), body, { mode: 0o600 });
    write('runs.json', JSON.stringify(session.map(({ layout, ...r }) => r), null, 2));
    const clicks = jsonl(read(path.join(temp, 'debug.jsonl'))).filter(inRange);
    write('debug.jsonl', clicks.map(o => JSON.stringify(o)).join('\n'));
    const messages = jsonl(read(path.join(temp, 'messages.jsonl'))).filter(o => !o.at || inRange(o));
    write('messages.jsonl', messages.map(o => JSON.stringify(o)).join('\n'));
    const ups = session.map(r => [r.id, redact(read(path.join(temp, `up-${r.id}.log`)))]).filter(([, t]) => t);
    for (const [id, t] of ups)
        write(`up-${id}.log`, t);
    const apps = [...new Set(session.flatMap(r => Object.keys(r.nodes ?? {})))];
    const appLogs = apps.map(id => [id, redact(lastLines(read(path.join(logsDir, `${id}.log.history`)) + read(path.join(logsDir, `${id}.log`)), 3000))]).filter(([, t]) => t.trim());
    for (const [id, t] of appLogs)
        fs.writeFileSync(path.join(dir, 'logs', `${id}.log`), t, { mode: 0o600 });
    write('canvas.log', redact(lastLines(read(path.join(logsDir, 'canvas.log')), 400)));
    // What went wrong, at a glance; the details are in the files next to it.
    const failed = session.filter(r => r.state === 'failed'), left = ups.filter(([, t]) => /Left for the agent:/.test(t));
    const pageErrors = clicks.filter(o => o.kind === 'error'), warnings = clicks.filter(o => o.kind === 'message');
    const questions = messages.filter(m => m.kind === 'question'), repeats = (() => {
        const n = {};
        for (const c of clicks.filter(c => c.kind === 'click'))
            n[c.what] = (n[c.what] ?? 0) + 1;
        return Object.entries(n).filter(([, k]) => k >= 4).sort((a, b) => b[1] - a[1]).slice(0, 8);
    })();
    const logProblems = appLogs.map(([id, t]) => [id, t.split('\n').filter(l => PROBLEM.test(l)).length]).filter(([, k]) => k);
    const lines = [`# Session ${from.slice(0, 16)} to ${to.slice(0, 16)}`, '',
        `${session.length} runs: ${['done', 'failed', 'replaced', 'applying', 'waiting'].map(s => [s, session.filter(r => r.state === s).length]).filter(([, k]) => k).map(([s, k]) => `${k} ${s}`).join(', ')}.`,
        ...failed.map(r => `- Failed ${r.kind} ${r.id}: ${r.reason ?? 'no reason given'}`),
        ...left.map(([id, t]) => `- Koppler left work for the agent in ${id}:\n${t.split('Left for the agent:')[1].trim().split('\n').map(l => `  ${l.trim()}`).join('\n')}`),
        `${questions.length} questions from the agent${questions.length ? `: ${questions.map(q => `"${q.title}"`).join('; ')}` : ''}.`,
        `${pageErrors.length} page errors${pageErrors.length ? `: ${pageErrors.slice(0, 5).map(e => e.what).join('; ')}` : ''}.`,
        `Messages the user saw: ${warnings.slice(-10).map(w => `"${w.what}"`).join('; ') || 'none'}.`,
        repeats.length ? `Clicked many times (a sign of something not working): ${repeats.map(([w, k]) => `${w} x${k}`).join('; ')}.` : 'Nothing clicked over and over.',
        logProblems.length ? `Error-like lines in app logs: ${logProblems.map(([id, k]) => `${id} ${k}`).join(', ')} (logs/).` : 'No error-like lines in app logs.',
    ];
    write('summary.md', lines.join('\n') + '\n');
    return dir;
}
// The previous log of an app is kept before a new run starts, so a session keeps every run's output (rolling, 5 MB).
export function keepPreviousLog(log) {
    try {
        const old = fs.readFileSync(log, 'utf8');
        if (!old.trim())
            return;
        const hist = `${log}.history`, joined = read(hist) + old + '\n';
        fs.writeFileSync(hist, joined.length > 5_000_000 ? joined.slice(-5_000_000) : joined, { mode: 0o600 });
    }
    catch { }
}
//# sourceMappingURL=session.mjs.map