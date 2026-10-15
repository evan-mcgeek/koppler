// `{{<app>.<field>}}` in a stack value: another app's fact, filled in where the stack is used, so a port is written once.
// stack.json keeps the expression; only what reads the stack to act on it sees the value.

type Loose = Record<string, unknown>;
const isObject = (value: unknown): value is Loose =>
  typeof value === 'object' && value !== null && !Array.isArray(value);
const EXPRESSION = /\{\{\s*([a-z0-9-]+)\.([A-Za-z]\w*)\s*\}\}/g;
const WHOLE = /^\{\{\s*([a-z0-9-]+)\.([A-Za-z]\w*)\s*\}\}$/;
type Fact = string | number | boolean;
const isFact = (value: unknown): value is Fact =>
  (typeof value === 'string' && !value.includes('{{')) || typeof value === 'number' || typeof value === 'boolean';

function resolver(apps: Loose) {
  /** What `{{app.field}}` stands for: a field of that app, or its url's port or host; undefined when nothing. */
  const lookup = (app: string, field: string, seen: readonly string[]): Fact | undefined => {
    const key = `${app}.${field}`;
    const facts = Object.hasOwn(apps, app) ? apps[app] : undefined;
    if (!isObject(facts) || seen.includes(key)) return undefined;
    if (Object.hasOwn(facts, field)) {
      const value = fill(facts[field], [...seen, key]);
      return isFact(value) ? value : undefined;
    }
    if (field !== 'port' && field !== 'host') return undefined;
    const url = lookup(app, 'url', [...seen, key]);
    if (typeof url !== 'string' || !URL.canParse(url)) return undefined;
    const { port, hostname } = new URL(url);
    return field === 'host' ? hostname : Number(port) || undefined;
  };
  const fill = (value: unknown, seen: readonly string[]): unknown => {
    if (typeof value === 'string') {
      // A value that is only an expression takes the type of what it names, so a port stays a number.
      const whole = WHOLE.exec(value);
      if (whole) return lookup(whole[1] ?? '', whole[2] ?? '', seen) ?? value;
      return value.replace(EXPRESSION, (text, app: string, field: string) => {
        const found = lookup(app, field, seen);
        return found === undefined ? text : String(found);
      });
    }
    if (Array.isArray(value)) return value.map(item => fill(item, seen));
    if (isObject(value)) return Object.fromEntries(Object.entries(value).map(([key, item]) => [key, fill(item, seen)]));
    return value;
  };
  return fill;
}

/** The stack with every expression filled in; one that names nothing stays as written. */
export function resolveExpressions<T>(stack: T): T {
  if (!isObject(stack) || !isObject(stack['apps'])) return stack;
  return resolver(stack['apps'])(stack, []) as T;
}

/** Each expression that names no app's field, or only itself, as `where: what`. */
export function expressionProblems(stack: unknown): string[] {
  if (!isObject(stack) || !isObject(stack['apps'])) return [];
  const resolved = resolveExpressions(stack);
  const problems: string[] = [];
  const walk = (value: unknown, after: unknown, at: string) => {
    if (typeof value === 'string' && typeof after === 'string')
      for (const [text] of after.matchAll(EXPRESSION))
        problems.push(
          `${at}: ${text} names no field of an app (or only itself); use {{<app>.<field>}}, such as {{orders-api.port}}`,
        );
    else if (Array.isArray(value) && Array.isArray(after))
      value.forEach((item, index) => {
        walk(item, after[index], `${at}[${String(index)}]`);
      });
    else if (isObject(value) && isObject(after))
      for (const [key, item] of Object.entries(value)) walk(item, after[key], at ? `${at}.${key}` : key);
  };
  walk(stack, resolved, '');
  return problems;
}
