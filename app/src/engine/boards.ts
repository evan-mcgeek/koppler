// Changing a board from the terminal. The change goes into state.json at once, and waits in board-edits.json for an
// open canvas to make it on its own copy too, so the canvas shows it and never saves its older copy over it.
import { describeEdit, editPreset, VERSION, type BoardEdit, type StoredPreset } from '../core/presets.ts';
import type { Edge } from '../core/plan.ts';
import { readClones, readData, readStack, writeData } from '../data.ts';
import { fail } from '../failure.ts';
import { alive, readRecord } from './processes.ts';
import { currentStack } from './stacks.ts';

export interface QueuedEdit {
  id: string;
  at: string;
  stack: string | null;
  board: string;
  edit: BoardEdit;
  /** A board made from the terminal: a canvas that does not have it starts it empty. */
  create?: true;
}

const queued = () => (readData('board-edits')?.['edits'] ?? []) as QueuedEdit[];
const DAY = 86_400_000;

/** The edits an open canvas of the stack in use has not made yet. */
export const boardEdits = (): QueuedEdit[] => queued().filter(one => one.stack === currentStack());

/** The canvas made it (or had it already): it waits no longer. */
export function editDone(id: unknown): void {
  writeData('board-edits', { edits: queued().filter(one => one.id !== id) });
}

const CHANGES =
  '[--add <app,...>] [--remove <app,...>] [--cable <caller>:<callee>]... [--uncable <caller>:<callee>]... [--branch <app>=<branch>]... [--note <app>="<note>"]... [--arrange]';
const USAGE = `usage: koppler board new "<name>" ${CHANGES}\n       koppler board edit "<name>" ${CHANGES}`;

export function boardCommand(args: string[]): void {
  const [what, name] = args;
  if ((what !== 'edit' && what !== 'new') || !name?.trim() || name.startsWith('-')) fail(USAGE);
  const create = what === 'new';
  const stack = readStack() ?? fail('no stack loaded (koppler init)');
  const values = (flag: string) => args.filter((_, at) => args[at - 1] === flag);
  const ids = (flag: string) =>
    values(flag).flatMap(value =>
      value
        .split(',')
        .map(id => id.trim())
        .filter(Boolean),
    );
  const pairs = (flag: string, by: string) =>
    values(flag).map(value => {
      const at = value.indexOf(by);
      if (at < 1) fail(`${flag} ${value}: expected <app>${by}<value>\n${USAGE}`);
      return [value.slice(0, at), value.slice(at + 1)] as const;
    });
  const cables = (flag: string): Edge[] => pairs(flag, ':').map(([from, to]) => ({ from, to }));
  const edit: BoardEdit = {
    add: ids('--add'),
    remove: ids('--remove'),
    cable: cables('--cable'),
    uncable: cables('--uncable'),
    branch: Object.fromEntries(pairs('--branch', '=')),
    note: Object.fromEntries(pairs('--note', '=')),
    ...(args.includes('--arrange') && { arrange: true }),
  };

  const state = readData('state') ?? {};
  const own = (state['presets'] ?? []) as StoredPreset[];
  const team = (stack.presets ?? []) as StoredPreset[];
  const lower = name.toLowerCase();
  const found =
    [...own, ...team].find(one => one.name === name) ?? [...own, ...team].find(one => one.name.toLowerCase() === lower);
  if (create && found) fail(`a board called ${found.name} already exists; change it with koppler board edit`);
  const board: StoredPreset =
    found ??
    (create
      ? { name: name.trim(), version: VERSION, nodes: {}, edges: [] }
      : fail(`no board called ${name}; koppler board new makes one, koppler use --boards lists them`));
  const app = (id: string) => stack.apps[id];
  const clones = readClones();
  for (const id of edit.add ?? []) {
    if (!app(id)) fail(`${id} is not an app in the stack`);
    if (app(id)?.outside) fail(`${app(id)?.name ?? id} does not run on this Mac`);
    if (!clones[id]) fail(`${app(id)?.name ?? id} is not cloned on this Mac (koppler sync prints how)`);
  }
  const on = new Set([...Object.keys(board.nodes).filter(id => !edit.remove?.includes(id)), ...(edit.add ?? [])]);
  const here = (id: string, why: string) => {
    if (!on.has(id)) fail(`${id} is not on ${board.name}, so it cannot ${why}`);
  };
  for (const id of edit.remove ?? []) if (!Object.hasOwn(board.nodes, id)) fail(`${id} is not on ${board.name}`);
  for (const id of Object.keys(edit.branch ?? {})) here(id, 'take a branch');
  for (const id of Object.keys(edit.note ?? {})) here(id, 'take a note');
  for (const { from, to } of edit.cable ?? []) {
    here(from, 'call');
    here(to, 'be called');
  }

  const changed = { ...editPreset(board, edit), name: board.name };
  if (!create && JSON.stringify(changed) === JSON.stringify(board)) {
    console.log(`Nothing to change on ${board.name}.`);
    return;
  }
  const mine = own.some(one => one.name === board.name);
  writeData('state', {
    ...state,
    presets: mine ? own.map(one => (one.name === board.name ? changed : one)) : [...own, changed],
  });
  const now = Date.now();
  const entry: QueuedEdit = {
    id: now.toString(36) + Math.random().toString(36).slice(2, 8),
    at: new Date(now).toISOString(),
    stack: currentStack(),
    board: board.name,
    edit,
    ...(create && { create: true as const }),
  };
  writeData('board-edits', {
    edits: [...queued().filter(one => now - Date.parse(one.at) < DAY), entry],
  });
  const canvas = readRecord('canvas');
  const said = describeEdit(edit, id => app(id)?.name ?? id);
  console.log(`${create ? 'MADE' : 'CHANGED'} ${board.name}${said ? `: ${said}` : ''}`);
  console.log(
    canvas && alive(canvas)
      ? 'An open canvas shows the change as soon as it is in view.'
      : 'The canvas shows the change when it is opened.',
  );
}
