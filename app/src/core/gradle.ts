// The app id an Android variant installs as, read from its Gradle file only when every part of it is plain text.

const ASK = 'set it: koppler stack set apps.<app>.mobile.androidPackage <id>';
const KEY = /\bapplicationId(?:Suffix)?\b/g;
// Blocks that change every build type or flavor in code: Koppler does not read them.
const NOT_A_NAME = new Set(['all', 'configureEach', 'each', 'forEach', 'matching', 'withType', 'whenObjectAdded']);

const stripComments = (text: string) => text.replace(/\/\*[\s\S]*?\*\//g, '').replace(/(^|\s)\/\/.*$/gm, '$1');

/** The text inside the braces that open at `open`. */
function inside(text: string, open: number): string {
  let depth = 0;
  for (let at = open; at < text.length; at++) {
    if (text[at] === '{') depth++;
    else if (text[at] === '}' && --depth === 0) return text.slice(open + 1, at);
  }
  return text.slice(open + 1);
}

/** The block's own lines, without the blocks nested in it. */
function own(text: string): string {
  let out = '';
  let depth = 0;
  for (const char of text) {
    if (char === '{') depth++;
    else if (char === '}') depth--;
    else if (depth === 0) out += char;
  }
  return out;
}

function block(text: string, name: string): string | undefined {
  const found = new RegExp(`\\b${name}\\s*\\{`).exec(text);
  return found ? inside(text, found.index + found[0].length - 1) : undefined;
}

/** The named blocks directly inside a block: `debug { }`, `getByName("debug") { }`, `create("free") { }`. */
function children(text: string | undefined): Map<string, string> {
  const found = new Map<string, string>();
  if (text === undefined) return found;
  const header = /(?:\b(\w+)|\b(?:getByName|create|named|maybeCreate|register)\(\s*["'](\w+)["']\s*\))\s*\{/g;
  for (const match of text.matchAll(header)) {
    const before = text.slice(0, match.index);
    if (before.split('{').length !== before.split('}').length) continue;
    const name = match[1] ?? match[2] ?? '';
    if (!NOT_A_NAME.has(name)) found.set(name, inside(text, match.index + match[0].length - 1));
  }
  return found;
}

type Value = { text: string } | 'unread' | undefined;

/** A setting's plain text value in a block's own lines; 'unread' when it is set some other way. */
function value(lines: string, key: 'applicationId' | 'applicationIdSuffix'): Value {
  const set = lines.split('\n').filter(line => new RegExp(`\\b${key}\\b(?!Suffix)`).test(line));
  if (!set.length) return undefined;
  const plain = new RegExp(`^\\s*${key}\\s*(?:=\\s*|\\(\\s*|\\s+)(["'])([^"'$\\\\]*)\\1\\s*\\)?\\s*;?\\s*$`);
  const last = plain.exec(set.at(-1) ?? '');
  return set.length === 1 && last ? { text: last[2] ?? '' } : 'unread';
}

/** How many times the ids are set in these blocks' own lines. */
const counted = (blocks: (string | undefined)[]) =>
  blocks.reduce((sum, text) => sum + (text === undefined ? 0 : (own(text).match(KEY) ?? []).length), 0);

/** The variant's build type (the longest known name it ends with) and its flavors, in the order the name gives them. */
function split(variant: string, types: string[], flavors: string[]): { type: string; flavors: string[] } | null {
  const lower = variant.toLowerCase();
  const type = types.filter(name => lower.endsWith(name.toLowerCase())).sort((a, b) => b.length - a.length)[0];
  if (type === undefined) return null;
  let rest = lower.slice(0, lower.length - type.length);
  const picked: string[] = [];
  while (rest) {
    const next = flavors.filter(name => rest.startsWith(name.toLowerCase())).sort((a, b) => b.length - a.length)[0];
    if (next === undefined) return null;
    picked.push(next);
    rest = rest.slice(next.length);
  }
  return picked.length || !flavors.length ? { type, flavors: picked } : null;
}

/**
 * The id the variant installs as: the first flavor's own id, else the default one (else the namespace), then the
 * default, flavor and build type suffixes. Anything set in code, or a name Koppler does not know, asks instead.
 */
export function androidAppId(gradle: string, variant: string): { id: string; error?: undefined } | { error: string } {
  const text = stripComments(gradle);
  const unread = { error: `the app id of ${variant} is not plain text in its Gradle file; ${ASK}` };
  const defaults = block(text, 'defaultConfig');
  const types = children(block(text, 'buildTypes'));
  const flavors = children(block(text, 'productFlavors'));
  // Every place the id is set must be one read here: one set in code elsewhere could change it per variant.
  if ((text.match(KEY) ?? []).length !== counted([defaults, ...types.values(), ...flavors.values()])) return unread;
  const parts = split(variant, [...new Set(['debug', 'release', ...types.keys()])], [...flavors.keys()]);
  if (!parts) return { error: `no build type or flavor of the Gradle file makes ${variant}; ${ASK}` };
  const typeLines = own(types.get(parts.type) ?? '');
  const values: Value[] = [];
  let id: Value = undefined;
  // ponytail: with several flavor dimensions, the first flavor's id wins and suffixes join in name order, as AGP does for
  // the usual case; a build that relies on another order sets mobile.androidPackage.
  for (const flavor of [...parts.flavors].reverse()) {
    const lines = own(flavors.get(flavor) ?? '');
    id = value(lines, 'applicationId') ?? id;
    values.push(value(lines, 'applicationIdSuffix'));
  }
  const defaultLines = own(defaults ?? '');
  id ??= value(defaultLines, 'applicationId');
  if (id === undefined) {
    const namespace = /^\s*namespace\s*(?:=\s*|\s+)(["'])([^"'$\\]+)\1\s*$/m.exec(text);
    if (!namespace) return { error: `no applicationId found in its Gradle file; ${ASK}` };
    id = { text: namespace[2] ?? '' };
  }
  // A build type made from another one takes that one's suffix unless it sets its own.
  if (/\binitWith\b/.test(typeLines) && value(typeLines, 'applicationIdSuffix') === undefined) return unread;
  const suffixes = [
    value(defaultLines, 'applicationIdSuffix'),
    ...values.reverse(),
    value(typeLines, 'applicationIdSuffix'),
  ];
  if (id === 'unread' || suffixes.includes('unread')) return unread;
  const tail = suffixes.map(suffix => (suffix === undefined || suffix === 'unread' ? '' : suffix.text)).join('');
  return { id: `${id.text}${tail}` };
}
