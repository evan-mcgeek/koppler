// What the canvas knows from the server, asked for as JSON: the stack, the clones on this machine, and the board as it
// was left.
import type { Side } from '../src/core/arrange.ts';
import type { Clone, Registry } from '../src/data.ts';

export interface SavedBoard {
  env?: string;
  nodes?: Record<string, { x: number; y: number; branch?: string } | undefined>;
  edges?: { from: string; to: string; fromSide?: Side; toSide?: Side }[];
}
export interface Loaded {
  stack: Registry;
  clones: Record<string, Clone | null | undefined>;
  /** The folders clones are looked for in. */
  roots: string[];
  saved: SavedBoard | null;
}

async function ask<T>(name: string): Promise<T | null> {
  try {
    const answer = await fetch(`../data/${name}.json`);
    return answer.ok ? ((await answer.json()) as T) : null;
  } catch {
    return null;
  }
}

/** Null when there is no stack yet. */
export async function load(): Promise<Loaded | null> {
  const [stack, local, saved] = await Promise.all([
    ask<Registry>('registry'),
    ask<{ apps?: Loaded['clones']; roots?: string[] }>('local'),
    ask<SavedBoard>('state'),
  ]);
  return stack ? { stack, clones: local?.apps ?? {}, roots: local?.roots ?? [], saved } : null;
}
