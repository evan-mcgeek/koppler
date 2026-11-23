// A Serverless Framework app's custom domain (serverless-domain-manager), per stage, from its serverless.yml.
import { parse } from 'yaml';
import type { Domain } from './terraform.ts';

type Tree = Record<string, unknown>;

/** The file as data; CloudFormation tags (`!Ref`, `!Sub`) are read as plain values, and a file that is not YAML as empty. */
function readTree(text: string): Tree {
  try {
    const tree: unknown = parse(text, { strict: false, logLevel: 'silent', merge: true });
    return tree && typeof tree === 'object' ? (tree as Tree) : {};
  } catch {
    return {};
  }
}

const at = (tree: Tree, dotted: string): unknown =>
  dotted
    .split('.')
    .reduce<unknown>((node, key) => (node && typeof node === 'object' ? (node as Tree)[key] : undefined), tree);

const STAGE = /^(sls:stage|self:provider\.stage|opt:stage(\s*,.*)?)$/;

/** A value with its variables filled in for a stage, or null when one is only known when deployed. */
function resolve(value: string, tree: Tree, stage: string | null): string | null {
  let text = value;
  for (let inner = /\$\{([^${}]*)\}/.exec(text), left = 20; inner; inner = /\$\{([^${}]*)\}/.exec(text)) {
    // A value that names itself would never end.
    if (--left < 0) return null;
    const variable = (inner[1] ?? '').trim();
    const looked = variable.startsWith('self:') ? at(tree, variable.slice(5)) : undefined;
    const plain = typeof looked === 'string' || typeof looked === 'boolean' || typeof looked === 'number';
    const filled = STAGE.test(variable) ? stage : plain ? String(looked) : null;
    if (filled === null) return null;
    text = text.replace(inner[0], filled);
  }
  return text;
}

/**
 * The custom domain per stage: the stack's environments and the keys of any map the name is looked up in. A name with
 * no stage in it is one for every stage (token null). `unread` is a name only known when deployed.
 */
export function serverlessDomains(
  text: string,
  stages: string[],
): { found: { token: string | null; domains: Domain[] }[]; unread: string | null } {
  const tree = readTree(text);
  const raw = at(tree, 'custom.customDomain.domainName');
  if (typeof raw !== 'string') return { found: [], unread: null };
  const settings = {
    basePath: at(tree, 'custom.customDomain.basePath'),
    enabled: at(tree, 'custom.customDomain.enabled'),
  };
  // Values only known when deployed, in the order met.
  const unread: string[] = [];
  /** A setting for a stage: as written, filled in, or undefined (and said) when only known when deployed. */
  const valueOf = (value: unknown, stage: string | null): unknown => {
    if (typeof value !== 'string') return value;
    const filled = resolve(value, tree, stage);
    if (filled === null) unread.push(value);
    return filled ?? undefined;
  };
  const isHost = (host: string | null): host is string => !!host && /^[\w.-]+\.[a-z]{2,}$/i.test(host);
  /** The domain for a stage: none when turned off, null when a part of it is only known when deployed. */
  const domainOf = (stage: string | null): Domain[] | null => {
    const host = resolve(raw, tree, stage);
    if (!isHost(host)) return null;
    const enabled = valueOf(settings.enabled, stage);
    if (enabled === false || enabled === 'false') return [];
    const basePath = valueOf(settings.basePath, stage);
    if (
      (settings.enabled !== undefined && enabled === undefined) ||
      (settings.basePath !== undefined && basePath === undefined)
    )
      return null;
    const path = typeof basePath === 'string' && basePath !== '(none)' ? basePath.replace(/^\/|\/$/g, '') : '';
    return [{ host: host.toLowerCase(), from: 'api', ...(path && { path }) }];
  };
  const fixed = domainOf(null);
  if (fixed) return { found: fixed.length ? [{ token: null, domains: fixed }] : [], unread: null };
  unread.length = 0;
  const written = [raw, settings.basePath, settings.enabled].filter(value => typeof value === 'string');
  const maps = written
    .flatMap(value => [...value.matchAll(/\$\{self:([\w.-]+)\.\$\{[^}]*\}\}/g)])
    .map(match => at(tree, match[1] ?? ''));
  const keys = maps.flatMap(map => (map && typeof map === 'object' && !Array.isArray(map) ? Object.keys(map) : []));
  const found = [...new Set([...stages, ...keys])].flatMap(stage => {
    const domains = domainOf(stage);
    return domains?.length ? [{ token: stage, domains }] : [];
  });
  if (found.length) return { found, unread: null };
  return { found, unread: unread[0] ?? (isHost(resolve(raw, tree, stages[0] ?? null)) ? null : raw) };
}
