// What a stack needs on this Mac, checked when the stack loads. Koppler itself needs only git and Node.
// The rest comes from the stack: the programs its kinds of app are started with, the programs its own commands call
// (a tunnel's command, an AWS sign-in), and its `checks`, which are shell commands and so run only once the user approved them.
// Usage: koppler doctor [--json]      run them and say what is missing
//        koppler doctor --approve     show the stack's own check commands and allow them to run (again after they change)
import { execFileSync } from 'node:child_process';
import crypto from 'node:crypto';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { of as kindOf, register } from '../core/kinds.ts';
import { readData } from '../data.ts';
import { TEMP } from '../paths.ts';

// A stack as its file gives it. Anyone on the team can edit that file, so nothing in it is taken on trust here.
interface LoosePrereq {
  [key: string]: unknown;
  sso?: string | undefined;
  tunnel?: string | undefined;
  hosts?: string | undefined;
  what?: string | undefined;
  cmd?: unknown;
}
interface LooseEnv {
  prereqs?: (LoosePrereq | null)[] | undefined;
  secrets?: unknown;
  start?: unknown;
}
interface LooseApp extends LooseEnv {
  name?: string | undefined;
  kind?: string | undefined;
  outside?: unknown;
  envs?: Record<string, LooseEnv | null> | undefined;
  secrets?: ({ env?: string | undefined; fetch?: unknown } | null)[] | undefined;
  localChanges?: unknown;
}
export interface LooseStack {
  name?: string | undefined;
  source?: string | undefined;
  envs?: string[] | undefined;
  apps?: Record<string, LooseApp> | undefined;
  kinds?: Record<string, { start?: unknown; stop?: unknown } | null> | undefined;
  install?: Record<string, unknown> | undefined;
  checks?: unknown;
}
type MaybeStack = LooseStack | null | undefined;

/** Asks only whether a program is installed. */
interface ToolCheck {
  name: string;
  tool: string;
  safe: true;
  /** Who needs it. */
  for: string[];
  fix: string;
}
/** A shell command the stack wrote. */
interface StackCheck {
  name: string;
  run: string;
  ok: string;
  fix: string;
  safe: false;
  kinds?: string[];
}
export type Check = ToolCheck | StackCheck;
export interface Command {
  what: string;
  name: string;
  run: string;
}
export interface Gap {
  app: string;
  env: string;
  kind: 'tunnel' | 'sign-in' | 'hosts' | 'secret';
  name: string | undefined;
  detail: string;
}
export interface Result {
  name: string;
  from: 'tool' | 'stack';
  state: 'ok' | 'missing' | 'pending' | 'gap';
  detail: string;
  for?: string[];
  app?: string;
  env?: string;
  kind?: Gap['kind'];
}

const temp = () => process.env['KOPPLER_TEMP'] || TEMP;
const approvalsFile = () =>
  path.join(process.env['KOPPLER_CONFIG_DIR'] || path.join(os.homedir(), '.config', 'koppler'), 'approved-checks.json');
const TOOL = /^[A-Za-z0-9._+-]{1,64}$/;
const text = (value: unknown, max = 300) => (typeof value === 'string' ? value.slice(0, max) : '');

/** The checks a stack calls for. `safe` ones only ask whether a program is installed; the stack's own `checks` are shell. */
export function checksFor(stack: MaybeStack): Check[] {
  const apps = Object.entries(stack?.apps ?? {});
  const list = new Map<string, ToolCheck>();
  const tool = (name: string | undefined, who: string, fix: unknown) => {
    if (name === undefined || !TOOL.test(name)) return;
    const check = list.get(name) ?? { name, tool: name, safe: true, for: [], fix: '' };
    if (who && !check.for.includes(who)) check.for.push(who);
    check.fix ||= typeof fix === 'string' ? fix : '';
    list.set(name, check);
  };
  tool('git', 'Koppler', 'xcode-select --install');
  tool('node', 'Koppler', 'Install Node 22 or newer');
  if (stack?.kinds) register(stack.kinds);
  for (const [, app] of apps.filter(([, one]) => !one.outside)) {
    const kind = kindOf(app);
    for (const need of kind.needs ?? []) tool(need.tool, kind.label, need.fix);
    // Every environment's prerequisites: an AWS sign-in uses the aws program, a command is started by its first word.
    const prereqs = [...(app.prereqs ?? []), ...Object.values(app.envs ?? {}).flatMap(env => env?.prereqs ?? [])];
    for (const prereq of prereqs) {
      if (prereq?.sso) tool('aws', app.name ?? 'an app', stack?.install?.['aws']);
      const first = text(prereq?.cmd).trim().split(/\s+/)[0];
      if (first) tool(first, prereq?.what ?? app.name ?? 'an app', stack?.install?.[first]);
    }
  }
  for (const check of list.values())
    check.fix ||= text(stack?.install?.[check.tool]) || `Install ${check.tool} and make sure it is on your PATH`;
  const written = (Array.isArray(stack?.checks) ? stack.checks : []) as unknown[];
  const own = written
    .filter((check): check is Record<string, unknown> & { name: string; run: string } => {
      const { name, run } = (check ?? {}) as Record<string, unknown>;
      return typeof name === 'string' && typeof run === 'string';
    })
    .slice(0, 50)
    .map((check): StackCheck => {
      const kinds = check['kinds'];
      return {
        name: text(check.name, 80),
        run: text(check.run, 2000),
        ok: text(check['ok']),
        fix: text(check['fix']) || 'This check of the stack fails',
        safe: false,
        ...(Array.isArray(kinds) && { kinds: kinds.filter(kind => typeof kind === 'string') }),
      };
    })
    .filter(check => !check.kinds || apps.some(([, app]) => app.kind !== undefined && check.kinds?.includes(app.kind)));
  return [...list.values(), ...own];
}

/**
 * What the stack does not say for an environment other than the first: a tunnel the first one has, or how to get a
 * secret there. Never filled in from the first environment: its hosts and secrets are another environment's.
 */
export function envGaps(stack: MaybeStack, only?: string): Gap[] {
  const [first, ...rest] = stack?.envs ?? [];
  const gaps: Gap[] = [];
  for (const env of rest.filter(one => !only || one === only))
    for (const [id, app] of Object.entries(stack?.apps ?? {})) {
      if (app.outside) continue;
      const own = app.envs?.[env] ?? {};
      const label = env.toUpperCase();
      const from = String(first).toUpperCase();
      const name = app.name ?? id;
      // Tunnels, sign-ins and hosts entries belong to one environment: each kind the first one has must be in this
      // one's own list too.
      const has = (kind: 'tunnel' | 'sso' | 'hosts') => (own.prereqs ?? []).some(prereq => prereq?.[kind]);
      const gap = (kind: Gap['kind'], what: string | undefined, detail: string) =>
        gaps.push({ app: id, env, kind, name: what, detail });
      for (const prereq of app.prereqs ?? []) {
        if (prereq?.tunnel && !has('tunnel'))
          gap(
            'tunnel',
            prereq.what ?? prereq.tunnel,
            `No ${label} tunnel for ${name}'s ${prereq.what ?? 'database'} (${from} uses ${prereq.tunnel})`,
          );
        if (prereq?.sso && !has('sso'))
          gap('sign-in', prereq.sso, `No ${label} sign-in for ${name} (${from} uses the AWS profile ${prereq.sso})`);
        if (prereq?.hosts && !has('hosts'))
          gap('hosts', prereq.hosts, `No ${label} hosts entry for ${name} (${from} uses ${prereq.hosts})`);
      }
      if (!own.secrets)
        for (const secret of app.secrets ?? [])
          if (secret?.fetch)
            gap('secret', secret.env, `No steps for getting ${String(secret.env)} for ${name} on ${label}`);
    }
  return gaps;
}
/** Apps whose tunnels for `env` are missing: they must not borrow the first environment's. */
export const missingTunnels = (stack: MaybeStack, env: string): string[] => [
  ...new Set(
    envGaps(stack, env)
      .filter(gap => gap.kind === 'tunnel')
      .map(gap => gap.app),
  ),
];

/**
 * Everything in the stack that Koppler would run or write on this Mac, beyond the stack's facts: its own checks, the
 * start commands it gives (per app, per environment, and per kind it defines), and the code changes it remembers.
 * A shared stack can be edited by anyone on the team, so none of it happens until the user has seen exactly this list.
 */
export function stackCommands(stack: MaybeStack): Command[] {
  const out: Command[] = [];
  const add = (what: string, name: string, run: unknown) => {
    if (typeof run === 'string' && run) out.push({ what, name, run });
  };
  for (const check of checksFor(stack)) if (!check.safe) add('check', check.name, check.run);
  for (const [id, kind] of Object.entries(stack?.kinds ?? {})) {
    add('start of every', `${id} app`, kind?.start);
    add('stop of every', `${id} app`, kind?.stop);
  }
  for (const [id, app] of Object.entries(stack?.apps ?? {}) as [string, LooseApp | null][]) {
    const name = app?.name ?? id;
    add('start', name, app?.start);
    for (const [env, own] of Object.entries(app?.envs ?? {})) add(`start on ${env}`, name, own?.start);
    const changes = (Array.isArray(app?.localChanges) ? app.localChanges : []) as (Record<string, unknown> | null)[];
    for (const change of changes)
      add(
        'code change',
        `${name}, ${String(change?.['file'])}`,
        `${String(change?.['find'])}\n  becomes\n${String(change?.['replace'])}`,
      );
  }
  return out;
}
/** Whether this app's start runs a command the stack wrote, on that environment. */
export const startsFromStack = (stack: MaybeStack, id: string, env: string): boolean => {
  const app = stack?.apps?.[id];
  return !!(app && (app.start || app.envs?.[env]?.start || stack.kinds?.[app.kind ?? '']?.start));
};

/** Changes whenever a command of the stack's own changes; names and order of safe checks do not count. */
export const fingerprint = (commands: Command[]): string =>
  crypto
    .createHash('sha256')
    .update(JSON.stringify(commands.map(command => [command.what, command.name, command.run])))
    .digest('hex');
const approvals = (): Record<string, string> => {
  try {
    return JSON.parse(fs.readFileSync(approvalsFile(), 'utf8')) as Record<string, string>;
  } catch {
    return {};
  }
};
/** Approved when the stack runs nothing of its own, or the user approved exactly what it runs now. */
export const approved = (source: string, stack: MaybeStack): boolean => {
  const commands = stackCommands(stack);
  return !commands.length || approvals()[source] === fingerprint(commands);
};
export function approve(source: string, stack: MaybeStack): void {
  fs.mkdirSync(path.dirname(approvalsFile()), { recursive: true });
  const next = { ...approvals(), [source]: fingerprint(stackCommands(stack)) };
  fs.writeFileSync(approvalsFile(), JSON.stringify(next, null, 2) + '\n', { mode: 0o600 });
}
export const APPROVE = 'koppler doctor --approve';

const ran = (run: string, timeout?: number) => {
  try {
    execFileSync('/bin/sh', ['-c', run], { stdio: 'ignore', ...(timeout && { timeout }) });
    return true;
  } catch {
    return false;
  }
};
const has = (tool: string) => ran(`command -v ${tool}`);
const passes = (run: string) => ran(run, 20000);

/** Runs what may run. A stack check that was not approved stays `pending`: listed, not run. */
export function runChecks(
  stack: MaybeStack,
  { source = stack?.source ?? '', exists = has, shell = passes } = {},
): Result[] {
  const ok = approved(source, stack);
  const results = checksFor(stack).map((check): Result => {
    if (check.safe) {
      const base = { name: check.name, from: 'tool' as const, ...(check.for.length && { for: check.for }) };
      return exists(check.tool)
        ? { ...base, state: 'ok', detail: 'installed' }
        : { ...base, state: 'missing', detail: check.fix };
    }
    const base = { name: check.name, from: 'stack' as const };
    if (!ok) return { ...base, state: 'pending', detail: 'Waits for your approval: koppler doctor --approve' };
    return shell(check.run)
      ? { ...base, state: 'ok', detail: check.ok || 'ok' }
      : { ...base, state: 'missing', detail: check.fix };
  });
  const gaps = envGaps(stack).map((gap): Result => ({
    name: `${gap.app} ${gap.env}`,
    from: 'stack',
    state: 'gap',
    detail: gap.detail,
    app: gap.app,
    env: gap.env,
    kind: gap.kind,
  }));
  return [...results, ...gaps];
}

const WORD = { ok: 'ok', missing: 'MISSING', pending: 'PENDING', gap: 'GAP' };
export function report(results: Result[]): void {
  for (const result of results) {
    const who = result.for?.length && result.state !== 'ok' ? ` (needed by ${result.for.join(', ')})` : '';
    console.log(`${WORD[result.state].padEnd(8)} ${result.name.padEnd(14)} ${result.detail}${who}`);
  }
}
const save = (stack: LooseStack, results: Result[]) => {
  const saved = { at: new Date().toISOString(), stack: stack.name ?? '', results };
  fs.writeFileSync(path.join(temp(), 'checks.json'), JSON.stringify(saved, null, 2) + '\n');
};

/** Runs the loaded stack's checks, prints them, and leaves the result for the canvas. False when something is missing. */
export function checkStack({ quiet = false } = {}): boolean {
  const stack = readData('registry') as LooseStack | null;
  if (!stack) return true;
  const results = runChecks(stack);
  fs.mkdirSync(temp(), { recursive: true });
  save(stack, results);
  if (!quiet) report(results);
  return !results.some(result => result.state === 'missing');
}

/**
 * The tools and the stack's own checks on this Mac, saved for the canvas. With `approve`, the stack's check commands
 * are shown first and run only once `confirm` says yes: they come from a shared file anyone on the team can edit.
 */
export async function checkTools({
  approve: wantApprove = false,
  confirm = () => Promise.resolve(false),
}: { approve?: boolean; confirm?: (question: string) => Promise<boolean> } = {}): Promise<
  { results: Result[]; error?: undefined } | { error: string }
> {
  const stack = readData('registry') as LooseStack | null;
  if (!stack) return { error: 'no stack loaded (koppler init)' };
  const commands = stackCommands(stack);
  const source = stack.source ?? '';
  if (wantApprove) {
    if (!commands.length) console.log('This stack runs nothing of its own, so there is nothing to approve.');
    else {
      console.log(
        `The stack at ${source} would run or write these on this Mac. Anyone who can edit the stack wrote them:\n`,
      );
      for (const command of commands) {
        const lines = command.run.split('\n').map(line => `    ${line}`);
        console.log(`  ${command.what}: ${command.name}\n${lines.join('\n')}\n`);
      }
      if (!(await confirm('Allow all of these?')))
        return { error: "not approved; the stack's own commands and code changes stay off" };
      approve(source, stack);
      console.log('Approved. They are allowed from now on, until any of them changes.\n');
    }
  }
  const results = runChecks(stack);
  save(stack, results);
  return { results };
}
