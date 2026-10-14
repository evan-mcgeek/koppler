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

/**
 * Sends a request to the canvas server, which takes it with the page's own token (the page is served under
 * /s/<token>/). Null when the server could not be reached. `leaving` lets it go out while the page closes.
 */
export async function send(route: string, body: object = {}, leaving = false): Promise<Response | null> {
  const token = location.pathname.split('/')[2] ?? '';
  try {
    return await fetch(`/${route}?token=${encodeURIComponent(token)}`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(body),
      keepalive: leaving,
    });
  } catch {
    return null;
  }
}

/** Hands the board to the server to keep. False when it could not be kept. */
export const save = async (board: SavedBoard, leaving = false): Promise<boolean> =>
  !!(await send('state', board, leaving))?.ok;

/** Asks the canvas server to do something. Gives its answer, or why it was not done. */
export async function post<T extends object>(route: string, body: object = {}): Promise<T | { error: string }> {
  const answer = await send(route, body);
  if (!answer) return { error: 'Could not reach the canvas server.' };
  return (await answer.json().catch(() => ({ error: `The canvas server answered ${String(answer.status)}.` }))) as
    T | { error: string };
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
