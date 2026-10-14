// Each run keeps its apps' logs: a log is copied into the run's folder when the run it belongs to is over (another run
// took its place, or the app restarts for another one). The newest runs are kept, and pinned ones too.
import fs from 'node:fs';
import path from 'node:path';
import { APP_ID, RUN_ID } from '../ids.ts';
import { writeJson } from '../json-files.ts';
import { logsDir, tempDir } from '../paths.ts';
import { live } from './history.ts';

const KEPT = 20;
const runsDir = () => path.join(tempDir(), 'runs');
const pinsFile = () => path.join(tempDir(), 'pinned.json');

export function pinned(): string[] {
  try {
    const ids: unknown = JSON.parse(fs.readFileSync(pinsFile(), 'utf8'));
    return Array.isArray(ids) ? ids.filter((id): id is string => typeof id === 'string' && RUN_ID.test(id)) : [];
  } catch {
    return [];
  }
}

/** Keeps a run's logs whatever happens, or lets them go with the oldest again. */
export function pin(id: string, on: boolean): void {
  const now = pinned().filter(one => one !== id);
  writeJson(pinsFile(), on ? [...now, id] : now);
  if (!on) prune();
}

/** The apps a run kept logs of. */
export function runLogs(id: string): string[] {
  if (!RUN_ID.test(id)) return [];
  try {
    return fs
      .readdirSync(path.join(runsDir(), id))
      .filter(file => file.endsWith('.log'))
      .map(file => file.slice(0, -4))
      .filter(name => APP_ID.test(name));
  } catch {
    return [];
  }
}

/** Where a run's log of an app is, when it kept one. */
export const runLog = (id: string, name: string): string | null =>
  RUN_ID.test(id) && APP_ID.test(name) ? path.join(runsDir(), id, `${name}.log`) : null;

/** Copies an app's log into the folder of the run it belongs to, the live one, once. */
export function keepRunLog(name: string): void {
  const run = live();
  const to = run?.id && run.nodes[name] ? runLog(run.id, name) : null;
  const from = path.join(logsDir(), `${name}.log`);
  if (!to || fs.existsSync(to) || !fs.existsSync(from)) return;
  fs.mkdirSync(path.dirname(to), { recursive: true, mode: 0o700 });
  fs.copyFileSync(from, to);
  fs.chmodSync(to, 0o600);
  prune();
}

/** Every app of the live run, as another run takes its place: not the one starting now. */
export function keepRunLogs(starting?: string): void {
  const run = live();
  if (run && run.id !== starting) for (const name of Object.keys(run.nodes)) keepRunLog(name);
}

/** Drops the logs of all but the newest runs, unless a run is pinned. */
function prune(): void {
  let ids: string[];
  try {
    ids = fs.readdirSync(runsDir()).filter(id => RUN_ID.test(id));
  } catch {
    return;
  }
  const age = (id: string) => fs.statSync(path.join(runsDir(), id)).mtimeMs;
  const keep = new Set([...pinned(), ...ids.sort((a, b) => age(b) - age(a)).slice(0, KEPT)]);
  for (const id of ids) if (!keep.has(id)) fs.rmSync(path.join(runsDir(), id), { recursive: true, force: true });
}
