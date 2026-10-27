// What the user has to do before a set of apps can start, in plain words with one command each, checked live.
// Usage: koppler doctor [app...] [--env <env>] [--no-tunnels <app,app>] [--json]   (default: the apps on the canvas)
import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { fail as exit } from '../failure.ts';
import { isProtected } from '../core/plan.ts';
import { planSteps, planTunnels, tunnelKind } from '../core/ports.ts';
import { isSignIn, signInOf, type DeclaredSignIn } from '../core/sign-in.ts';
import { readClones, readData, readStack } from '../data.ts';
import { devicePage, sdkSignIn } from './aws-sso.ts';
import { APPROVE, approved, checksFor, envGaps, stackCommands, startsFromStack } from './checks.ts';
import { storeOf } from '../core/stack.ts';
import { alive, listener, readRecord, records } from './processes.ts';

/** A prerequisite as the stack states it; a tunnel is Koppler's own job and gives the user no step. */
interface Need {
  sso?: string | undefined;
  signIn?: string | undefined;
  hosts?: string | undefined;
  tunnel?: string | undefined;
  port?: number | undefined;
  env?: string | undefined;
  connectsAs?: string | undefined;
  devCerts?: unknown;
  nuget?: unknown;
  note?: unknown;
}
/** A secret as the stack states it: a setting or a file, when it is needed, and how to get it. */
interface SecretNeed {
  env?: string | undefined;
  file?: unknown;
  when?: unknown;
  note?: unknown;
  fetch?: unknown;
}
/** How to tell a step is done. */
interface Check {
  sso?: string;
  /** The AWS account that profile must be signed in to. */
  account?: string;
  /** A command of the stack's that succeeds while a sign-in holds. */
  shell?: string;
  hosts?: string;
  devCerts?: true;
  /** The store and the name in it. */
  secret?: [string, string];
  file?: string;
  approved?: true;
  /** A check of the stack, by its name. */
  stackCheck?: RegExp;
  manual?: true;
}
/** One thing for the user to do. Properties keep this order: it is the order `--json` prints them in. */
export interface Step {
  id: string;
  title: string;
  /** The title once the step is done, when that reads differently. */
  doneTitle?: string | undefined;
  why: string | undefined;
  /** Only needed in this case. */
  onlyIf?: string | undefined;
  command: string | null;
  where?: string | null | undefined;
  /** The same by hand. */
  alt?: string | undefined;
  how?: string | undefined;
  undo?: string | undefined;
  apps?: string[];
  check: Check;
  browser?: true;
  /** The stack does not say this for the environment. */
  gap?: true;
  /** What still holds once it is done. */
  note?: string | undefined;
}
type Shown = Step & { apps: string[]; done: boolean | null };
export interface Needs {
  env: string;
  apps: string[];
  steps: Shown[];
  /** What Koppler does itself. */
  koppler: string[];
  notSetUp: string[];
}

const words = (value: unknown) => (typeof value === 'string' ? value : undefined);
/** "Cache (Valkey)" -> "Valkey cache", "Database" -> "database": what an address leads to, in plain words. */
const friendly = (host: string) => {
  const kind = tunnelKind({ tunnel: host });
  const [, what, engine] = /^(\w+) \((.+)\)$/.exec(kind) ?? [];
  if (what && engine) return `${engine} ${what.toLowerCase()}`;
  return kind === 'Tunnel' ? 'private' : kind.toLowerCase();
};
/** A secret's condition: "always" or none means it is needed; anything else is only needed in that case. */
const always = (when: string | undefined) => !when || /^always\b/i.test(when.trim());

const run = (command: string, args: string[], timeout = 8000) => {
  try {
    return {
      ok: true,
      out: execFileSync(command, args, { encoding: 'utf8', timeout, stdio: ['ignore', 'pipe', 'ignore'] }),
    };
  } catch {
    return { ok: false, out: '' };
  }
};

/** One step per prerequisite: plain title, why the app needs it, the command, where to run it, and how to tell it is done. */
export function stepsFor(
  appName: string,
  prereqs: Need[],
  context: {
    appId?: string;
    /** The app's secret store on this environment. */
    store?: string;
    secrets?: SecretNeed[] | undefined;
    skill?: string;
    repo?: string | undefined;
    /** The sign-ins the stack declares. */
    signIns?: Record<string, DeclaredSignIn | undefined> | undefined;
  } = {},
): Step[] {
  const steps: Step[] = [];
  for (const need of prereqs) {
    const signIn = signInOf({ signIns: context.signIns }, need);
    if (signIn)
      steps.push({
        id: signIn.id,
        title: `Sign in to ${signIn.what}`,
        why: need.sso
          ? `${appName} reads its settings from AWS when it starts.`
          : `${appName} needs it when it starts.`,
        command: signIn.login,
        where: 'anywhere',
        check:
          'shell' in signIn.check
            ? { shell: signIn.check.shell }
            : { sso: need.sso ?? '', ...(signIn.account && { account: signIn.account }) },
        browser: true,
      });
    if (need.hosts)
      steps.push({
        id: `hosts:${need.hosts}`,
        title: `Point the ${friendly(need.hosts)} address at your Mac`,
        why: `${appName} connects to ${need.hosts}; on your Mac that name has to lead to the local tunnel.`,
        command: `echo "127.0.0.1 ${need.hosts}" | sudo tee -a /etc/hosts`,
        where: 'your terminal (asks for your Mac password)',
        check: { hosts: need.hosts },
      });
    if (need.devCerts)
      steps.push({
        id: 'devcerts',
        title: 'Trust the local HTTPS certificate',
        why: `${appName} serves https on your Mac; your browser and other apps must trust it.`,
        command: 'dotnet dev-certs https --trust',
        where: 'anywhere',
        check: { devCerts: true },
      });
    if (need.nuget)
      steps.push({
        id: 'nuget',
        title: 'Connect to the private package feed',
        why: `${appName} downloads company packages while it builds.`,
        command: null,
        where: null,
        how: words(need.note),
        check: { stackCheck: /nuget/i },
      });
  }
  const skillPath = (text: unknown) => words(text)?.replaceAll('<skill>', context.skill ?? '');
  for (const secret of context.secrets ?? []) {
    const fetch = (secret.fetch ?? {}) as { cli?: unknown; ui?: unknown };
    const when = words(secret.when);
    const onlyIf = always(when) ? undefined : when;
    const store = context.store ?? context.appId ?? '';
    const file = words(secret.file);
    if (secret.env)
      steps.push({
        id: `secret:${store}:${secret.env}`,
        title: `Store ${secret.env} for ${appName}`,
        why: `${appName} needs it to start.`,
        onlyIf,
        command: skillPath(fetch.cli) ?? `koppler secret set ${store} ${secret.env}`,
        where: 'your own terminal, not the agent (the value must not land in the conversation)',
        alt: skillPath(fetch.ui),
        check: { secret: [store, secret.env] },
      });
    if (file)
      steps.push({
        id: `file:${context.appId ?? ''}:${file}`,
        title: `Put ${path.basename(file)} in place for ${appName}`,
        why: `${appName} reads it when it starts.`,
        onlyIf,
        command: skillPath(fetch.cli) ?? null,
        where: 'your own terminal',
        alt: skillPath(fetch.ui),
        how: words(secret.note),
        check: { file: path.join(context.repo ?? '', file) },
      });
  }
  return steps;
}

const inHosts = (file: string, host: string) => {
  const mapped = (line: string) => !line.trim().startsWith('#') && line.split(/\s+/).slice(1).includes(host);
  try {
    return fs.readFileSync(file, 'utf8').split('\n').some(mapped);
  } catch {
    return null;
  }
};

/** What to expect from an app whose AWS SDK keeps its own copy of an sso-session sign-in, and that copy has expired. */
export const sdkNote = (apps: string[], startUrl: string): string =>
  `${apps.join(', ')} may still ask for ${apps.length === 1 ? 'its' : 'their'} own AWS sign-in in the browser when ${apps.length === 1 ? 'it starts' : 'they start'}: older AWS SDKs read the sign-in from another place, where it has expired. Approve it at ${devicePage(startUrl)} with the code from the app's log; Koppler shows it while it waits.`;

/** Live checks: true when done, false when not, null when it cannot be told. */
export function isDone(
  check: Check,
  world: { hostsFile?: string; skill?: string; checks?: { name: string; run: string }[]; approved?: boolean } = {},
): boolean | null {
  if (check.sso) {
    const account = ['--query', 'Account', '--output', 'text'];
    const who = run('aws', ['sts', 'get-caller-identity', '--profile', check.sso, ...account]);
    // Signed in to another account is not signed in: its settings and secrets would be the wrong ones.
    return who.ok && (!check.account || who.out.trim() === check.account);
  }
  // The stack wrote it: it runs only once the user approved the stack's commands.
  if (check.shell) return world.approved ? run('sh', ['-c', check.shell], 20000).ok : null;
  if (check.hosts) return inHosts(world.hostsFile ?? '/etc/hosts', check.hosts);
  if (check.devCerts) return run('dotnet', ['dev-certs', 'https', '--check', '--trust']).ok;
  if (check.secret) {
    const [store, name] = check.secret;
    return run(path.join(world.skill ?? '', 'bin', 'secret-list'), [store])
      .out.split(/\s+/)
      .includes(name);
  }
  if (check.file) return fs.existsSync(check.file);
  if (check.approved) return false;
  if (check.stackCheck) {
    const own = (world.checks ?? []).find(one => check.stackCheck?.test(one.name));
    return own ? run('sh', ['-c', own.run], 20000).ok : null;
  }
  return null;
}

const GAP_WHY = {
  tunnel: (app: string, what: string, env: string) =>
    `Without it ${app} cannot reach its ${what} on ${env}; another environment's would be the wrong database.`,
  'sign-in': (app: string) => `Another environment's sign-in would give ${app} the wrong account.`,
  hosts: (app: string) => `Another environment's address would send ${app} to the wrong place.`,
  secret: () => 'The stack only says how to get it for another environment.',
};
const literal = (text: string) => text.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
const runIn = (step: Step) => (step.where && step.where !== 'anywhere' ? `Run in ${step.where}` : 'Run');

function print(found: Needs, names: string[], onProtected: boolean, notSetUp: string[]): void {
  const { steps } = found;
  const ENV = found.env.toUpperCase();
  const todo = steps.filter(step => step.done !== true && !step.onlyIf);
  const maybe = steps.filter(step => step.done !== true && step.onlyIf);
  console.log(`Before ${names.join(', ')} can run on ${ENV}:`);
  // On a protected environment, say up front what stays with the user and what Koppler does.
  if (onProtected)
    console.log(
      `\n  On ${ENV} only you can: sign in to AWS in your browser, store secrets in your own terminal, run sudo steps, and query data (koppler query, in your terminal). Koppler opens the production tunnels and starts the apps when you press Send to ${ENV}.`,
    );
  // An app not set up yet has no prerequisites recorded, so an empty list would wrongly read as "ready".
  if (notSetUp.length) {
    const one = notSetUp.length === 1;
    console.log(
      `\n  Not known yet: ${notSetUp.join(', ')} ${one ? 'is' : 'are'} not set up, so what ${one ? 'it needs' : 'they need'} (sign-ins, tunnels, secrets) is not known. The agent reads ${one ? 'its repo' : 'their repos'} first, then lists it here.`,
    );
  }
  if (!todo.length && !notSetUp.length) console.log('  Nothing for you to do.');
  todo.forEach((step, at) => {
    const unsure = step.done === null ? ' (cannot check this one; skip it if you already did)' : '';
    console.log(`\n  ${String(at + 1)}. ${step.title}${unsure}`);
    const others = step.apps.length > 1 ? ` (also for ${step.apps.slice(1).join(', ')})` : '';
    console.log(`     Why: ${String(step.why)}${others}`);
    if (step.command) console.log(`     ${runIn(step)}:\n       ${step.command}`);
    if (step.browser) console.log('     It opens your browser to approve the sign-in.');
    if (step.alt) console.log(`     Or by hand: ${step.alt}`);
    if (step.how && !step.command) console.log(`     How: ${step.how}`);
    if (step.undo) console.log(`     To undo later: ${step.undo}`);
  });
  if (maybe.length) {
    console.log('\n  Only in some setups:');
    for (const step of maybe) {
      const when = (step.onlyIf ?? '').replace(/^only\s+(if\s+|with\s+)?/i, '');
      const what = step.command ? `${runIn(step)}: ${step.command}` : (step.how ?? '');
      console.log(`   - ${step.title}: only if ${when}\n       ${what}`);
    }
  }
  const done = steps.filter(step => step.done === true);
  if (done.length) console.log(`\n  Already done: ${done.map(step => step.title).join('; ')}.`);
  for (const step of done) if (step.note) console.log(`  ${step.note}`);
  console.log(`\n  Koppler does the rest: ${found.koppler.join(', ')}.`);
}

/** The steps for a set of apps on an environment: returned with `collect`, else printed (as JSON with `--json`). */
export function needs(
  args: string[],
  { skill, fail = exit, collect = false }: { skill: string; fail?: (message: string) => never; collect?: boolean },
): Needs | undefined {
  const stack = readStack() ?? fail('no stack loaded (koppler init)');
  const clones = readClones();
  const envAt = args.indexOf('--env');
  const offAt = args.indexOf('--no-tunnels');
  // Apps run without their tunnels: no tunnel, and no hosts entry pointing at one.
  const noTunnels = new Set(offAt >= 0 ? (args[offAt + 1] ?? '').split(',').filter(Boolean) : []);
  const first = stack.envs[0];
  const env = (envAt >= 0 ? args[envAt + 1] : first) ?? '';
  if (!stack.envs.includes(env)) fail(`unknown env ${env}; the stack has ${stack.envs.join(', ')}`);
  const given = args.filter(
    (arg, at) => !arg.startsWith('--') && (envAt < 0 || at !== envAt + 1) && (offAt < 0 || at !== offAt + 1),
  );
  const ids = given.length ? given : Object.keys(readData('state')?.['nodes'] ?? {});
  for (const id of ids) if (!stack.apps[id]) fail(`${id} is not an app in the stack`);
  const nameOf = (id: string) => stack.apps[id]?.name ?? id;
  const ENV = env.toUpperCase();

  // What the stack does not say for this environment: never filled in from the first one.
  const gaps = envGaps(stack, env === first ? '-' : env).filter(
    gap => ids.includes(gap.app) && !(noTunnels.has(gap.app) && (gap.kind === 'tunnel' || gap.kind === 'hosts')),
  );
  const borrowed = new Set(gaps.filter(gap => gap.kind !== 'secret').map(gap => gap.app));
  const noFetch = new Set(gaps.filter(gap => gap.kind === 'secret').map(gap => `${gap.app}:${String(gap.name)}`));
  // An app without its own prerequisites here keeps only those that hold anywhere (a certificate, a file); never
  // another environment's tunnels, sign-ins, hosts or secret fetch steps.
  const appFor = (id: string) => {
    const app = stack.apps[id];
    const own = env === first ? undefined : app?.envs?.[env];
    const merged = { ...app, ...own };
    const secrets = (merged.secrets as SecretNeed[] | undefined)?.map(secret =>
      noFetch.has(`${id}:${String(secret.env ?? secret.file)}`) ? { ...secret, fetch: undefined } : secret,
    );
    const all: Need[] = merged.prereqs ?? [];
    // Only the first environment's list is borrowed; an environment's own list is its own, even when it misses a kind.
    const prereqs =
      borrowed.has(id) && !app?.envs?.[env]?.prereqs
        ? all.filter(need => !need.tunnel && !isSignIn(need) && !need.hosts)
        : all;
    return {
      name: nameOf(id),
      secrets,
      prereqs: noTunnels.has(id) ? prereqs.filter(need => !need.tunnel && !need.hosts) : prereqs,
    };
  };

  // Steps from every app, one per thing to do even when several apps need it.
  const byId = new Map<string, Step & { apps: string[] }>();
  for (const id of ids) {
    const app = appFor(id);
    const context = {
      appId: id,
      store: storeOf(stack, id, env),
      secrets: app.secrets,
      skill,
      repo: clones[id]?.path,
      signIns: stack.signIns,
    };
    for (const step of stepsFor(app.name, app.prereqs, context)) {
      const seen = byId.get(step.id);
      if (seen) seen.apps.push(app.name);
      else byId.set(step.id, { ...step, apps: [app.name] });
    }
  }
  for (const gap of gaps) {
    const id = `gap:${gap.app}:${gap.kind}:${String(gap.name)}`;
    const app = nameOf(gap.app);
    byId.set(id, {
      id,
      title: gap.detail,
      why: GAP_WHY[gap.kind](app, String(gap.name), ENV),
      command: null,
      where: null,
      how: `Ask the agent: find the ${ENV} facts for ${app}. It reads the repo and your local tunnel aliases and proposes the stack.json change.`,
      check: {},
      gap: true,
      apps: [app],
    });
  }
  // The tunnel plan can add sudo steps (a loopback alias); tunnels themselves are Koppler's job.
  const tunnels = planTunnels(
    ids.flatMap(id =>
      appFor(id).prereqs.flatMap(({ tunnel, port, env: setting, connectsAs }) =>
        tunnel && port ? [{ app: id, tunnel, port, env: setting, connectsAs }] : [],
      ),
    ),
  );
  const hostOf = (host: string) => host.split('.')[0] ?? host;
  for (const tunnel of tunnels) {
    if (!tunnel.needsAlias) continue;
    const { sudo, undo } = planSteps(tunnel);
    const id = `alias:${tunnel.bind}`;
    byId.set(id, {
      id,
      title: `Give ${hostOf(tunnel.host)} its own local address`,
      why: `Another tunnel needs port ${String(tunnel.port)}; this one keeps it on ${tunnel.bind}.`,
      command: sudo.join(' && '),
      where: 'your terminal (asks for your Mac password)',
      undo: undo.join(' && '),
      apps: tunnel.apps.map(nameOf),
      check: { manual: true },
    });
  }
  const kindsInRun = new Set(ids.map(id => stack.apps[id]?.kind));
  const own = checksFor(stack).flatMap(check => (check.safe ? [] : [check]));
  for (const check of own) {
    if (check.kinds && !check.kinds.some(kind => kindsInRun.has(kind))) continue;
    if ([...byId.values()].some(step => step.check.stackCheck?.test(check.name))) continue;
    const id = `check:${check.name}`;
    byId.set(id, {
      id,
      title: check.fix,
      doneTitle: check.ok,
      why: `The stack checks this before a run (${check.name}).`,
      command: null,
      apps: [],
      check: { stackCheck: new RegExp(`^${literal(check.name)}$`) },
    });
  }
  // The stack's own checks are shell commands: they run only once the user approved them (koppler doctor --approve).
  const mayRun = approved(stack.source ?? '', stack);
  // What the stack runs or writes for these apps needs the user's yes first: its checks, a start command it gives, a
  // code change.
  const writes = (id: string) => startsFromStack(stack, id, env) || !!stack.apps[id]?.localChanges?.length;
  if (!mayRun && (stackCommands(stack).some(command => command.what === 'check') || ids.some(writes)))
    byId.set('approve-stack', {
      id: 'approve-stack',
      title: 'Review and allow what this stack runs on your Mac',
      why: 'The stack carries its own commands or code changes, written by whoever edits it. Koppler runs none of them until you have seen them.',
      command: APPROVE,
      where: 'your own terminal',
      apps: [],
      check: { approved: true },
    });
  // In the order they can be done: what the stack is missing, then sign-ins (a secret's fetch needs them), then the
  // rest, secrets last.
  const rank = (step: Step) =>
    step.gap ? 0 : step.check.sso || step.check.shell ? 1 : step.id.startsWith('secret:') ? 3 : 2;
  const world = { skill, checks: mayRun ? own : [], approved: mayRun };
  const steps = [...byId.values()]
    .sort((a, b) => rank(a) - rank(b))
    .map((step): Shown => {
      const done = step.gap ? false : isDone(step.check, world);
      const sdk = done && step.check.sso ? sdkSignIn(step.check.sso) : null;
      return {
        ...step,
        done,
        title: done && step.doneTitle ? step.doneTitle : step.title,
        ...(sdk && !sdk.holds && { note: sdkNote(step.apps, sdk.startUrl) }),
      };
    });
  // Open already only when this tunnel holds its port; anything else there may reach another database, and koppler up
  // stops on it, as this says.
  const state = (tunnel: (typeof tunnels)[number]) => {
    const { name } = planSteps(tunnel);
    const own = readRecord(name);
    if (own && alive(own)) return ' (already open)';
    const holder = listener(tunnel.port, tunnel.bind);
    if (!holder) return '';
    const ours = records().find(record => record.port === tunnel.port && alive(record))?.name;
    return ours
      ? ` (the port is held by ${ours}, not this tunnel: koppler stop ${ours} first)`
      : ` (the port is held by ${holder.command ?? 'another program'} (pid ${String(holder.pid)}), not this tunnel: close it first)`;
  };
  const koppler = [
    ...tunnels.map(
      tunnel => `tunnel to ${hostOf(tunnel.host)} on ${tunnel.bind}:${String(tunnel.port)}${state(tunnel)}`,
    ),
    ...ids.map(id => `start ${nameOf(id)}`),
  ];
  const notSetUp = ids.filter(id => stack.apps[id]?.['pending']);
  const found: Needs = { env, apps: ids, steps, koppler, notSetUp };
  if (collect) return found;
  if (args.includes('--json')) console.log(JSON.stringify(found, null, 2));
  else print(found, ids.map(nameOf), isProtected(stack, env), notSetUp.map(nameOf));
  return undefined;
}
