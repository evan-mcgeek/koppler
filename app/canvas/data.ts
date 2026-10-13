// What the canvas knows from the server, asked for as JSON: the stack, the clones on this machine, and the board as it
// was left.
import type { Side } from '../src/core/arrange.ts';
import type { Clone, Registry } from '../src/data.ts';

/** A cable as the server keeps it. */
export interface SavedCable {
  from: string;
  to: string;
  fromSide?: Side;
  toSide?: Side;
  fromSlot?: number;
  toSlot?: number;
  fromShift?: number;
  toShift?: number;
  points?: { x: number; y: number }[];
}
/** The board as the server keeps it. What the canvas does not show yet (saved boards, tunnel cards) rides along. */
export interface SavedBoard extends Record<string, unknown> {
  env?: string;
  zoom?: number;
  pan?: { x: number; y: number };
  nodes?: Record<
    string,
    | ({ x: number; y: number; branch?: string; run?: string; platform?: string; note?: string } & Record<
        string,
        unknown
      >)
    | undefined
  >;
  edges?: SavedCable[];
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
    const answer = await fetch(`data/${name}.json`);
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

/** Hands the board to the server to keep. False when it could not be kept. */
export async function save(board: SavedBoard, leaving = false): Promise<boolean> {
  // The page is served under /s/<token>/: the same token lets it save.
  const token = location.pathname.split('/')[2] ?? '';
  try {
    const answer = await fetch(`/state?token=${encodeURIComponent(token)}`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(board),
      keepalive: leaving,
    });
    return answer.ok;
  } catch {
    return false;
  }
}

/** Asks the canvas server to do something. Gives its answer, or why it was not done. */
export async function post<T extends object>(route: string, body: object = {}): Promise<T | { error: string }> {
  const token = location.pathname.split('/')[2] ?? '';
  try {
    const answer = await fetch(`/${route}?token=${encodeURIComponent(token)}`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(body),
    });
    return (await answer.json()) as T | { error: string };
  } catch {
    return { error: 'Could not reach the canvas server.' };
  }
}

/** A clone found on this machine, for the repo picker. */
export interface Candidate {
  slug: string;
  name: string;
  kind: string | null;
  path: string;
  folder: string;
  inStack?: string;
}
/** The clones the last scan found, and the folders it looked in. Null when there was no scan yet. */
export const repos = () => ask<{ roots: string[]; repos: Candidate[] }>('repos');
