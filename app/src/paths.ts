// Where Koppler keeps its files. Never inside the install folder, which an npm or plugin update replaces.
//   stateDir(): ~/.local/state/koppler (XDG state): run state, boards, history, the action log, logs, process records.
//   tempDir():  stateDir()/run, the files the canvas and the agent share (status, prompts, registry copy, debug log).
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const here = path.dirname(fileURLToPath(import.meta.url));
// The app's own folder: src/ (the engine, the server, the canvas) and bin/ (the scripts that touch secrets).
export const APP = path.resolve(here, '..');
/** The folder the code runs from. */
export const CODE = here;
export const BIN = path.join(APP, 'bin');
// Under test, the user's own state and config are refused: a test that reaches them fails instead of changing them.
const outsideOwn = (dir: string): string => {
  if (!process.env['KOPPLER_TEST_SANDBOX']) return dir;
  const home = os.userInfo().homedir;
  const own = [path.join(home, '.local', 'state', 'koppler'), path.join(home, '.config', 'koppler')];
  const full = path.resolve(dir);
  if (own.some(mine => full === mine || full.startsWith(mine + path.sep)))
    throw new Error(`a test reached ${full}; tests keep to their sandbox`);
  return dir;
};
// Read on each call, so a test or a child process that sets the variable later is followed.
export const stateDir = () =>
  outsideOwn(
    process.env['KOPPLER_STATE'] ||
      path.join(process.env['XDG_STATE_HOME'] || path.join(os.homedir(), '.local', 'state'), 'koppler'),
  );
export const tempDir = () => outsideOwn(process.env['KOPPLER_TEMP'] || path.join(stateDir(), 'run'));
export const logsDir = () => outsideOwn(process.env['KOPPLER_LOGS'] || path.join(stateDir(), 'logs'));
export const configDir = () =>
  outsideOwn(process.env['KOPPLER_CONFIG_DIR'] || path.join(os.homedir(), '.config', 'koppler'));
