// Starting a stack app by its id: the facts are gathered here (the app as the environment has it, its clone, launch
// profiles, the device), the command comes from core/launch, and the app's stored secrets are checked and attached.
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import { APPROVE, approved, startsFromStack } from './checks.ts';
import { fail } from '../failure.ts';
import { launchProfile, startCommand, type LaunchProfiles, type StartContext } from '../core/launch.ts';
import { isProtected } from '../core/plan.ts';
import type { App, Secret } from '../core/stack.ts';
import { readClones, readStack } from '../data.ts';
import { repoFiles } from './investigate.ts';
import { readJson } from '../json-files.ts';
import { BIN, CODE, tempDir } from '../paths.ts';
import { resolveDevice, type RunDevice } from './devices.ts';
import { sh, type Once, type Ready, type RunOptions } from './processes.ts';
import { appOn, storeOf } from '../core/stack.ts';

// Koppler's own folder, where its runners (Lambda, SAM) are.

/** What to run for a stack app, ready for the process manager. */
export interface AppStart {
  cwd: string | undefined;
  command: string[];
  port: number | undefined;
  onStop: string[][] | undefined;
  device: RunDevice | undefined;
  env: string;
  ready?: Ready;
  once?: Once;
}

/** Where a Flutter app's `flutter run` keeps its process id: hot reload signals it. */
export const flutterPid = (id: string): string => path.join(tempDir(), `flutter-${id}.pid`);
/** The file a run writes for a Lambda: the keys of its secret that point at local apps. */
export const lambdaOverrides = (id: string): string => path.join(tempDir(), `lambda-${id}.json`);

/** A .NET app's launch profiles, from its clone. */
export function profilesOf(app: Partial<App>, repo: string | undefined): LaunchProfiles {
  if (app.kind !== 'dotnet' || !app.launchSettings || !repo) return {};
  const settings = readJson(path.join(repo, app.launchSettings)) as { profiles?: LaunchProfiles } | null;
  return settings?.profiles ?? {};
}
/** A .NET app's plain http address from its launch profile, for callers that cannot use its development certificate. */
export function httpUrlOf(app: Partial<App>, repo: string | undefined, env: string): string | null {
  if (app.kind !== 'dotnet' || !app.launchSettings) return null;
  const profiles = profilesOf(app, repo);
  const profile = profiles[launchProfile(app, profiles, env).name];
  return (profile?.applicationUrl ?? '').split(';').find(url => url.startsWith('http://')) ?? null;
}

/** Tries one stored secret against the address inside it; the outcome only, never the value. */
export function secretTest(store: string, secret: Secret): { code: number; message: string } {
  const args = [store, secret.env ?? '', ...(secret.type ? ['--type', secret.type] : [])];
  try {
    const said = execFileSync(path.join(BIN, 'secret-test'), args, {
      encoding: 'utf8',
      stdio: ['ignore', 'pipe', 'ignore'],
      timeout: 40000,
    });
    return { code: 0, message: said.trim() };
  } catch (error) {
    const failed = error as { status?: number; stdout?: string };
    return { code: failed.status ?? 1, message: (failed.stdout ?? '').trim() || 'failed: the check did not finish' };
  }
}

/** The facts core/launch needs for this app, read from its clone and from what was asked for. */
function contextFor(
  id: string,
  app: App,
  repo: string,
  env: string,
  options: RunOptions,
  aliases: string[],
  device: RunDevice | undefined,
): StartContext {
  // Settings given for this start (a cable's local address) come from the environment and must win over the launch
  // profile.
  const ctx: StartContext = {
    repo,
    env,
    id,
    engine: CODE,
    lambdaOverrides: lambdaOverrides(id),
    flutterPid: flutterPid(id),
    override: Object.keys(options.setEnv ?? {}),
    envNames: [env, ...aliases],
  };
  if (app.kind === 'dotnet' && app.launchSettings) ctx.profiles = profilesOf(app, repo);
  if (app.kind === 'node' || app.kind === 'web') {
    ctx.pkg = readJson(path.join(repo, 'package.json')) as NonNullable<StartContext['pkg']> | null;
    if (ctx.pkg?.scripts) ctx.scripts = ctx.pkg.scripts;
  }
  if (device) ctx.device = device;
  else {
    ctx.files = repoFiles(repo);
    if (options.device === 'ios' || options.device === 'android') ctx.platform = options.device;
  }
  if (options.lan) {
    ctx.lan = true;
    ctx.httpPort = Number(new URL(httpUrlOf(app, repo, env) ?? 'http://x').port) || undefined;
  }
  return ctx;
}

/**
 * Each environment after the first has its own secret store, so a value of one never replaces or leaks into another.
 * Ends the command when a secret the app always needs is not stored there, or when a stored one does not pass its test.
 */
function checkSecrets(id: string, app: App, store: string, env: string, test: boolean): void {
  // A secret needed only in some case (`when`) is not asked for up front.
  const always = ({ when }: Secret) => typeof when !== 'string' || !when || /^always\b/i.test(when.trim());
  const named = (app.secrets ?? []).filter(secret => secret.env);
  const wanted = named.filter(always).map(secret => secret.env ?? '');
  if (store !== id && wanted.length > 0) {
    const have = sh(path.join(BIN, 'secret-list'), [store]).split(/\s+/);
    const missing = wanted.filter(name => !have.includes(name));
    if (missing.length > 0)
      fail(
        `${id} has no ${missing.join(', ')} stored for ${env.toUpperCase()}; see: koppler doctor ${id} --env ${env}`,
      );
  }
  if (!test) return;
  for (const secret of named) {
    const result = secretTest(store, secret);
    const name = secret.env ?? '';
    if (result.code === 1) {
      const why = result.message.replace(/^failed: /, 'did not pass its test: ');
      fail(`${id}: ${name} for ${env.toUpperCase()} ${why}. Fix it, or start anyway with --no-test.`);
    }
    if (result.code === 0) console.log(`${name}: ${result.message}`);
  }
}

/** How to start a stack app by id, in the chosen environment; null when the stack has no such app. */
export function appStart(id: string, options: RunOptions): AppStart | null {
  const stack = readStack();
  const base = stack?.apps[id];
  if (!stack || !base) return null;
  // An app the stack marks as living outside this machine (a SaaS, a managed service) is never started here.
  if (base.outside) fail(`${base.name} does not run on this Mac: ${String(base.outside)}`);
  const first = stack.envs[0];
  const env = options.env ?? first ?? '';
  if (!stack.envs.includes(env)) fail(`unknown env ${env}; the stack has ${stack.envs.join(', ')}`);
  const app = appOn(stack, id, env) ?? base;
  // A start command written in the shared stack runs only once the user has seen and allowed it, and again after it
  // changes.
  if (startsFromStack(stack, id, env) && !approved(stack.source ?? '', stack))
    fail(
      `${base.name} is started by a command from the stack that you have not allowed yet, or that changed since. Review it in your own terminal: ${APPROVE}`,
    );
  const repo = readClones()[id]?.path ?? fail(`${id} is not cloned (koppler sync --rescan after cloning)`);
  const device = app.kind === 'flutter' ? resolveDevice(options.device, app) : undefined;
  const ctx = { ...contextFor(id, app, repo, env, options, stack.envAliases?.[env] ?? [], device), stack };
  const start = startCommand(app, ctx);
  if (start.error !== undefined) fail(`${id}: ${start.error}; or run any command: koppler run ${id} -- <command>`);
  const store = storeOf(stack, id, env);
  // A protected environment's store asks the user on every read, so it is only tried when asked (--test); --no-test
  // skips the check everywhere.
  checkSecrets(id, app, store, env, !options.dryRun && (options.test ?? !isProtected(stack, env)));
  // Only an app started by id gets its stored secrets; an arbitrary command never does.
  return {
    cwd: start.cwd,
    command: [path.join(BIN, 'with-secrets'), store, '--', ...start.command],
    port: start.port,
    onStop: start.onStop,
    device,
    env,
    // On its own address, so an https app is asked over https.
    ...(app.once && { once: app.once }),
    ...(app.ready &&
      app.url && {
        ready: {
          url: new URL(app.ready.path, app.url).toString(),
          status: app.ready.status,
          timeout: app.ready.timeout,
        },
      }),
  };
}
