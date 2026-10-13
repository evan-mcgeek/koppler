// A place in the stack, written as a path: apps.orders.url, apps.orders.prereqs[0].port, queues.events.name.
// Reading one and changing one, on a copy: the stack itself is never changed in place.

export type Path = (string | number)[];

const KEY = /^[A-Za-z0-9_][\w.-]*$/;
// What would reach the object's prototype instead of its own fields.
const UNSAFE = new Set(['__proto__', 'prototype', 'constructor']);

/** The parts of a path, or why it is not one. A key with a dot in it is written in brackets: envAliases["qa.eu"]. */
export function parsePath(path: string): Path | { error: string } {
  const parts: Path = [];
  const re = /\.?([A-Za-z0-9_][\w-]*)|\[(\d+)\]|\["([^"\]]+)"\]/y;
  let at = 0;
  while (at < path.length) {
    re.lastIndex = at;
    const found = re.exec(path);
    if (!found || (at === 0 && path.startsWith('.'))) return { error: `${path} is not a path such as apps.orders.url` };
    const [, key, index, quoted] = found;
    if (index !== undefined) parts.push(Number(index));
    else parts.push((key ?? quoted) as string);
    at = re.lastIndex;
  }
  const bad = parts.find(part => typeof part === 'string' && (UNSAFE.has(part) || !KEY.test(part)));
  if (bad !== undefined) return { error: `${String(bad)} cannot be part of a path` };
  return parts.length ? parts : { error: 'give a path, such as apps.orders.url' };
}

const isObject = (value: unknown): value is Record<string, unknown> =>
  typeof value === 'object' && value !== null && !Array.isArray(value);

/** What is at the path, or undefined when nothing is. */
export function getAt(root: unknown, path: Path): unknown {
  let here = root;
  for (const part of path) {
    if (typeof part === 'number' ? !Array.isArray(here) : !isObject(here) || !Object.hasOwn(here, part))
      return undefined;
    here = (here as Record<string | number, unknown>)[part];
  }
  return here;
}

/**
 * A copy of the root with the value at the path, or without it when the value is undefined (a list closes up). Objects
 * on the way are made as needed; a list takes a new item only at its end.
 */
export function setAt(root: unknown, path: Path, value: unknown): unknown {
  const [part, ...rest] = path;
  if (part === undefined) return value;
  if (typeof part === 'number') {
    const list = Array.isArray(root) ? [...(root as unknown[])] : [];
    if (part > list.length) throw new Error(`there is no item ${String(part)} in this list`);
    if (!rest.length && value === undefined) list.splice(part, 1);
    else list[part] = setAt(list[part], rest, value);
    return list;
  }
  if (Array.isArray(root)) throw new Error(`${part} is not a place in a list`);
  const object = isObject(root) ? root : {};
  if (!rest.length && value === undefined)
    return Object.fromEntries(Object.entries(object).filter(([key]) => key !== part));
  return { ...object, [part]: setAt(object[part], rest, value) };
}
