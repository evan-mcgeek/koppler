// An app's state in words the canvas, `koppler status --json` and `koppler wait` share.
import { readStack } from '../data.ts';
import { alive, listener, readRecord, statusOf, tailOf } from './processes.ts';

export type AppState =
  'waiting' | 'building' | 'running' | 'unhealthy' | 'exited' | 'failed-to-start' | 'secret-missing';
export interface StateOf {
  state: AppState;
  detail: string;
}
interface Step {
  label: string;
  state: string;
  detail?: string;
}

/** What its process says: building until its port answers, unhealthy while its ready check fails; null when none ran. */
export async function processState(name: string): Promise<StateOf | null> {
  const record = readRecord(name);
  if (!record) return null;
  if (!alive(record)) {
    const last = tailOf(record.log, 1).trim();
    return { state: 'exited', detail: last ? `It stopped. Its last line: ${last.slice(0, 200)}` : 'It stopped.' };
  }
  if (record.port && !listener(record.port, record.bind))
    return { state: 'building', detail: `Nothing answers on port ${String(record.port)} yet.` };
  const app = readStack()?.apps[name];
  if (!app?.ready || !app.url) return { state: 'running', detail: '' };
  const url = new URL(app.ready.path, app.url);
  const status = await statusOf(url);
  const ok = status !== null && (app.ready.status === undefined ? status < 400 : status === app.ready.status);
  if (ok) return { state: 'running', detail: '' };
  return {
    state: 'unhealthy',
    detail: status === null ? `Nothing answers at ${url.pathname}.` : `${url.pathname} answers ${String(status)}.`,
  };
}

/** The state to show: a live process first, then what the run says of its start, then a secret it lacks. */
export function stateOf(process: StateOf | null, steps: Step[] = [], missing: string[] = []): StateOf | null {
  const start = steps.find(step => step.label === 'Start');
  if (process && process.state !== 'exited') return process;
  if (start?.state === 'failed') return { state: 'failed-to-start', detail: start.detail ?? '' };
  if (process) return process;
  if (start?.state === 'todo') return { state: 'waiting', detail: start.detail ?? '' };
  if (missing.length) return { state: 'secret-missing', detail: missing.join(', ') };
  return null;
}
