// A Serverless Framework app's custom domain (serverless-domain-manager), per stage, from its serverless.yml.
import type { Domain } from './terraform.ts';

type Tree = { [key: string]: Tree | string };

/** The block mappings of a YAML file as nested objects; lists and flow values are skipped. */
function readMappings(text: string): Tree {
  const root: Tree = {};
  const open: { indent: number; tree: Tree }[] = [{ indent: -1, tree: root }];
  for (const line of text.split('\n')) {
    // ponytail: block mappings with plain or quoted values only; anchors, lists and multi-line values are not read.
    const match = /^( *)([\w.-]+|"[^"]*"|'[^']*'):(?:\s+(.*?))?\s*$/.exec(line.replace(/\s+#.*$/, ''));
    if (!match) continue;
    const [, spaces = '', rawKey = '', value = ''] = match;
    while ((open.at(-1)?.indent ?? -1) >= spaces.length) open.pop();
    const parent = open.at(-1)?.tree ?? root;
    const key = rawKey.replace(/^["']|["']$/g, '');
    if (value) parent[key] = value.replace(/^"(.*)"$|^'(.*)'$/, '$1$2');
    else open.push({ indent: spaces.length, tree: (parent[key] = {}) });
  }
  return root;
}

const at = (tree: Tree, dotted: string): Tree | string | undefined =>
  dotted
    .split('.')
    .reduce<Tree | string | undefined>((node, key) => (typeof node === 'object' ? node[key] : undefined), tree);

const STAGE = /^(sls:stage|self:provider\.stage|opt:stage(\s*,.*)?)$/;

/** A value with its variables filled in for a stage, or null when one is only known when deployed. */
function resolve(value: string, tree: Tree, stage: string | null): string | null {
  let text = value;
  for (let inner = /\$\{([^${}]*)\}/.exec(text), left = 20; inner; inner = /\$\{([^${}]*)\}/.exec(text)) {
    // A value that names itself would never end.
    if (--left < 0) return null;
    const variable = (inner[1] ?? '').trim();
    const looked = variable.startsWith('self:') ? at(tree, variable.slice(5)) : undefined;
    const filled = STAGE.test(variable) ? stage : typeof looked === 'string' ? looked : null;
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
  const tree = readMappings(text);
  const raw = at(tree, 'custom.customDomain.domainName');
  if (typeof raw !== 'string') return { found: [], unread: null };
  const basePath = at(tree, 'custom.customDomain.basePath');
  const path = typeof basePath === 'string' && basePath !== '(none)' ? basePath.replace(/^\/|\/$/g, '') : '';
  const domain = (host: string): Domain[] => [{ host: host.toLowerCase(), from: 'api', ...(path && { path }) }];
  const isHost = (host: string | null): host is string => !!host && /^[\w.-]+\.[a-z]{2,}$/i.test(host);
  const fixed = resolve(raw, tree, null);
  if (isHost(fixed)) return { found: [{ token: null, domains: domain(fixed) }], unread: null };
  const maps = [...raw.matchAll(/\$\{self:([\w.-]+)\.\$\{[^}]*\}\}/g)].map(match => at(tree, match[1] ?? ''));
  const keys = maps.flatMap(map => (typeof map === 'object' ? Object.keys(map) : []));
  const found = [...new Set([...stages, ...keys])].flatMap(stage => {
    const host = resolve(raw, tree, stage);
    return isHost(host) ? [{ token: stage, domains: domain(host) }] : [];
  });
  return { found, unread: found.length ? null : raw };
}
