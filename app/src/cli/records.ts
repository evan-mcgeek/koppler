// What an agent records while it helps with a run, through commands: the changes Stop must undo, and the steps a card
// shows. Nobody writes these files by hand, so each entry is checked and each file is written whole.
import fs from 'node:fs';
import path from 'node:path';
import { fail } from '../failure.ts';
import { readActions, updateActions, type Action } from '../engine/actions.ts';
import { APP_ID } from '../ids.ts';
import { readJson, writeJson } from '../json-files.ts';
import { TEMP } from '../paths.ts';
import { redact } from '../scrub.ts';
import { flagValue, positional } from './output.ts';

const LOG = () => path.join(TEMP, 'actions.json');
/** What each kind of entry cannot do without. `checkout` is written by `koppler switch` only. */
const NEEDS: Record<string, string[]> = {
  edit: ['file', 'before', 'after'],
  profile: ['file', 'name'],
  'env-file': ['file', 'lines'],
  file: ['file'],
  'npm-local': ['repo', 'packages'],
  process: ['command'],
  secret: ['app', 'env'],
};
const ACTIONS = "usage: koppler actions [--json] | add '<json>' | add --file <json file> | clear [--app <app>]";

function checked(entry: unknown): Action {
  if (typeof entry !== 'object' || entry === null || Array.isArray(entry)) fail('an entry is an object with a kind');
  const fields = entry as Record<string, unknown>;
  const kind = typeof fields['kind'] === 'string' ? fields['kind'] : '';
  const needs = Object.hasOwn(NEEDS, kind) ? NEEDS[kind] : undefined;
  if (!needs) fail(`kind "${kind}" is not one an entry can have: ${Object.keys(NEEDS).join(', ')}`);
  const missing = needs.filter(name => fields[name] === undefined);
  if (missing.length) fail(`a ${kind} entry needs ${missing.join(', ')}`);
  if (fields['app'] !== undefined && !(typeof fields['app'] === 'string' && APP_ID.test(fields['app'])))
    fail('app is an app id of the stack');
  // Stop looks a file up by its full path; one written from another folder would be found in the wrong place.
  if (typeof fields['file'] === 'string' && !path.isAbsolute(fields['file']))
    fail(`file is a full path, not ${fields['file']}`);
  const text = JSON.stringify(entry);
  if (redact(text) !== text) fail('the entry holds what looks like a secret value; the log never keeps one');
  return entry as Action;
}

/** `koppler actions`: the changes Stop undoes; `add` logs one before it is made, `clear` empties the log after a revert. */
export function actionsCommand(args: string[]): void {
  const [verb] = positional(args, ['--file', '--app']);
  if (verb === 'add') {
    const file = flagValue(args, '--file');
    const given = file ? fs.readFileSync(file, 'utf8') : (positional(args, ['--file'])[1] ?? fail(ACTIONS));
    let parsed: unknown;
    try {
      parsed = JSON.parse(given);
    } catch {
      fail(
        'that is not JSON: an entry such as {"kind":"env-file","app":"orders","file":"/full/path/.env.local","lines":["A=1"]}',
      );
    }
    const entries = [parsed].flat().map(checked);
    const total = updateActions(LOG(), list => list.push(...entries));
    console.log(
      `Logged ${String(entries.length)} ${entries.length === 1 ? 'change' : 'changes'}; ${String(total)} for Stop to undo.`,
    );
    return;
  }
  if (verb === 'clear') {
    const app = flagValue(args, '--app');
    const left = updateActions(LOG(), list => {
      const keep = app ? list.filter(action => action.app !== app) : [];
      list.splice(0, list.length, ...keep);
      return keep.length;
    });
    console.log(app ? `Cleared ${app}'s entries; ${String(left)} left.` : 'The action log is empty.');
    return;
  }
  if (verb) fail(ACTIONS);
  const list = readActions(LOG());
  if (args.includes('--json')) console.log(JSON.stringify(list, null, 2));
  else if (!list.length) console.log('Nothing logged: Stop has no change to undo.');
  else
    for (const action of list)
      console.log(`${action.app ?? '-'}  ${action.kind}  ${'file' in action ? action.file : ''}`);
}

const STATES = ['done', 'todo', 'user', 'failed'];
const STEP =
  'usage: koppler status step <app> "<label>" done|todo|user|failed [--detail "<what>"] [--copy "<command>"] [--port <n>] [--log <file>] | step <app> --clear';
interface Step {
  label: string;
  state: string;
  detail?: string;
  copy?: string;
}
interface Shown {
  apps?: Record<string, { port?: number; log?: string; steps?: Step[] } | undefined>;
}

/** `koppler status step`: one step of an app's checklist on its card, set or replaced by its label. */
export function stepCommand(args: string[]): void {
  const [app, label, state] = positional(args, ['--detail', '--copy', '--port', '--log']);
  if (!app || !APP_ID.test(app)) fail(STEP);
  const file = path.join(TEMP, 'status.json');
  const read = readJson(file);
  const shown: Shown = typeof read === 'object' && read !== null && !Array.isArray(read) ? read : {};
  const apps = { ...shown.apps };
  if (args.includes('--clear')) {
    delete apps[app]; // eslint-disable-line @typescript-eslint/no-dynamic-delete -- checked to be an app id
    writeJson(file, { ...shown, apps });
    console.log(`${app}: no steps of yours on its card.`);
    return;
  }
  if (!label || !state || !STATES.includes(state)) fail(STEP);
  const cut = (text: string | undefined, most: number) => (text ? redact(text).slice(0, most) : undefined);
  const detail = cut(flagValue(args, '--detail'), 400);
  const copy = cut(flagValue(args, '--copy'), 2000);
  const port = Number(flagValue(args, '--port'));
  const log = flagValue(args, '--log');
  const step: Step = { label: label.slice(0, 60), state, ...(detail && { detail }), ...(copy && { copy }) };
  const now = apps[app] ?? {};
  const steps = now.steps ?? [];
  const at = steps.findIndex(one => one.label === step.label);
  apps[app] = {
    ...now,
    ...(Number.isInteger(port) && port > 0 && port < 65536 && { port }),
    ...(log && { log: path.resolve(log) }),
    steps: at >= 0 ? steps.with(at, step) : [...steps, step],
  };
  writeJson(file, { ...shown, apps });
  console.log(`${app}: ${step.label} ${state}`);
}
