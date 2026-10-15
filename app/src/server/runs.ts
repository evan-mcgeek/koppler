// Runs from the canvas: a Send or a Stop is recorded, then carried out by Koppler itself (`koppler up` or `koppler down`),
// and whatever it cannot do alone is queued for the agent, as is anything the agent must handle.
import { execFile, spawn } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { appendRun, runRecord, type RunRecord } from '../engine/history.ts';
import { answerProposal } from '../engine/boards.ts';
import { appendAnswer, appendMessage, readMessages, refusal } from '../engine/messages.ts';
import { CODE, tempDir } from '../paths.ts';
import { tail } from './logs.ts';
import { sanitizePrompt, type Prompt } from './sanitize.ts';

type Loose = Record<string, unknown>;
/** How a request is answered; `after` runs once the answer has been sent. */
export interface Answer {
  status: number;
  body?: unknown;
  after?: () => void;
}
const PROMPTS = path.join(tempDir(), 'prompts.jsonl');
const stamp = () => new Date().toISOString();
const appendLine = (file: string, line: object) => {
  fs.appendFileSync(file, JSON.stringify(line) + '\n', { mode: 0o600 });
};
/** Runs a koppler command of this same build; gives what it printed and whether it failed. */
export const koppler = (args: string[], timeout: number) =>
  new Promise<{ failed: boolean; out: string; said: string }>(resolve => {
    const options = { timeout, maxBuffer: 1 << 20 };
    execFile(process.execPath, [path.join(CODE, 'koppler.mjs'), ...args], options, (error, out, said) => {
      resolve({ failed: !!error, out, said });
    });
  });
/** Loads the stack again after it changed; `unloaded` is what to say when that fails. */
export async function reload(unloaded: string, done: unknown = { ok: true }): Promise<Answer> {
  const { failed } = await koppler(['sync'], 120000);
  return failed ? { status: 500, body: { error: unloaded } } : { status: 200, body: done };
}

/** A confirmed Send (koppler up) or Stop and revert (koppler down), carried out by Koppler itself; leftovers go to the agent. */
function startRun(prompt: Prompt, record: RunRecord, command: 'up' | 'down'): void {
  const log = path.join(tempDir(), `up-${record.id}.log`);
  const out = fs.openSync(log, 'w', 0o600);
  appendLine(path.join(tempDir(), 'history.jsonl'), { id: record.id, event: 'picked', at: stamp() });
  const entry = path.join(CODE, 'koppler.mjs');
  const child = spawn(process.execPath, [entry, command, '--run', record.id], {
    stdio: ['ignore', out, out],
    env: process.env,
  });
  child.on('error', error => {
    fs.closeSync(out);
    appendMessage(refusal(record.id, record.kind, `Koppler could not start: ${error.message}`));
  });
  child.on('exit', code => {
    fs.closeSync(out);
    // A Stop from switching stacks switches once everything is stopped and reverted.
    const switchTo = prompt.data['switchTo'];
    if (code === 0 && record.kind === 'stop' && typeof switchTo === 'string') void koppler(['use', switchTo], 60000);
    if (code === 0) return;
    // The log may have gone with a Stop: the exit code still tells.
    const said = tail(log, 64 * 1024, 40)?.trim() ?? '';
    // Said on the canvas too: with no agent connected, the prompt below is read by nobody.
    appendMessage(refusal(record.id, record.kind, said));
    const finish = `koppler history done ${record.kind === 'stop' ? record.id : ''}`;
    const text = `${prompt.text}\n\nKoppler already did what it could (koppler ${command} --run ${record.id}); finish the rest, then ${finish}:\n${said}`;
    appendLine(PROMPTS, { ...prompt, text, data: { ...prompt.data, koppler: { exit: code, log } } });
  });
}

/** A Send, a Stop, or an answer from the page. */
export function prompted(body: Loose): Answer {
  const prompt = sanitizePrompt(body);
  if (!prompt) return { status: 400 };
  // An answer to a question on the canvas: only for a message that exists and has no answer yet.
  if (prompt.tag === 'koppler-reply') {
    const message = readMessages(200).find(one => one.id === prompt.data['message']);
    if (!message || message.answered) return { status: 409 };
    const choice = message.choices?.find(one => one.id === prompt.data['choice']);
    const said = typeof prompt.data['text'] === 'string' ? prompt.data['text'].slice(0, 2000) : '';
    if (!choice && !said) return { status: 400 };
    prompt.data = {
      message: message.id,
      ...(message.run && { run: message.run }),
      ...(choice && { choice: choice.id, label: choice.label }),
      ...(said && { text: said }),
    };
    appendAnswer(message.id, { ...(choice && { choice: choice.id }), ...(said && { text: said }) });
    // A board change the agent proposed: made as soon as the user says yes, so the agent only hears how it went.
    if (choice) {
      let done: string | null;
      try {
        done = answerProposal(message.id, choice.id === 'accept');
      } catch (error) {
        done = `It could not be made: ${(error as Error).message}`;
        appendMessage({ kind: 'failure', title: done.slice(0, 120) });
      }
      if (done) prompt.data['result'] = done;
    }
  }
  // Kept as a run from the moment it is sent, so a Send nobody picked up still shows on the canvas.
  const record = runRecord(prompt);
  if (record) appendRun(record);
  // A confirmed Send in auto mode: Koppler starts it itself. Only what it cannot do alone goes on to the agent.
  const { mode, note, nodes } = prompt.data;
  const noted = (Array.isArray(nodes) ? (nodes as (Loose | null)[]) : []).some(node => node?.['note']);
  const byAgent = mode === 'manual' || !!note || noted;
  if (record?.kind === 'run' && !byAgent) startRun(prompt, record, 'up');
  else if (record?.kind === 'stop') startRun(prompt, record, 'down');
  else appendLine(PROMPTS, prompt);
  return { status: 204 };
}
