// Text made safe to show or post. `redact` masks secrets, for anything that reaches the page or an agent. `scrub` goes
// further, for a public issue: everything that names the user, their company or their stack (apps, repos, hosts,
// queues, paths, ticket ids, accounts) becomes a stable placeholder, so a log keeps its shape.
import os from 'node:os';

const SECRET_SETTING =
  /(password|passwd|pwd|secret|token|api[_-]?key|access[_-]?key)(\\?["']?\s*[=:]\s*)(?:(\\?["'])[^\n]*?\3|[^;"'\s,}&]+)/gi;
/** Masks what logs echo on errors: connection strings, tokens, keys. Terminal colours go too. */
export const redact = (text: string): string =>
  text
    .replace(/\x1b\[[0-9;]*[A-Za-z]/g, '')
    .replace(
      SECRET_SETTING,
      (_all, key: string, separator: string, quote = '') => `${key}${separator}${String(quote)}***${String(quote)}`,
    )
    .replace(/\b([a-z][a-z0-9+.-]*:\/\/)[^\s/:@]+:[^\s/@]+@/gi, '$1***:***@')
    .replace(/\beyJ[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{5,}/g, '***jwt***')
    .replace(/\b(Bearer\s+)[A-Za-z0-9._~+/=-]{8,}/g, '$1***')
    .replace(
      /\b(gh[pousr]_|github_pat_|glpat-|npm_|xox[abpsr]-|sk-|[sr]k_(?:live|test)_)[A-Za-z0-9_-]{10,}/g,
      '***token***',
    )
    .replace(/\b(AKIA|ASIA)[A-Z0-9]{16}\b/g, '***aws-key***');

const HOST = /\b(?:[a-z0-9](?:[a-z0-9-]*[a-z0-9])?\.)+[a-z][a-z0-9-]*[a-z0-9]\b/gi;
const GENERIC = new Set(['localhost', 'example.com', 'github.com', 'host.docker.internal']);
const FILE_NAME = /\.(json|js|mjs|ya?ml|toml|cs|dart|md)$/i;
const escaped = (text: string) => text.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
// Not glued to a word or a dash on either side.
const whole = (text: string) => new RegExp(`(?<![\\w-])${escaped(text)}(?![\\w-])`, 'gi');

/** A stack, or anything shaped like one (a saved board has presets too), as far as its names matter. */
interface Named {
  name?: unknown;
  apps?: Record<string, { name?: unknown; slug?: unknown }>;
  presets?: ({ name?: unknown } | null)[];
  queues?: Record<string, { name?: unknown; queue?: unknown; envs?: Record<string, { queue?: unknown }> }>;
}
type Names = Map<string, { term: string; as: string }>;
const text = (value: unknown) => (typeof value === 'string' ? value : '');

/** Every name the stacks give away, each with its placeholder; a log can come from a stack used before this one. */
export function namesOf(registries: unknown): Names {
  const names: Names = new Map();
  const add = (value: unknown, as: string) => {
    const term = text(value).trim();
    if (term.length > 2 && !names.has(term.toLowerCase())) names.set(term.toLowerCase(), { term, as });
  };
  // A name as written, and as code writes it ("Orders API" and "OrdersAPI").
  const named = (name: unknown, as: string) => {
    add(name, as);
    add(text(name).replace(/[\s_-]+/g, ''), as.replace(/\s+/g, ''));
  };
  let apps = 0;
  let queues = 0;
  let stacks = 0;
  let boards = 0;
  for (const registry of [registries ?? []].flat().filter(Boolean) as Named[]) {
    named(registry.name, `my-stack-${String(++stacks)}`);
    for (const [id, app] of Object.entries(registry.apps ?? {})) {
      const n = String(++apps);
      named(app.name, `App ${n}`);
      add(id, `app-${n}`);
      for (const part of text(app.slug).split('/').slice(-2)) add(part, `repo-${n}`);
    }
    for (const preset of registry.presets ?? []) named(preset?.name, `Board ${String(++boards)}`);
    for (const [id, queue] of Object.entries(registry.queues ?? {})) {
      const n = String(++queues);
      named(queue.name, `Queue ${n}`);
      add(id, `queue-${n}`);
      add(queue.queue, `queue-${n}`);
      for (const overlay of Object.values(queue.envs ?? {})) add(overlay.queue, `queue-${n}`);
    }
  }
  const hosts = new Set(JSON.stringify(registries ?? {}).match(HOST) ?? []);
  [...hosts]
    .filter(host => !GENERIC.has(host.toLowerCase()) && !FILE_NAME.test(host))
    .forEach((host, at) => {
      add(host, `host-${String(at + 1)}.example`);
    });
  return names;
}

export function scrub(
  given: unknown,
  registries: unknown,
  { home = os.homedir(), user = os.userInfo().username } = {},
): string {
  let out = redact(typeof given === 'string' ? given : String(given));
  if (home) out = out.split(home).join('~');
  // Longest first, so "orders-api.acme.dev" goes before "orders-api".
  const byLength = [...namesOf(registries).values()].sort((a, b) => b.term.length - a.term.length);
  // A long name is replaced even when glued to other text (".NETOrders API"); a short one only as a whole word.
  for (const { term, as } of byLength)
    out = out.replace(term.length >= 8 ? new RegExp(escaped(term), 'gi') : whole(term), as);
  return out
    .replace(whole(user), 'user')
    .replace(/[\w.+-]+@[\w-]+(?:\.[\w-]+)+/g, 'someone@example.com')
    .replace(/\b[A-Z][A-Z0-9]+-\d+\b/g, 'TICKET-1')
    .replace(/\b\d{12}\b/g, '<account>')
    .replace(/\b(?!127\.|0\.0\.0\.0)(?:\d{1,3}\.){3}\d{1,3}\b/g, '<ip>');
}
