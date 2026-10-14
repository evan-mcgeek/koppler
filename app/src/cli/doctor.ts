// The commands that say whether something can run here, and what it needs: doctor (tools, what the user still has to
// do, secrets, connections), the tunnels of a plan, and the secrets themselves.
import { spawnSync } from 'node:child_process';
import path from 'node:path';
import { isProtected } from '../core/plan.ts';
import { describePlan, planSteps, planTunnels } from '../core/ports.ts';
import { readData, readStack, type Registry } from '../data.ts';
import { secretTest } from '../engine/app-start.ts';
import { checkTools, missingTunnels, report } from '../engine/checks.ts';
import { needs } from '../engine/needs.ts';
import { live } from '../engine/history.ts';
import { tunnelsOf } from '../engine/up.ts';
import { cableTest, type Tested } from '../server/cable-test.ts';
import { APP, BIN } from '../paths.ts';
import { confirm, envOf, positional } from './output.ts';
import { fail } from '../failure.ts';
import { appOn, storeOf } from '../core/stack.ts';

const loaded = (): Registry => readStack() ?? fail('no stack loaded (koppler init)');
const portOf = (stack: Registry, id: string) => Number(new URL(stack.apps[id]?.url ?? 'http://x').port);

/** The tunnels a set of apps needs, with shared, moved and loopback-aliased ones worked out (default: the apps on the canvas). */
export function ports(args: string[]): void {
  const stack = loaded();
  const envAt = args.indexOf('--env');
  const env = (envAt >= 0 ? args[envAt + 1] : stack.envs[0]) ?? '';
  const ENV = env.toUpperCase();
  if (!stack.envs.includes(env)) fail(`unknown env ${String(args[envAt + 1])}; the stack has ${stack.envs.join(', ')}`);
  const given = args.filter((arg, at) => !arg.startsWith('--') && (envAt < 0 || at !== envAt + 1));
  const ids = given.length ? given : Object.keys(readData('state')?.['nodes'] ?? {});
  const name = (id: string) => stack.apps[id]?.name ?? id;
  for (const id of ids) if (!stack.apps[id]) fail(`${id} is not an app in the stack`);
  for (const id of ids) {
    const outside = stack.apps[id]?.outside;
    if (outside) fail(`${name(id)} does not run on this Mac: ${String(outside)}`);
  }
  // An app with no tunnels for this environment never gets the first environment's: that would reach the wrong database.
  const noTunnel = missingTunnels(stack, env).filter(id => ids.includes(id));
  if (noTunnel.length)
    fail(
      `${noTunnel.map(name).join(', ')}: the stack has no ${ENV} tunnel, and another environment's is never used. Set it with koppler stack set apps.<id>.envs.${env}.prereqs before running on ${ENV}.`,
    );
  const needed = ids.flatMap(id => tunnelsOf(stack, id, env));
  const taken = ids.map(id => portOf(stack, id)).filter(Boolean);
  const plan = planTunnels(needed, taken).map(tunnel => ({ ...tunnel, steps: planSteps(tunnel) }));
  if (args.includes('--json')) {
    console.log(JSON.stringify(plan, null, 2));
    return;
  }
  if (!plan.length) {
    console.log(`no tunnels needed for ${ids.join(', ') || 'these apps'}`);
    return;
  }
  for (const line of describePlan(plan, name)) console.log(line);
  for (const tunnel of plan) {
    const { steps } = tunnel;
    const port = String(tunnel.port);
    const bind = tunnel.needsAlias ? ` --bind ${tunnel.bind}` : '';
    console.log(`\n${tunnel.host} -> ${tunnel.bind}:${port}  (for ${tunnel.apps.map(name).join(', ')})`);
    for (const command of steps.sudo) console.log(`  you run: ${command}`);
    for (const command of steps.undo) console.log(`  undo:    ${command}`);
    console.log(`  tunnel:  koppler run ${steps.name} --port ${port}${bind} --restart -- ${steps.tunnel}`);
    for (const { app, env: setting, value } of steps.settings)
      console.log(`  setting: ${setting}=${value} in ${name(app)}'s -LOCAL profile`);
  }
}

/** Tries each stored secret the apps declare and says only whether it works; the values stay in their store. */
function secretTests(stack: Registry, ids: string[], env: string) {
  return ids.flatMap(id => {
    const app = appOn(stack, id, env) ?? fail(`${id} is not an app in the stack`);
    const store = storeOf(stack, id, env);
    return (app.secrets ?? []).flatMap(secret =>
      secret.env ? [{ app: id, name: secret.env, env, ...secretTest(store, secret) }] : [],
    );
  });
}

/**
 * Every connection of what runs now, tested the way the canvas's Flow check does: each app answers, each cable reaches
 * its local app, each tunnel reaches its database or cache.
 */
async function flowCheck(args: string[]): Promise<void> {
  const stack = loaded();
  const board = live();
  if (!board || !Object.keys(board.nodes).length) {
    console.log('Nothing is running, so there is nothing to test.');
    return;
  }
  const env = board.env ?? stack.envs[0] ?? '';
  const name = (id: string) => stack.apps[id]?.name ?? id;
  const ids = Object.keys(board.nodes).filter(id => stack.apps[id]);
  const tunnels = planTunnels(
    ids.filter(id => board.nodes[id]?.tunnels !== false).flatMap(id => tunnelsOf(stack, id, env)),
  );
  const jobs = [
    ...ids.filter(id => stack.apps[id]?.url).map(id => ({ label: name(id), body: { env, node: id } })),
    ...board.edges.map(({ from, to }) => ({ label: `${name(from)} to local ${name(to)}`, body: { env, from, to } })),
    ...tunnels.flatMap(tunnel =>
      tunnel.apps.map(id => ({
        label: `${name(id)} to ${tunnel.what}`,
        body: { env, app: id, host: tunnel.bind, port: tunnel.port, original: tunnel.original },
      })),
    ),
  ];
  const results: { label: string; result: Tested }[] = [];
  for (const { label, body } of jobs) results.push({ label, result: await cableTest(stack, body) });
  if (args.includes('--json')) {
    const shown = results.map(({ label, result }) => ({
      connection: label,
      ok: result.ok,
      text: result.text,
      detail: result.detail,
    }));
    console.log(JSON.stringify(shown, null, 2));
  } else
    for (const { label, result } of results) {
      const state = result.ok ? 'ok     ' : result.unsure ? 'unsure ' : 'FAILED ';
      console.log(`${state} ${label}: ${result.text}${result.ok ? '' : ` (${result.detail})`}`);
    }
  if (results.some(({ result }) => !result.ok && !result.unsure)) process.exitCode = 1;
}

/**
 * Can these apps run here? The tools this stack needs, then what the user still has to do for the apps, then (asked
 * for) whether each stored secret works, or whether every connection of what runs now answers.
 */
export async function doctor(args: string[]): Promise<void> {
  if (args.includes('--flow')) {
    await flowCheck(args);
    return;
  }
  const json = args.includes('--json');
  const stack = loaded();
  const env = envOf(stack, args);
  const ids = positional(args, ['--env', '--no-tunnels']);
  // Approving runs commands from a shared file on this Mac: only a person at the terminal can say yes, never --yes.
  const tools = await checkTools({ approve: args.includes('--approve'), confirm: question => confirm(question) });
  if (tools.error !== undefined) fail(tools.error);
  const forNeeds = args.filter(arg => arg !== '--secrets' && arg !== '--approve');
  const todo = ids.length ? needs(forNeeds, { skill: APP, collect: json }) : undefined;
  const wanted = args.includes('--secrets');
  const secrets = wanted ? secretTests(stack, ids.length ? ids : Object.keys(stack.apps), env) : [];
  if (json) {
    console.log(JSON.stringify({ tools: tools.results, ...todo, ...(wanted && { secrets }) }, null, 2));
    return;
  }
  if (!ids.length) report(tools.results);
  for (const secret of secrets) console.log(`${secret.app} ${secret.name} (${env.toUpperCase()}): ${secret.message}`);
  if (tools.results.some(result => result.state === 'missing') || secrets.some(secret => secret.code === 1))
    process.exitCode = 1;
}

const SCRIPTS: Record<string, string | undefined> = { set: 'secret-set', list: 'secret-list', psql: 'secret-psql' };
/** Secrets, in the user's own terminal: the values never pass through Koppler's output. */
export function secret(args: string[]): never {
  const [action = '', ...rest] = args;
  if (action === 'remove') {
    const [store, name] = rest;
    if (!store || !name) fail('usage: koppler secret remove <app>[@<env>] <NAME>');
    process.exit(spawnSync(path.join(BIN, 'secret-store'), ['remove', store, name], { stdio: 'inherit' }).status ?? 1);
  }
  const script =
    (Object.hasOwn(SCRIPTS, action) ? SCRIPTS[action] : undefined) ??
    fail('usage: koppler secret set|list|remove|psql <app>[@<env>] [<NAME>]');
  // A protected environment's value is stored so that every read asks the user (the stack says which; else all but
  // the first).
  const stack = readStack();
  const env = (rest[0] ?? '').split('@')[1] ?? stack?.envs[0] ?? '';
  const mark = stack ? { KOPPLER_SECRET_PROTECTED: isProtected(stack, env) ? '1' : '0' } : {};
  const ran = spawnSync(path.join(BIN, script), rest, { stdio: 'inherit', env: { ...process.env, ...mark } });
  process.exit(ran.status ?? 1);
}
