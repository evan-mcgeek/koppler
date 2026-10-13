// How `koppler run <app>` starts a stack app of each kind. Pure: the caller gathers the facts (launch profiles,
// package.json, the chosen device, a view of the clone) and gets back the command to run, or why there is none.
import type { Device } from './addresses.ts';
import { frameworkOf, type PackageJson } from './frameworks.ts';
import { recipeOf, type RepoView } from './kinds.ts';
import type { App as StackApp } from './stack.ts';

/** An app as far as starting it needs: any part may be missing, and each kind says what it needs. */
export type App = Partial<StackApp>;

/** One profile of a .NET launch settings file. */
export interface LaunchProfile {
  environmentVariables?: Record<string, string>;
  applicationUrl?: string;
}
export type LaunchProfiles = Record<string, LaunchProfile>;

/** What the caller knows about this start. */
export interface StartContext {
  /** The app's clone. */
  repo?: string;
  env?: string;
  id?: string;
  /** The folder Koppler's own runners are in. */
  engine?: string;
  /** Other names the environment goes by. */
  envNames?: string[];
  profiles?: LaunchProfiles | null | undefined;
  /** Settings given for this start (a cable's local address): the values passed in must win. */
  override?: string[];
  /** Listen on the network, for a phone. */
  lan?: boolean;
  /** The app's plain http port. */
  httpPort?: number | undefined;
  device?: (Device & { id: string }) | null | undefined;
  platform?: string | undefined;
  scripts?: Record<string, string>;
  pkg?: PackageJson | null;
  files?: RepoView;
}
export type Start =
  | {
      cwd: string | undefined;
      command: string[];
      port?: number | undefined;
      /** Started with the app's stored secrets. */
      secrets?: true;
      /** Commands that end what the process leaves behind (an app on a simulator, a container). */
      onStop?: string[][];
      note?: string | undefined;
      error?: undefined;
    }
  | { error: string; command?: undefined; port?: undefined; onStop?: undefined };

const portOf = (url: string | undefined) =>
  url && URL.canParse(url) ? Number(new URL(url).port) || undefined : undefined;
const quote = (word: string) => (/^[\w@%+=:,./-]+$/.test(word) ? word : `'${word.replace(/'/g, `'\\''`)}'`);

/**
 * A .NET app's launch profile for an environment: one named after it (PROD for prod) before the stack's baseProfile,
 * and its -LOCAL copy when there is one.
 */
export function launchProfile(
  app: Pick<App, 'baseProfile'>,
  profiles: LaunchProfiles | null | undefined,
  env?: string,
) {
  const all = profiles ?? {};
  const own = env ? Object.keys(all).find(name => name.toLowerCase() === env.toLowerCase()) : undefined;
  const base = own ?? app.baseProfile ?? '';
  const local = `${base}-LOCAL`;
  return { base, local, name: Object.hasOwn(all, local) ? local : base };
}

function startDotnet(app: App, ctx: StartContext): Start {
  if (!app.project || !app.launchSettings || !app.baseProfile)
    return {
      error:
        'needs project, launchSettings and baseProfile; set each with koppler stack set apps.<app>.<field> <value>',
    };
  const profiles = ctx.profiles ?? {};
  const { local, name } = launchProfile(app, profiles, ctx.env);
  const profile = Object.hasOwn(profiles, name) ? profiles[name] : undefined;
  if (!profile) return { error: `launch profile ${name} not found in ${app.launchSettings}` };
  const vars = profile.environmentVariables ?? {};
  const sets = (setting: string | undefined): setting is string => !!setting && Object.hasOwn(vars, setting);
  // A launch profile's own value wins over the environment, so it would silently hide a stored secret of the same name.
  const hiddenSecrets = (app.secrets ?? []).map(secret => secret.env).filter(sets);
  if (hiddenSecrets.length > 0 && name === local) {
    const names = hiddenSecrets.join(', ');
    return {
      error: `launch profile ${local} sets ${names}, which hides the stored secret of that name; remove it from ${local}`,
    };
  }
  // A setting given for this start is hidden the same way.
  const hidden = [...hiddenSecrets, ...(ctx.override ?? []).filter(sets)];
  if (ctx.lan && !ctx.httpPort) return { error: 'no http address in its launch profile to open to the network' };
  const lan = ctx.lan ? ['--urls', `http://0.0.0.0:${String(ctx.httpPort)}`] : [];
  const port = ctx.lan ? ctx.httpPort : portOf(app.url);
  const run = ['dotnet', 'run', '--project', app.project];
  if (hidden.length === 0)
    return { cwd: ctx.repo, port, secrets: true, command: [...run, '--launch-profile', name, ...lan] };
  // Without a -LOCAL profile, the base profile's settings are passed minus the hidden ones, so the repo stays
  // untouched. The environment's own sign-in replaces the repo's AWS_PROFILE, which names a profile on someone
  // else's machine.
  const sso = (app.prereqs ?? []).find(prereq => prereq.sso)?.sso;
  const settings = {
    ...vars,
    ...(sso && { AWS_PROFILE: sso }),
    ...(profile.applicationUrl && { ASPNETCORE_URLS: profile.applicationUrl }),
  };
  const passed = Object.entries(settings)
    .filter(([setting]) => !hidden.includes(setting))
    .map(([setting, value]) => `${setting}=${value}`);
  return { cwd: ctx.repo, port, secrets: true, command: ['env', ...passed, ...run, '--no-launch-profile', ...lan] };
}

function startFlutter(app: App, ctx: StartContext): Start {
  const { device, env = '' } = ctx;
  if (!device) return { error: 'needs a device: --device ios, --device android or a device id (fvm flutter devices)' };
  const flutter = app.flutter?.fvm ? ['fvm', 'flutter'] : ['flutter'];
  const defines = app.flutter?.defineFile?.replace('{env}', env);
  const run = [
    ...flutter,
    'run',
    '--no-resident',
    ...(app.flutter?.flavor ? ['--flavor', env] : []),
    ...(defines ? [`--dart-define-from-file=${defines}`] : []),
    '-d',
    device.id,
  ];
  // `flutter run --no-resident` builds, installs and launches, then exits; `flutter logs` keeps the app's output.
  const logs = [...flutter, 'logs', '-d', device.id];
  const script = `${run.map(quote).join(' ')} && exec ${logs.map(quote).join(' ')}`;
  const { iosBundleId, androidPackage } = app.mobile ?? {};
  // The app outlives the process that started it: stopping closes it on the device.
  const onStop =
    device.platform === 'ios' && iosBundleId
      ? [['xcrun', 'simctl', 'terminate', device.id, iosBundleId]]
      : device.platform === 'android' && androidPackage
        ? [['adb', '-s', device.id, 'shell', 'am', 'force-stop', androidPackage]]
        : [];
  return { cwd: ctx.repo, command: ['sh', '-c', script], onStop };
}

function startNode(app: App, ctx: StartContext): Start {
  const scripts = ctx.scripts ?? {};
  const script = app.script ?? ['dev', 'start'].find(name => Object.hasOwn(scripts, name));
  if (!script || !Object.hasOwn(scripts, script))
    return {
      error: `no ${app.script ?? 'dev or start'} script in package.json; set it with koppler stack set apps.<app>.script <name>`,
    };
  const framework = app.kind === 'web' ? frameworkOf(ctx.pkg) : null;
  const port = portOf(app.url) ?? framework?.port;
  const run = ['npm', 'run', script];
  if (!ctx.lan) return { cwd: ctx.repo, port, command: run };
  // Opened to the network: the framework's own host flag, else HOST=0.0.0.0, which most Node servers read.
  if (framework?.lanArgs) return { cwd: ctx.repo, port, command: [...run, '--', ...framework.lanArgs] };
  const note = framework ? undefined : 'HOST=0.0.0.0 is set; check the app reads it';
  return { cwd: ctx.repo, port, command: ['env', framework?.lanEnv ?? 'HOST=0.0.0.0', ...run], note };
}

function startLambda(app: App, ctx: StartContext): Start {
  const port = portOf(app.url);
  if (!app.lambda?.handler || !app.lambda.runtime || !port)
    return { error: 'needs url and lambda { handler, runtime } in stack.json' };
  const engine = ctx.engine ?? '';
  const overrides = `${engine}/temp/lambda-${ctx.id ?? ''}.json`;
  return {
    cwd: ctx.repo,
    port,
    command: ['node', `${engine}/lambda-local.mjs`, JSON.stringify(app.lambda), String(port), overrides],
    onStop: [['docker', 'rm', '-f', `koppler-lambda-${String(port)}`]],
  };
}

function startSam(app: App, ctx: StartContext): Start {
  const port = portOf(app.url) ?? 3000;
  const named = ctx.env ? app.sam?.envs?.[ctx.env] : undefined;
  const config = {
    ...(app.sam?.template && { template: app.sam.template }),
    envs: named ? [named].flat() : (ctx.envNames ?? [ctx.env]),
  };
  const runner = `${ctx.engine ?? ''}/sam-local.mjs`;
  return { cwd: ctx.repo, port, command: ['node', runner, String(port), JSON.stringify(config)] };
}

function startOther(app: App, ctx: StartContext): Start {
  if (!app.start)
    return {
      error:
        'needs "start", the shell command that starts it, run in its repo: koppler stack set apps.<app>.start "<command>"',
    };
  return { cwd: ctx.repo, port: portOf(app.url), command: ['sh', '-c', app.start] };
}

const NO_FILES: RepoView = { has: () => false, read: () => null, list: () => [] };
function startFromRecipe(app: App, ctx: StartContext): Start {
  const recipe = recipeOf(app.kind);
  if (!recipe) return { error: `kind ${app.kind ?? ''} cannot start by id yet` };
  const files = ctx.files ?? NO_FILES;
  const port = portOf(app.url) ?? recipe.port?.(files) ?? undefined;
  // The stack's own `start` wins; else the recipe works one out from what is in the repo.
  const command = app.start ?? recipe.start(files, { port, platform: ctx.platform });
  if (!command) {
    const what = `cannot tell how this ${recipe.label} app starts`;
    return {
      error: `${what}; set it with koppler stack set apps.<app>.start "<command>": the shell command, run in its repo`,
    };
  }
  const stop = recipe.stop && [['sh', '-c', `cd ${quote(ctx.repo ?? '.')} && ${recipe.stop}`]];
  return { cwd: ctx.repo, port, command: ['sh', '-c', command], ...(stop && { onStop: stop }) };
}

const BY_KIND: Record<string, (app: App, ctx: StartContext) => Start> = {
  dotnet: startDotnet,
  flutter: startFlutter,
  node: startNode,
  web: startNode,
  lambda: startLambda,
  sam: startSam,
  other: startOther,
};
/** The command that starts the app, with its folder, port and what to do on stop; or the reason it cannot start. */
export function startCommand(app: App, ctx: StartContext = {}): Start {
  const start = app.kind !== undefined && Object.hasOwn(BY_KIND, app.kind) ? BY_KIND[app.kind] : undefined;
  return (start ?? startFromRecipe)(app, ctx);
}
