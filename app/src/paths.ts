// Where Koppler keeps its files. Never inside the install folder, which an npm or plugin update replaces.
//   STATE: ~/.local/state/koppler (XDG state): run state, boards, history, the action log, logs, process records.
//   TEMP:  STATE/run, the files the canvas and the agent share (status, prompts, registry copy, debug log).
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const here = path.dirname(fileURLToPath(import.meta.url));
// The app's own folder: src/ (the engine, the server, the canvas) and bin/ (the scripts that touch secrets).
export const APP = path.resolve(here, '..');
/** The folder the code runs from. */
export const CODE = here;
export const BIN = path.join(APP, 'bin');
const xdgState = process.env.XDG_STATE_HOME || path.join(os.homedir(), '.local', 'state');
export const STATE = process.env.KOPPLER_STATE || path.join(xdgState, 'koppler');
export const TEMP = process.env.KOPPLER_TEMP || path.join(STATE, 'run');
export const LOGS = process.env.KOPPLER_LOGS || path.join(STATE, 'logs');
