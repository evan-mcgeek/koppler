// What the page can ask the server to do: one function per address, each given the request's JSON body and answering
// with a status and, usually, a JSON body.
import { execFile, spawn } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { readStack, writeData } from '../data.ts';
import { applyFindings, current as currentFindingsStack, discover } from '../engine/discover.ts';
import { editDone } from '../engine/boards.ts';
import { discardChanges, linkStack, proposeChanges, updateStack } from '../engine/linked.ts';
import { listenerPid } from '../engine/listen.ts';
import { setLock } from '../engine/locks.ts';
import { appendAnswer, appendMessage, clearMessages, readMessages, refusal } from '../engine/messages.ts';
import { appendNote, appendRun, runRecord, type RunRecord } from '../engine/runs.ts';
import {
  addApps,
  addOutside,
  createStack,
  editStack,
  currentStack,
  forgetStacks,
  removeApp,
  refreshRegistry,
  replaceStack,
  saveStack,
  stackSource,
  useStack,
} from '../engine/sync.ts';
import { CODE, TEMP } from '../paths.ts';
import { redact } from '../scrub.ts';
import { cableTest } from './cable-test.ts';
import { appendDebugLog, clearDebugLog } from './logs.ts';
import { fetchPresets, sanitizeLayout, sanitizePrompt, type Prompt } from './sanitize.ts';
import { secretRequest } from './secrets.ts';
import { drop } from './waiting.ts';

type Loose = Record<string, unknown>;
/** How a request is answered; `after` runs once the answer has been sent. */
export interface Answer {
  status: number;
  body?: unknown;
  after?: () => void;
}
type Route = (body: Loose) => Answer | Promise<Answer>;

const PROMPTS = path.join(TEMP, 'prompts.jsonl');
const APP_ID = /^[a-z0-9-]{1,64}$/;
const isApp = (value: unknown): value is string => typeof value === 'string' && APP_ID.test(value);
const stamp = () => new Date().toISOString();
const appendLine = (file: string, line: object) => {
  fs.appendFileSync(file, JSON.stringify(line) + '\n', { mode: 0o600 });
};
/** What a failed result says, as the answer; undefined when the result is not a failure. */
const refused = (result: { error?: string | undefined }): Answer | undefined =>
  result.error === undefined ? undefined : { status: 400, body: result };

/** Runs a koppler command of this same build; gives what it printed and whether it failed. */
const koppler = (args: string[], timeout: number) =>
  new Promise<{ failed: boolean; out: string; said: string }>(resolve => {
    const options = { timeout, maxBuffer: 1 << 20 };
    execFile(process.execPath, [path.join(CODE, 'koppler.mjs'), ...args], options, (error, out, said) => {
      resolve({ failed: !!error, out, said });
    });
  });
/** Loads the stack again after it changed; `unloaded` is what to say when that fails. */
async function reload(unloaded: string, done: unknown = { ok: true }): Promise<Answer> {
  const { failed } = await koppler(['sync'], 120000);
  return failed ? { status: 500, body: { error: unloaded } } : { status: 200, body: done };
}

/** A confirmed Send (koppler up) or Stop and revert (koppler down), carried out by Koppler itself; leftovers go to the agent. */
function startRun(prompt: Prompt, record: RunRecord, command: 'up' | 'down'): void {
  const log = path.join(TEMP, `up-${record.id}.log`);
  const out = fs.openSync(log, 'w', 0o600);
  appendLine(path.join(TEMP, 'history.jsonl'), { id: record.id, event: 'picked', at: stamp() });
  const entry = path.join(CODE, 'koppler.mjs');
  const child = spawn(process.execPath, [entry, command, '--run', record.id], {
    stdio: ['ignore', out, out],
    env: process.env,
  });
  child.on('exit', code => {
    fs.closeSync(out);
    // A Stop from switching stacks switches once everything is stopped and reverted.
    const switchTo = prompt.data['switchTo'];
    if (code === 0 && record.kind === 'stop' && typeof switchTo === 'string') void koppler(['use', switchTo], 60000);
    if (code === 0) return;
    let said = '';
    try {
      said = redact(fs.readFileSync(log, 'utf8')).trim().split('\n').slice(-40).join('\n');
    } catch {
      // The log went with a Stop: the exit code still tells.
    }
    // Said on the canvas too: with no agent connected, the prompt below is read by nobody.
    appendMessage(refusal(record.id, record.kind, said));
    const finish = `koppler history done ${record.kind === 'stop' ? record.id : ''}`;
    const text = `${prompt.text}\n\nKoppler already did what it could (koppler ${command} --run ${record.id}); finish the rest, then ${finish}:\n${said}`;
    appendLine(PROMPTS, { ...prompt, text, data: { ...prompt.data, koppler: { exit: code, log } } });
  });
}

/** A Send, a Stop, or an answer from the page. */
function prompted(body: Loose): Answer {
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

/** The linked stack in use: bring in GitHub's changes, drop this copy's, or propose them as a pull request. */
const linked =
  (work: (dir: string) => Promise<{ error?: string | undefined }>, thenReload: boolean): Route =>
  async () => {
    // With no stack in use there is nothing linked: the work fails on the missing folder, and the request with it.
    const result = await work(currentStack() as string);
    if (result.error !== undefined || !thenReload)
      return { status: result.error === undefined ? 200 : 400, body: result };
    await koppler(['sync'], 120000);
    return { status: 200, body: result };
  };

/** Findings are worked out again here, so only what Koppler itself found can be written, and only what the user ticked. */
const found =
  (apply: boolean): Route =>
  async body => {
    const stack = currentFindingsStack();
    if (!stack) return { status: 400, body: { error: 'No stack is in use.' } };
    let findings;
    try {
      findings = discover(stack.stack, stack.clones);
    } catch {
      return { status: 500, body: { error: 'Looking through the repos failed. Run koppler discover to see why.' } };
    }
    if (!apply) return { status: 200, body: { findings } };
    const ids = Array.isArray(body['ids']) ? (body['ids'] as unknown[]).filter(id => typeof id === 'string') : [];
    const applied = applyFindings(stack.stack, findings, ids);
    if (applied.error !== undefined) return { status: 400, body: applied };
    const refused = saveStack(stack.source, JSON.parse(fs.readFileSync(stack.source, 'utf8')), applied.stack);
    if (refused) return { status: 400, body: refused };
    forgetStacks();
    await koppler(['sync'], 120000);
    return { status: 200, body: { applied: applied.applied } };
  };

// Tests of the same tunnel wait for each other: a tunnel drops connections when several open at once.
const tunnelLanes = new Map<string, Promise<unknown>>();

const secret =
  (action: 'set' | 'remove' | 'test'): Route =>
  async body => {
    const { status, body: answer } = await secretRequest(action, body);
    return { status, body: answer };
  };

export const ROUTES: Record<string, Route> = {
  '/state': body => {
    const layout = sanitizeLayout(body);
    if (!layout) return { status: 400 };
    writeData('state', layout);
    return { status: 204 };
  },
  '/board-edit-done': body => {
    editDone(body['id']);
    return { status: 204 };
  },
  '/prompt': prompted,
  '/preset': async body => {
    const result = await fetchPresets(typeof body['url'] === 'string' ? body['url'].slice(0, 500) : '');
    return { status: result.error === undefined ? 200 : 400, body: result };
  },
  '/discover': found(false),
  '/discover-apply': found(true),
  '/stack': async body => {
    const { link, use } = body;
    if (typeof link === 'string') {
      const result = await linkStack(link.slice(0, 500));
      forgetStacks();
      return refused(result) ?? reload('The stack was linked, but could not be loaded. Run koppler sync.');
    }
    // A new stack from the canvas: only a name and environment names; it is created empty and loaded.
    const result = typeof use === 'string' ? useStack(use) : createStack(body);
    return refused(result) ?? reload('The stack was created, but could not be loaded. Run koppler sync.');
  },
  '/stack-update': linked(dir => updateStack(dir), true),
  '/stack-discard': linked(dir => Promise.resolve(discardChanges(dir)), true),
  '/stack-pr': linked(dir => proposeChanges(dir), false),
  // Clones the user picked on the canvas join stack.json as apps that are not set up yet; then the stack is loaded again.
  '/apps': body => {
    const result = addApps(body['apps']);
    forgetStacks();
    if (result.error !== undefined || !result.added.length)
      return { status: 400, body: { error: result.error ?? 'Pick at least one repo that is not in the stack yet.' } };
    return reload('The apps were added, but the stack could not be loaded again. Run koppler sync.', result);
  },
  // One field of the stack, set or taken out, checked as the terminal's koppler stack set is.
  '/stack-edit': body => {
    const at = typeof body['path'] === 'string' ? body['path'] : '';
    const result = editStack(at, body['unset'] === true ? undefined : [body['value']]);
    if (result.error !== undefined) return { status: 400, body: result };
    // One field: the registry is copied again on the spot, without a full sync.
    refreshRegistry();
    forgetStacks();
    return { status: 200, body: result };
  },
  // A settings panel's Save: the whole edited stack, checked and written at once, or refused with each problem.
  '/stack-save': body => {
    const result = replaceStack(body['stack']);
    if (result.error !== undefined) return { status: 400, body: result };
    refreshRegistry();
    forgetStacks();
    return { status: 200, body: { ok: true } };
  },
  // The canvas's lock on a field: the person's own click, so it locks and unlocks.
  '/stack-lock': body => {
    const source = stackSource();
    if (!source || typeof body['path'] !== 'string')
      return { status: 400, body: { error: 'No stack or no field given' } };
    const done = setLock(source, body['path'], body['on'] === true);
    return done.error === undefined ? { status: 200, body: { ok: true } } : { status: 400, body: done };
  },
  '/apps-outside': body => {
    const result = addOutside(body);
    forgetStacks();
    return (
      refused(result) ??
      reload('The outside system was added, but the stack could not be loaded again. Run koppler sync.', result)
    );
  },
  '/apps-remove': body => {
    const result = isApp(body['id']) ? removeApp(body['id']) : { error: 'No app given' };
    forgetStacks();
    return refused(result) ?? reload('The stack changed, but reloading it failed: run koppler sync', result);
  },
  // Looks through the user's folders for clones again, as `koppler sync --rescan` does.
  '/rescan': async () => {
    const { failed, said } = await koppler(['sync', '--rescan'], 120000);
    const why =
      said
        .trim()
        .split('\n')
        .pop()
        ?.replace(/^koppler: /, '') || 'The scan did not finish.';
    return failed ? { status: 500, body: { error: why } } : { status: 200, body: { ok: true } };
  },
  // What the user has to do before these apps run on this environment, worked out live by `koppler doctor`.
  '/needs': async body => {
    const ids = (Array.isArray(body['apps']) ? (body['apps'] as unknown[]) : []).filter(isApp).slice(0, 50);
    const env = typeof body['env'] === 'string' && /^[a-z0-9-]{1,16}$/.test(body['env']) ? body['env'] : null;
    if (!ids.length || !env) return { status: 400, body: { error: 'No apps or environment given' } };
    const asked = Array.isArray(body['noTunnels']) ? (body['noTunnels'] as unknown[]) : [];
    const off = ids.filter(id => asked.includes(id));
    const { out } = await koppler(
      ['doctor', ...ids, '--env', env, ...(off.length ? ['--no-tunnels', off.join(',')] : []), '--json'],
      30000,
    );
    try {
      return { status: 200, body: JSON.parse(out) as unknown };
    } catch {
      return { status: 200, body: { error: 'Could not work out what is needed: run koppler doctor in a terminal' } };
    }
  },
  '/secret': secret('set'),
  '/secret-remove': secret('remove'),
  '/secret-test': secret('test'),
  '/cable-test': async body => {
    const lane = typeof body['port'] === 'number' ? `${String(body['host'])}:${String(body['port'])}` : null;
    const before = (lane && tunnelLanes.get(lane)) || Promise.resolve();
    const test = before.then(() => cableTest(readStack(), body));
    if (lane)
      tunnelLanes.set(
        lane,
        test.catch(() => undefined),
      );
    return { status: 200, body: await test };
  },
  '/messages-clear': () => ({ status: 200, body: clearMessages() }),
  // A request no agent took yet is taken out of the queue.
  '/prompt-drop': body =>
    drop(typeof body['key'] === 'string' ? body['key'] : '')
      ? { status: 200, body: { ok: true } }
      : { status: 409, body: { error: 'That request is no longer waiting.' } },
  '/message-dismiss': body => {
    const open = readMessages(200).find(one => one.id === body['id'] && one.kind === 'question' && !one.answered);
    if (open) appendAnswer(open.id, { via: 'dismissed' });
    return { status: open ? 204 : 409 };
  },
  '/debug-log': body => ({ status: 200, body: appendDebugLog(body['entries']) }),
  '/debug-clear': () => ({ status: 200, body: clearDebugLog() }),
  // Stop apps, keep changes: everything Koppler runs except this canvas; branches and code changes stay for a later Revert.
  // With an app, only that one.
  '/stop-apps': async body => {
    const app = body['app'];
    const { failed, out } = await koppler(typeof app === 'string' ? ['stop', app] : ['stop', '--all', '--yes'], 60000);
    const stopped = out
      .trim()
      .split('\n')
      .filter(line => / stopped/.test(line));
    return { status: failed ? 500 : 200, body: { stopped: stopped.map(line => line.split(':')[0]) } };
  },
  // Shut down: the agent's listener, then this server through koppler (so its record goes too). Apps and tunnels keep
  // running.
  '/shutdown': () => ({
    status: 204,
    after: () => {
      appendNote('canvas-closed');
      const listener = path.join(TEMP, 'listener.json');
      try {
        const pid = listenerPid(JSON.parse(fs.readFileSync(listener, 'utf8')) as Parameters<typeof listenerPid>[0]);
        if (pid) process.kill(pid, 'SIGTERM');
      } catch {
        // No agent session was listening.
      }
      fs.rmSync(listener, { force: true });
      spawn(process.execPath, [path.join(CODE, 'koppler.mjs'), 'stop', 'canvas'], {
        detached: true,
        stdio: 'ignore',
      }).unref();
      setTimeout(() => process.exit(0), 3000).unref();
    },
  }),
};
