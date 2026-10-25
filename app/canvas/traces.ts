// Traces across the local apps: started here, then opened, where one request is followed across the board.
import { post } from './data.ts';
import { live } from './live.svelte.ts';
import { toasts } from './toast.svelte.ts';

/** What the Activity menu says for traces, by their state. */
export const tracesLabel = (): string => {
  const state = live.status?.traces?.state ?? 'off';
  return state === 'on' ? 'Open traces' : state === 'starting' ? 'Traces are starting' : 'Collect traces';
};
export const tracesAbout = (): string => {
  const state = live.status?.traces?.state ?? 'off';
  return state === 'on'
    ? 'Follow one request across your local apps, to where it failed'
    : state === 'starting'
      ? 'Starting the trace collector (Jaeger in Docker)'
      : 'Collect traces from the apps Koppler starts (Jaeger in Docker)';
};

export async function traces(): Promise<void> {
  const state = live.status?.traces?.state ?? 'off';
  if (state === 'on') {
    window.open(live.status?.traces?.view ?? '', '_blank', 'noopener');
    return;
  }
  if (state === 'starting') return;
  const said = await post('traces', { on: true });
  if ('error' in said) toasts.show(said.error, 'warning');
  else
    toasts.show('Collecting traces. Apps started from now on send theirs; restart the running ones to include them.');
}
