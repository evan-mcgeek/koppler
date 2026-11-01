// What the page can ask the server to do: one function per address, each given the request's JSON body and answering
// with a status and, usually, a JSON body.
import { runs } from '../engine/history.ts';
import { pin } from '../engine/run-logs.ts';
import { hotReload } from '../engine/reload.ts';
import { records } from '../engine/processes.ts';
import { spawn } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { changeData, readStack } from '../data.ts';
import { applyFindings, current as currentFindingsStack, discover } from '../engine/discover.ts';
import { editDone } from '../engine/boards.ts';
import { discardChanges, linkStack, proposeChanges, updateStack } from '../engine/linked.ts';
import { listenerPid } from '../engine/listen.ts';
import { setLock } from '../engine/locks.ts';
import { appendAnswer, clearMessages, readMessages } from '../engine/messages.ts';
import { appendNote } from '../engine/history.ts';
import {
  addApps,
  addOutside,
  editStack,
  removeApp,
  refreshRegistry,
  replaceStack,
  saveStack,
  stackSource,
} from '../engine/stack-file.ts';
import { shareBoard, shareTarget } from '../engine/share.ts';
import { newToken, pageToken, writePageUrl } from './token.ts';
import type { StoredPreset } from '../core/presets.ts';
import { createStack, currentStack, forgetStacks, useStack } from '../engine/stacks.ts';
import { CODE, tempDir } from '../paths.ts';
import { cableTest, opens } from './cable-test.ts';
import { addressProblem, keepAddress } from '../engine/local-databases.ts';
import type { LocalAddress } from '../core/databases.ts';
import { appendDebugLog, clearDebugLog } from './logs.ts';
import { fetchPresets, sanitizeLayout } from './sanitize.ts';
import { secretRequest } from './secrets.ts';
import { drop } from './waiting.ts';
import { koppler, prompted, reload, type Answer } from './runs.ts';
import { APP_ID } from '../ids.ts';
import { showPages } from './pages.ts';

type Loose = Record<string, unknown>;
type Route = (body: Loose) => Answer | Promise<Answer>;

/** A database of the stack and the local address the page sent for it, or why it is refused. */
const localDatabase = (body: Loose): { id: string; at: LocalAddress } | { error: string } => {
  const id = body['id'];
  if (typeof id !== 'string' || !readStack()?.databases?.[id]) return { error: 'No such database in the stack.' };
  const at = { host: body['host'], port: body['port'], ...(body['database'] !== '' && { database: body['database'] }) };
  const problem = addressProblem(at as Partial<LocalAddress>);
  return problem ? { error: `Needs ${problem}.` } : { id, at: at as LocalAddress };
};

// Never starts with a dash: an id is passed to `koppler` as an argument, and must not read as a flag.
const isApp = (value: unknown): value is string => typeof value === 'string' && APP_ID.test(value);
/** What a failed result says, as the answer; undefined when the result is not a failure. */
const refused = (result: { error?: string | undefined }): Answer | undefined =>
  result.error === undefined ? undefined : { status: 400, body: result };

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

/**
 * The page's state, with the boards of your own it has never had kept from the server's copy: made in the terminal
 * since the page loaded them. A page that does not say what it has seen replaces them, as before.
 */
function keepUnseen(
  layout: Record<string, unknown>,
  seen: unknown,
  now: Record<string, unknown>,
): Record<string, unknown> {
  if (!Array.isArray(seen)) return layout;
  const list = (value: unknown): unknown[] => (Array.isArray(value) ? (value as unknown[]) : []);
  const nameOf = (one: unknown) => (one as { name?: unknown } | null)?.name;
  const known = new Set(
    [...(seen as unknown[]), ...list(layout['presets']).map(nameOf), ...list(layout['trash']).map(nameOf)].filter(
      name => typeof name === 'string',
    ),
  );
  const missed = list(now['presets']).filter(one => {
    const name = nameOf(one);
    return typeof name === 'string' && !known.has(name);
  });
  return missed.length ? { ...layout, presets: [...list(layout['presets']), ...missed] } : layout;
}

export const ROUTES: Record<string, Route> = {
  '/state': body => {
    // A page still showing the stack it opened with, after a switch, would put its boards in the other one.
    const shown = body['stack'];
    const using = currentStack();
    if (typeof shown === 'string' && shown && using && path.resolve(shown) !== path.resolve(using))
      return { status: 409 };
    const layout = sanitizeLayout(body);
    if (!layout) return { status: 400 };
    changeData('state', now => keepUnseen(layout, body['seen'], now));
    return { status: 204 };
  },
  // `koppler canvas` with a page open already: that page shows what was asked, and no other tab opens.
  '/show': body => {
    const hash =
      typeof body['hash'] === 'string' && /^(#pick|#board=[^\s]{1,200})?$/.test(body['hash']) ? body['hash'] : '';
    return { status: 200, body: { shown: showPages(hash) } };
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
  // A new address for the page: every address given out before stops working. The page moves to the new one.
  // Where a database runs on this Mac: kept here only, never in the stack. `clear` forgets it.
  '/local-database': body => {
    if (body['clear'] === true) {
      const id = body['id'];
      if (typeof id !== 'string' || !readStack()?.databases?.[id])
        return { status: 400, body: { error: 'No such database in the stack.' } };
      keepAddress(id, null);
      return { status: 200, body: { ok: true } };
    }
    const asked = localDatabase(body);
    if ('error' in asked) return { status: 400, body: asked };
    keepAddress(asked.id, asked.at);
    return { status: 200, body: { ok: true } };
  },
  // Test connection: whether anything answers on that address, before it is kept.
  '/local-database-test': async body => {
    const asked = localDatabase(body);
    if ('error' in asked) return { status: 400, body: asked };
    return { status: 200, body: { open: await opens(asked.at.host, asked.at.port) } };
  },
  '/new-address': body => {
    newToken();
    const port = typeof body['port'] === 'string' && /^\d{2,5}$/.test(body['port']) ? body['port'] : '';
    const page = port ? writePageUrl(port) : '';
    return { status: 200, body: { path: page ? new URL(page).pathname : `/s/${pageToken()}/` } };
  },
  // A board of the user's own, proposed to the team: `check` says where it would go before anything is sent.
  '/board-share': async body => {
    const dir = currentStack();
    const preset = body['preset'] as StoredPreset | undefined;
    if (!dir) return { status: 400, body: { error: 'No stack is in use.' } };
    if (!preset || typeof preset.name !== 'string') return { status: 400, body: { error: 'No board to share.' } };
    if (body['check'] === true) {
      const target = await shareTarget(dir);
      return { status: 200, body: target.error === undefined ? { repo: target.repo } : { local: true } };
    }
    const shared = await shareBoard(dir, preset);
    return { status: shared.error === undefined ? 200 : 400, body: shared };
  },
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
  // One of an app's commands from the stack: `koppler do` runs it, refuses what is not allowed, and says how it ended.
  '/app-command': body => {
    const { app, command, args } = body;
    const given = args && typeof args === 'object' && !Array.isArray(args) ? Object.entries(args) : [];
    const plain = (value: unknown) => typeof value === 'string' && /^[a-z0-9][a-z0-9-]{0,63}$/.test(value);
    if (!plain(app) || !plain(command)) return { status: 400, body: { error: 'Which command of which app?' } };
    if (given.some(([name, value]) => !/^[A-Za-z][A-Za-z0-9_]{0,31}$/.test(name) || typeof value !== 'string'))
      return { status: 400, body: { error: 'Each value is text, under its name.' } };
    const values = given.flatMap(([name, value]) => ['--arg', `${name}=${String(value)}`]);
    spawn(
      process.execPath,
      [path.join(CODE, 'koppler.mjs'), 'do', String(app), String(command), '--from-canvas', '--yes', ...values],
      { detached: true, stdio: 'ignore' },
    ).unref();
    return { status: 200, body: { started: true } };
  },
  // The trace collector, started or stopped by Koppler itself; the status says when it answers.
  '/traces': body => {
    spawn(process.execPath, [path.join(CODE, 'koppler.mjs'), 'traces', body['on'] === false ? 'stop' : 'start'], {
      detached: true,
      stdio: 'ignore',
    }).unref();
    return { status: 200, body: { asked: true } };
  },
  '/reload': body => {
    const app = typeof body['app'] === 'string' ? body['app'] : '';
    try {
      return { status: 200, body: { said: hotReload(app, body['restart'] === true) } };
    } catch (error) {
      return { status: 400, body: { error: (error as Error).message } };
    }
  },
  '/run-pin': body => {
    const id = body['id'];
    if (typeof id !== 'string' || !runs().some(run => run.id === id))
      return { status: 400, body: { error: 'No such run.' } };
    pin(id, body['on'] === true);
    return { status: 200, body: { pinned: body['on'] === true } };
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
  // Discover's Read again: the stack and the clones again, and the repos not cloned here from GitHub.
  '/read-again': async () => {
    const { failed, said } = await koppler(['sync', '--github'], 300000);
    const why =
      said
        .trim()
        .split('\n')
        .pop()
        ?.replace(/^koppler: /, '') || 'Reading did not finish.';
    const unread = said.split('\n').filter(line => line.startsWith('GITHUB ')).length;
    return failed ? { status: 500, body: { error: why } } : { status: 200, body: { ok: true, unread } };
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
    const { host, port } = body;
    const named = typeof host === 'string' && /^[\w.-]{1,253}$/.test(host) && Number.isInteger(port);
    const lane = named ? `${host}:${String(port)}` : null;
    const before = (lane && tunnelLanes.get(lane)) || Promise.resolve();
    const test = before.then(() => cableTest(readStack(), body));
    if (lane) {
      const settled = test.catch(() => undefined);
      tunnelLanes.set(lane, settled);
      void settled.then(() => {
        if (tunnelLanes.get(lane) === settled) tunnelLanes.delete(lane);
      });
    }
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
    // A name that could not be one of Koppler's processes stops nothing.
    if (app !== undefined && !isApp(app)) return { status: 200, body: { stopped: [] } };
    const { failed, out } = await koppler(app ? ['stop', app] : ['stop', '--all', '--yes'], 60000);
    const stopped = out
      .trim()
      .split('\n')
      .filter(line => / stopped/.test(line));
    return { status: failed ? 500 : 200, body: { stopped: stopped.map(line => line.split(':')[0]) } };
  },
  // A tunnel started again, found by the local port it listens on.
  '/restart-tunnel': async body => {
    const port = body['port'];
    const tunnel = records().find(one => one.name.startsWith('tunnel-') && one.port === port);
    if (!tunnel) return { status: 404, body: { error: 'No tunnel Koppler runs listens on that port.' } };
    const { failed, out } = await koppler(['restart', tunnel.name], 60000);
    return failed
      ? { status: 500, body: { error: out.trim().split('\n').at(-1) ?? 'It did not start again.' } }
      : { status: 200, body: { ok: true } };
  },
  // Shut down: the agent's listener, then this server through koppler (so its record goes too). Apps and tunnels keep
  // running.
  '/shutdown': () => ({
    status: 204,
    after: () => {
      appendNote('canvas-closed');
      const listener = path.join(tempDir(), 'listener.json');
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
