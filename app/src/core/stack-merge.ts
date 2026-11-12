// Folding one stack into another: what only the other has is added, field by field, and each field both have with
// different values is a conflict, settled by the user. Pure: reading, checking and writing the stacks is the caller's.
import { parsePath, type Path } from './stack-path.ts';

export type Side = 'ours' | 'theirs';
/** A field both stacks have with different values, or one a lock keeps out; `kept` says which side the merge took. */
export interface Conflict {
  path: string;
  ours: unknown;
  theirs: unknown;
  kept?: Side;
  locked?: true;
}
export interface Merged {
  stack: Record<string, unknown>;
  /** What the other stack brings that this one lacks, as paths. */
  added: string[];
  conflicts: Conflict[];
}

type Loose = Record<string, unknown>;
const isObject = (value: unknown): value is Loose =>
  typeof value === 'object' && value !== null && !Array.isArray(value);
const same = (a: unknown, b: unknown) => JSON.stringify(a) === JSON.stringify(b);
// The stack's own: merging into it keeps its name, and its format is the one both were read in.
const OWN = new Set(['name', 'koppler']);

/** A path as `koppler stack set` takes it: a key that is no plain word, and a board's name, go in brackets. */
const pathText = (parts: Path) =>
  parts
    .map((part, at) =>
      typeof part === 'number'
        ? `[${String(part)}]`
        : /^[A-Za-z0-9_][\w-]*$/.test(part) && !(at === 1 && parts[0] === 'presets')
          ? `${at ? '.' : ''}${part}`
          : `["${part}"]`,
    )
    .join('');

const boardName = (board: unknown) => (isObject(board) ? String(board['name']) : '');
const teamBoards = (stack: Loose): unknown[] => (Array.isArray(stack['presets']) ? stack['presets'] : []);

/** The names more than one of the stack's team boards go by: a merge tells boards apart by name. */
export function sameNamedBoards(stack: Loose): string[] {
  const names = teamBoards(stack).map(boardName);
  return [...new Set(names.filter((name, at) => names.indexOf(name) !== at))];
}

/**
 * `theirs` folded into `ours`. Each conflict is settled by its path in `keep`, else by `prefer`; one left unsettled
 * keeps ours. A field at, under or above a `locked` path keeps ours whatever is asked.
 */
export function mergeStacks(
  ours: Loose,
  theirs: Loose,
  {
    keep = {},
    prefer,
    locked = [],
  }: { keep?: Record<string, Side>; prefer?: Side | undefined; locked?: string[] } = {},
): Merged {
  // A lock on a team board by its place names the board there, as the merge does.
  const locks = locked
    .map(parsePath)
    .filter((parts): parts is Path => Array.isArray(parts))
    .map((parts): Path =>
      parts[0] === 'presets' && typeof parts[1] === 'number'
        ? ['presets', boardName(teamBoards(ours)[parts[1]]), ...parts.slice(2)]
        : parts,
    );
  const under = (outer: Path, inner: Path) =>
    outer.length <= inner.length && outer.every((part, n) => part === inner[n]);
  const isLocked = (at: Path) => locks.some(lock => under(lock, at) || under(at, lock));
  const added: string[] = [];
  const conflicts: Conflict[] = [];

  const differ = (a: unknown, b: unknown, at: Path): unknown => {
    const path = pathText(at);
    if (isLocked(at)) {
      conflicts.push({ path, ours: a, theirs: b, kept: 'ours', locked: true });
      return a;
    }
    if (a === undefined) {
      added.push(path);
      return b;
    }
    const kept = keep[path] ?? prefer;
    conflicts.push({ path, ours: a, theirs: b, ...(kept && { kept }) });
    return kept === 'theirs' ? b : a;
  };
  const merge = (a: unknown, b: unknown, at: Path): unknown => {
    if (same(a, b)) return a;
    if (at.length === 1 && at[0] === 'notes' && !isLocked(at)) {
      // The stack's notes are facts, each kept: ours, then each of theirs ours lacks.
      const lines = (notes: unknown): unknown[] =>
        Array.isArray(notes) ? notes : typeof notes === 'string' ? [notes] : [];
      const mine = lines(a);
      const fresh = lines(b).filter(line => !mine.includes(line));
      fresh.forEach((_, n) => added.push(pathText([...at, mine.length + n])));
      return fresh.length ? [...mine, ...fresh] : a;
    }
    if (at.length === 1 && at[0] === 'presets' && Array.isArray(a) && Array.isArray(b)) {
      // Team boards are told apart by name: every one of ours stays, in its place.
      const ourBoards: unknown[] = a;
      const theirBoards: unknown[] = b;
      const mine = new Set(ourBoards.map(boardName));
      const other = new Map(theirBoards.map(board => [boardName(board), board]));
      return [
        ...ourBoards.map(board => {
          const name = boardName(board);
          return other.has(name) ? merge(board, other.get(name), [...at, name]) : board;
        }),
        ...theirBoards
          .filter(board => !mine.has(boardName(board)))
          .map(board => differ(undefined, board, [...at, boardName(board)])),
      ].filter(board => board !== undefined);
    }
    // A board is taken whole, as a list is.
    if (!isObject(a) || !isObject(b) || at[0] === 'presets') return differ(a, b, at);
    const out: Loose = {};
    for (const [key, value] of Object.entries(a))
      out[key] =
        Object.hasOwn(b, key) && !(at.length === 0 && OWN.has(key)) ? merge(value, b[key], [...at, key]) : value;
    for (const [key, value] of Object.entries(b))
      if (!Object.hasOwn(a, key) && !(at.length === 0 && OWN.has(key))) {
        const taken = differ(undefined, value, [...at, key]);
        if (taken !== undefined) out[key] = taken;
      }
    return out;
  };
  return { stack: merge(ours, theirs, []) as Loose, added, conflicts };
}
