// Messages from the agent to the canvas, and the user's answers back. Plain text only: the canvas never renders them as code.
// Usage: koppler say [--file <json>]        a message, as JSON on stdin or in a file (see sanitizeMessage)
//        koppler say --answered <id> [--text <how>]   the user answered in the chat instead; the canvas shows it as answered
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { runs } from './runs.mjs';
import { TEMP } from "./paths.js";
const file = () => path.join(process.env.KOPPLER_TEMP || TEMP, 'messages.jsonl');
const text = (v, max) => typeof v === 'string' ? v.trim().slice(0, max) : '';
const KINDS = ['question', 'result', 'failure', 'info'];
// { kind, title, summary?, run?, apps?: [ids], sections?: [{ title, items: [text], commands?: [text] }], choices?: [{ id, label, detail? }] }
// A section's `commands` are what the user runs in their own terminal; the canvas shows each in a box with a Copy button.
export function sanitizeMessage(input) {
    if (!input || typeof input !== 'object')
        return { error: 'a message is a JSON object' };
    const title = text(input.title, 120);
    if (!title)
        return { error: 'a message needs a title' };
    const kind = KINDS.includes(input.kind) ? input.kind : (Array.isArray(input.choices) && input.choices.length ? 'question' : 'info');
    const sections = (Array.isArray(input.sections) ? input.sections : []).slice(0, 8).map(s => ({ title: text(s?.title, 80), items: (Array.isArray(s?.items) ? s.items : []).slice(0, 12).map(i => text(i, 400)).filter(Boolean),
        commands: (Array.isArray(s?.commands) ? s.commands : []).slice(0, 6).map(c => text(c, 1000)).filter(Boolean) })).map(({ commands, ...s }) => ({ ...s, ...(commands.length && { commands }) })).filter(s => s.title || s.items.length || s.commands);
    const choices = (Array.isArray(input.choices) ? input.choices : []).slice(0, 6).map((c, i) => ({ id: /^[a-z0-9-]{1,32}$/.test(c?.id ?? '') ? c.id : String(i + 1), label: text(c?.label, 80), ...(text(c?.detail, 300) && { detail: text(c.detail, 300) }) })).filter(c => c.label);
    return { message: { kind, title, ...(text(input.summary, 800) && { summary: text(input.summary, 800) }), ...(/^[a-z0-9]{6,40}$/.test(input.run ?? '') && { run: input.run }),
            ...(Array.isArray(input.apps) && { apps: input.apps.filter(a => /^[a-z0-9-]{1,64}$/.test(a ?? '')).slice(0, 30) }), ...(sections.length && { sections }), ...(choices.length && { choices }) } };
}
export const appendMessage = message => {
    const entry = { id: crypto.randomBytes(6).toString('hex'), at: new Date().toISOString(), ...message };
    fs.mkdirSync(path.dirname(file()), { recursive: true });
    fs.appendFileSync(file(), JSON.stringify(entry) + '\n', { mode: 0o600 });
    return entry;
};
export const appendAnswer = (id, answer) => fs.appendFileSync(file(), JSON.stringify({ answer: id, at: new Date().toISOString(), ...answer }) + '\n', { mode: 0o600 });
// The latest messages, each with its answer when there is one. A question about a run a newer Send replaced is closed.
export function readMessages(limit = 20, history = runs()) {
    let raw;
    try {
        raw = fs.readFileSync(file(), 'utf8');
    }
    catch {
        return [];
    }
    const list = [], byId = new Map();
    for (const line of raw.split('\n')) {
        let o;
        try {
            o = JSON.parse(line);
        }
        catch {
            continue;
        }
        if (o.answer) {
            const m = byId.get(o.answer);
            if (m && !m.answered)
                m.answered = { at: o.at, ...(o.choice && { choice: o.choice }), ...(o.text && { text: o.text }), via: o.via ?? 'canvas' };
        }
        else if (o.id && o.title) {
            byId.set(o.id, o);
            list.push(o);
        }
    }
    const order = history.map(r => r.id);
    for (const m of list) {
        const i = order.indexOf(m.run);
        if (m.kind === 'question' && !m.answered && i >= 0 && i < order.length - 1)
            m.answered = { at: history[i + 1].at, via: 'replaced' };
    }
    return list.slice(-limit);
}
// Clears the panel's history. A question still waiting for an answer is kept, so the agent's open question is never lost.
export function clearMessages() {
    const keep = readMessages(1000).filter(m => m.kind === 'question' && !m.answered).map(({ answered, ...m }) => m);
    fs.writeFileSync(file(), keep.map(m => JSON.stringify(m) + '\n').join(''), { mode: 0o600 });
    return { cleared: true, kept: keep.length };
}
export function sayCommand(args) {
    const at = name => { const i = args.indexOf(name); return i >= 0 ? args[i + 1] : undefined; };
    if (args.includes('--answered')) {
        const id = at('--answered');
        if (!readMessages(200).some(m => m.id === id)) {
            console.error(`koppler: no message ${id}`);
            process.exit(1);
        }
        appendAnswer(id, { text: text(at('--text') ?? 'answered in the chat', 400), via: 'chat' });
        return console.log(`Marked ${id} as answered.`);
    }
    let input;
    try {
        input = JSON.parse(at('--file') ? fs.readFileSync(at('--file'), 'utf8') : fs.readFileSync(0, 'utf8'));
    }
    catch {
        console.error('koppler: give the message as JSON on stdin or with --file');
        process.exit(1);
    }
    const r = sanitizeMessage(input);
    if (r.error) {
        console.error(`koppler: ${r.error}`);
        process.exit(1);
    }
    console.log(`Shown on the canvas as ${appendMessage(r.message).id}`);
}
//# sourceMappingURL=messages.mjs.map