// Credentials for the canvas: the secrets each app declares per environment, whether each is stored, and the panel's
// requests to store, remove or test one. Names and fetch steps only, never values.
import { execFile } from 'node:child_process';
import path from 'node:path';
import { isProtected } from '../core/plan.ts';
import { readStack, type Registry } from '../data.ts';
import { APP, BIN } from '../paths.ts';

/** A secret an app declares for an environment, as the Credentials panel shows it. */
export interface DeclaredSecret {
  name: string;
  type?: string;
  when?: string;
  /** How to get the value from a terminal. */
  fetchCli?: string;
  /** How to get it by hand. */
  fetchUi?: string;
  stored?: boolean;
}
/** By app, then environment. */
export type Declared = Record<string, Record<string, DeclaredSecret[]>>;
/** The stack as far as its secrets are read; what a secret holds beyond its name is read as it comes. */
interface SecretStack {
  envs: string[];
  apps?: Record<string, AppSecrets | undefined>;
}
interface AppSecrets {
  secrets?: unknown;
  envs?: Record<string, { secrets?: unknown } | undefined> | undefined;
}
/** The answer to a request from the panel. */
export interface Answer {
  status: number;
  body: { ok?: boolean; message?: string; error?: string };
}

const said = (value: unknown) => (typeof value === 'string' ? value : JSON.stringify(value));
const storeOf = (stack: SecretStack, app: string, env: string) => (env === stack.envs[0] ? app : `${app}@${env}`);
// The panel stores the value itself, so the closing "then run secret-set" step is left out.
const CLOSING_STEP = /[,;.]?\s*(and\s+|then\s+)*run:?\s+(<skill>\/bin\/secret-set|koppler secret set)\b.*$/is;

export function declaredSecrets(stack: SecretStack | null | undefined): Declared {
  const out: Declared = {};
  const [first] = stack?.envs ?? [];
  for (const [id, base] of Object.entries(stack?.apps ?? {}))
    for (const env of stack?.envs ?? []) {
      const overlay = env === first ? undefined : base?.envs?.[env];
      const written = ({ ...base, ...overlay }.secrets ?? []) as unknown[];
      const list = written.flatMap(secret => {
        const one = (secret ?? {}) as Record<string, unknown>;
        return typeof one['env'] === 'string' && /^[A-Za-z_][A-Za-z0-9_]*$/.test(one['env']) ? [one] : [];
      });
      if (!list.length) continue;
      // Fetch steps written for the first environment are not offered for another one.
      const own = env === first || !!overlay?.secrets;
      (out[id] ??= {})[env] = list.map(secret => {
        const { type, when } = secret;
        const fetch = (secret['fetch'] ?? {}) as { cli?: unknown; ui?: unknown };
        return {
          name: secret['env'] as string,
          ...(typeof type === 'string' && /^[a-z]{1,20}$/.test(type) && { type }),
          ...(own && !!when && { when: said(when) }),
          ...(own && !!fetch.cli && { fetchCli: said(fetch.cli).replaceAll('<skill>', APP) }),
          ...(own &&
            !!fetch.ui && {
              fetchUi: said(fetch.ui).replace(CLOSING_STEP, '').trim(),
            }),
        };
      });
    }
  return out;
}

const runScript = (name: string, args: string[], input?: string, env?: Record<string, string>) =>
  new Promise<{ code: number; out: string }>(resolve => {
    const options = { timeout: 60000, maxBuffer: 64 * 1024, ...(env && { env: { ...process.env, ...env } }) };
    const child = execFile(path.join(BIN, name), args, options, (error, stdout) => {
      const code = error ? (typeof error.code === 'number' ? error.code : 1) : 0;
      resolve({ code, out: stdout.trim() });
    });
    child.stdin?.end(input);
  });

let storedNames: Record<string, string[]> = {};
let storedAt = 0;
/** Which names each store holds, asked again at most every five seconds. */
async function refreshStored(force = false): Promise<void> {
  if (!force && Date.now() - storedAt < 5000) return;
  storedAt = Date.now();
  const { code, out } = await runScript('secret-store', ['names']);
  if (code !== 0) return;
  storedNames = Object.fromEntries(
    out
      .split('\n')
      .filter(Boolean)
      .map(line => {
        const [store = '', names = ''] = line.split(/:\s*/);
        return [store, names.split(/\s+/).filter(Boolean)];
      }),
  );
}

/** The declared secrets of the stack in use, each with whether it is stored. */
export async function secretsStatus(): Promise<Declared> {
  const stack = readStack();
  if (!stack) return {};
  await refreshStored();
  const declared = declaredSecrets(stack);
  for (const [id, envs] of Object.entries(declared))
    for (const [env, list] of Object.entries(envs))
      for (const secret of list) secret.stored = (storedNames[storeOf(stack, id, env)] ?? []).includes(secret.name);
  return declared;
}

/** A request from the Credentials panel: only for a secret the stack declares for that app and environment. */
export async function secretRequest(action: 'set' | 'remove' | 'test' | undefined, body: unknown): Promise<Answer> {
  const stack: Registry | null = readStack();
  const { app, env, name, value } = (body ?? {}) as Record<string, unknown>;
  const declared =
    stack && typeof app === 'string' && typeof env === 'string'
      ? declaredSecrets(stack)[app]?.[env]?.find(secret => secret.name === name)
      : undefined;
  if (!stack || !declared || typeof app !== 'string' || typeof env !== 'string')
    return { status: 400, body: { error: 'The stack does not declare that credential.' } };
  const store = storeOf(stack, app, env);
  if (action === 'set') {
    if (typeof value !== 'string' || !value.trim() || value.length > 16384)
      return { status: 400, body: { error: 'Paste the value first.' } };
    // A protected environment's value is stored so that every read asks the user.
    const mark = { KOPPLER_SECRET_PROTECTED: isProtected(stack, env) ? '1' : '0' };
    const { code } = await runScript('secret-store', ['set', store, declared.name], value.replace(/\r?\n$/, ''), mark);
    await refreshStored(true);
    return code === 0 ? { status: 200, body: { ok: true } } : { status: 500, body: { error: 'Could not store it.' } };
  }
  if (action === 'remove') {
    await runScript('secret-store', ['remove', store, declared.name]);
    await refreshStored(true);
    return { status: 200, body: { ok: true } };
  }
  const type = declared.type ? ['--type', declared.type] : [];
  const { code, out } = await runScript('secret-test', [store, declared.name, ...type]);
  return { status: 200, body: { ok: code === 0, message: out || 'failed: the check did not finish' } };
}
