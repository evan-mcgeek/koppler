// Changing a board from the terminal. The change goes into state.json at once, and waits in board-edits.json for an
// open canvas to make it on its own copy too, so the canvas shows it and never saves its older copy over it.
import path from 'node:path';
import { inStack, kindBetween, type FeatureEdit } from '../core/feature.ts';
import { describeEdit, editPreset, migrate, VERSION, type BoardEdit, type StoredPreset } from '../core/presets.ts';
import { canvas } from '../cli/running.ts';
import { fetchPresets } from '../server/sanitize.ts';
import type { Edge } from '../core/plan.ts';
import { readClones, readData, readStack, writeData } from '../data.ts';
import { fail } from '../failure.ts';
import { appendMessage } from './messages.ts';
import { alive, readRecord } from './processes.ts';
import { shareBoard } from './share.ts';
import { currentStack } from './stacks.ts';

export interface QueuedEdit {
  id: string;
  at: string;
  stack: string | null;
  board: string;
  edit: BoardEdit;
  /** A board made from the terminal: a canvas that does not have it starts it empty. */
  create?: true;
  /** A board opened from a file or a link: an open canvas takes it whole. */
  preset?: StoredPreset;
  /** A board deleted from the terminal: an open canvas moves it to Recently deleted too. */
  delete?: true;
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
  '[--propose] [--add <app,...>] [--remove <app,...>] [--cable <caller>:<callee>]... [--uncable <caller>:<callee>]... [--branch <app>=<branch>]... [--note <app>="<note>"]... [--arrange] [--request "<words>"] [--phase "<name>"] [--step|--propose-step <from>:<to>[="<note>"]]... [--unstep <from>:<to>]...';
const USAGE = `usage: koppler board new "<name>" ${CHANGES}\n       koppler board edit "<name>" ${CHANGES}\n       koppler board share "<name>"\n       koppler board open <file or link>\n       koppler board delete "<name>"`;

/** Queues a change for an open canvas of the stack in use, dropping ones a day old that no canvas took. */
function enqueue(change: Omit<QueuedEdit, 'id' | 'at' | 'stack'>): void {
  const now = Date.now();
  const entry: QueuedEdit = {
    id: now.toString(36) + Math.random().toString(36).slice(2, 8),
    at: new Date(now).toISOString(),
    stack: currentStack(),
    ...change,
  };
  writeData('board-edits', { edits: [...queued().filter(one => now - Date.parse(one.at) < DAY), entry] });
}

/** Your own board, by name, as kept for this stack. */
const ownBoard = (name: string): StoredPreset | undefined => {
  const own = (readData('state')?.['presets'] ?? []) as StoredPreset[];
  return own.find(one => one.name === name) ?? own.find(one => one.name.toLowerCase() === name.toLowerCase());
};

/** Opens the pull request that makes one of your boards a team board of the stack in use. */
async function share(name: string): Promise<void> {
  const dir = currentStack() ?? fail('no stack in use (koppler use)');
  const board = ownBoard(name) ?? fail(`${name} is not one of your boards; koppler use --boards lists them`);
  const shared = await shareBoard(dir, board);
  if (shared.error !== undefined) fail(shared.error);
  if (shared.local)
    console.log(
      `KEPT ${board.name} among the stack's team boards in ${dir}; commit the stack there so your team gets it.`,
    );
  else console.log(`PROPOSED ${board.name} to the team on ${shared.repo}: ${shared.url}`);
}

/** One of your boards goes to Recently deleted, where the board picker can bring it back. */
function deleteBoard(name: string): void {
  const board =
    ownBoard(name) ??
    fail(`${name} is not one of your boards; koppler use --boards lists them (a team board is kept in the stack)`);
  const state = readData('state') ?? {};
  const own = (state['presets'] ?? []) as StoredPreset[];
  const trash = (state['trash'] ?? []) as unknown[];
  const { preset: onScreen, ...rest } = state;
  writeData('state', {
    ...rest,
    ...(onScreen !== board.name && { preset: onScreen }),
    presets: own.filter(one => one.name !== board.name),
    trash: [{ ...board, deleted: new Date().toISOString() }, ...trash].slice(0, 20),
  });
  enqueue({ board: board.name, edit: {}, delete: true });
  console.log(`DELETED ${board.name}; Recently deleted in the board picker brings it back.`);
}

export function boardCommand(args: string[]): void | Promise<void> {
  const [what, name] = args;
  if (what === 'delete' && name?.trim() && !name.startsWith('-')) {
    deleteBoard(name);
    return;
  }
  if (what === 'share' && name && !name.startsWith('-')) return share(name);
  if (what === 'open' && name && !name.startsWith('-')) return openBoard(name, args.includes('--no-open'));
  if ((what !== 'edit' && what !== 'new') || !name?.trim() || name.startsWith('-')) fail(USAGE);
  const create = what === 'new';
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
    ...(featureEdit(args) ?? {}),
  };
  for (const line of changeBoard(name, edit, create, args.includes('--propose'))) console.log(line);
}

/**
 * A feature's request, phases and steps from the arguments, in their order: a step goes in the phase named before it.
 * A card is an app's id, `queue:<id>` or `database:<id>`.
 */
function featureEdit(args: string[]): { feature: FeatureEdit } | null {
  const flags = ['--request', '--phase', '--step', '--propose-step', '--unstep'];
  if (!args.some(arg => flags.includes(arg))) return null;
  const stack = readStack() ?? fail('no stack loaded (koppler init)');
  const edit: FeatureEdit = {};
  let phase: string | undefined;
  const pair = (flag: string, value: string | undefined) => {
    const [ends = '', ...said] = (value ?? '').split('=');
    const [from = '', to = '', ...more] = ends.split(':').reduce<string[]>((cards, part) => {
      // `queue:events` and `database:orders` are one card each.
      const last = cards.at(-1);
      if (last === 'queue' || last === 'database') cards[cards.length - 1] = `${last}:${part}`;
      else cards.push(part);
      return cards;
    }, []);
    if (!from || !to || more.length) fail(`${flag} ${value ?? ''}: expected <from>:<to>\n${USAGE}`);
    for (const card of [from, to])
      if (!inStack(stack, card)) fail(`${card} is not in the stack: an app's id, queue:<id> or database:<id>`);
    const note = said.join('=').trim();
    return { from, to, ...(note && { note }) };
  };
  args.forEach((arg, at) => {
    const value = args[at + 1];
    if (arg === '--request') edit.request = value ?? '';
    else if (arg === '--phase' && value?.trim()) {
      phase = value.trim();
      edit.phase = [...(edit.phase ?? []), phase];
    } else if (arg === '--step' || arg === '--propose-step') {
      const step = pair(arg, value);
      edit.step = [
        ...(edit.step ?? []),
        {
          ...step,
          kind: kindBetween(stack, step.from, step.to),
          ...(phase && { phase }),
          ...(arg === '--propose-step' && { proposed: true as const }),
        },
      ];
    } else if (arg === '--unstep') {
      const { from, to } = pair(arg, value);
      edit.unstep = [...(edit.unstep ?? []), { from, to }];
    }
  });
  return { feature: edit };
}

/**
 * `koppler board open <file or link>`: a board from a file here or a link on GitHub joins your boards, and the canvas
 * opens on it. It remembers where it came from, so the canvas can read it again (Reload).
 */
async function openBoard(where: string, quiet: boolean): Promise<void> {
  const source = /^https?:\/\//.test(where) ? where : path.resolve(where);
  if (!/^https?:/.test(source) && !source.endsWith('.json')) fail(`${where}: a board file is a .json file`);
  const read = await fetchPresets(source);
  if (read.error !== undefined) fail(read.error);
  const [first] = read.presets;
  const checked = first && migrate(first);
  if (!first || !checked || checked.error !== undefined) fail(checked?.error ?? 'No board found in it.');
  // Kept as the plain board it was read as.
  const board = JSON.parse(JSON.stringify({ ...first, name: first.name.trim().slice(0, 80), source })) as StoredPreset;
  const state = readData('state') ?? {};
  const own = (state['presets'] ?? []) as StoredPreset[];
  writeData('state', { ...state, presets: [...own.filter(one => one.name !== board.name), board] });
  enqueue({ board: board.name, edit: {}, preset: board });
  console.log(`OPENED ${board.name} from ${source}`);
  if (quiet) console.log(`An open canvas shows it; or: koppler canvas --board "${board.name}"`);
  else await canvas(['--board', board.name]);
}

/** A change an agent proposed, waiting for the user's answer in the inbox. */
interface Proposal {
  message: string;
  stack: string | null;
  board: string;
  edit: BoardEdit;
  create?: true;
}
const proposals = () => (readData('board-proposals')?.['proposals'] ?? []) as Proposal[];

/**
 * The user answered a proposal: the change is made as `koppler board edit` makes it, or left. Null when the message
 * was no proposal.
 */
export function answerProposal(message: string, accepted: boolean): string | null {
  const proposal = proposals().find(one => one.message === message);
  if (!proposal) return null;
  writeData('board-proposals', { proposals: proposals().filter(one => one !== proposal && one.message !== message) });
  if (!accepted) return `Left ${proposal.board} as it is.`;
  return changeBoard(proposal.board, proposal.edit, !!proposal.create, false).join(' ');
}

/** Checks a change to a board and makes it, or, proposed, asks the user in the inbox first and changes nothing. */
export function changeBoard(name: string, edit: BoardEdit, create: boolean, propose: boolean): string[] {
  const stack = readStack() ?? fail('no stack loaded (koppler init)');
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
  if (!create && JSON.stringify(changed) === JSON.stringify(board)) return [`Nothing to change on ${board.name}.`];
  const named = (id: string) =>
    id.startsWith('queue:')
      ? (stack.queues?.[id.slice(6)]?.name ?? id)
      : id.startsWith('database:')
        ? (stack.databases?.[id.slice(9)]?.name ?? id)
        : (app(id)?.name ?? id);
  if (propose) {
    const asked = appendMessage({
      kind: 'question',
      title: create ? `Make the board ${board.name}?` : `Change ${board.name}?`,
      summary: 'The agent proposes this. Nothing changes until you say yes.',
      sections: [{ title: 'It would', items: describeEdit(edit, named, true).split('; ').filter(Boolean) }],
      choices: [
        { id: 'accept', label: create ? 'Make it' : 'Make the change' },
        { id: 'reject', label: 'Leave it as it is' },
      ],
    });
    writeData('board-proposals', {
      proposals: [
        ...proposals(),
        { message: asked.id, stack: currentStack(), board: board.name, edit, ...(create && { create: true as const }) },
      ],
    });
    return [
      `PROPOSED ${board.name}: ${describeEdit(edit, named)}`,
      'The user answers in the canvas inbox; the answer comes back as a koppler-reply prompt.',
    ];
  }
  const mine = own.some(one => one.name === board.name);
  writeData('state', {
    ...state,
    presets: mine ? own.map(one => (one.name === board.name ? changed : one)) : [...own, changed],
  });
  enqueue({ board: board.name, edit, ...(create && { create: true as const }) });
  const canvas = readRecord('canvas');
  const said = describeEdit(edit, named);
  return [
    `${create ? 'MADE' : 'CHANGED'} ${board.name}${said ? `: ${said}` : ''}`,
    canvas && alive(canvas)
      ? 'An open canvas shows the change as soon as it is in view.'
      : 'The canvas shows the change when it is opened.',
  ];
}
