<script lang="ts">
  import Icon from './Icon.svelte';
  import Waypoints from '@lucide/svelte/icons/waypoints';
  // Traces across the local apps: started here, then opened, where one request is followed across the board.
  import { post } from './data.ts';
  import { live } from './live.svelte.ts';
  import { toasts } from './toast.svelte.ts';

  const state = $derived(live.status?.traces?.state ?? 'off');
  const go = async () => {
    if (state === 'on') {
      window.open(live.status?.traces?.view ?? '', '_blank', 'noopener');
      return;
    }
    if (state === 'starting') return;
    const said = await post('traces', { on: true });
    if ('error' in said) toasts.show(said.error, 'warning');
    else
      toasts.show('Collecting traces. Apps started from now on send theirs; restart the running ones to include them.');
  };
</script>

<button
  class="open"
  type="button"
  data-state={state}
  aria-label={state === 'on' ? 'Open traces' : state === 'starting' ? 'Traces are starting' : 'Collect traces'}
  title={state === 'on'
    ? 'Follow one request across your local apps, to where it failed'
    : state === 'starting'
      ? 'Starting the trace collector (Jaeger in Docker)'
      : 'Collect traces from the apps Koppler starts (Jaeger in Docker)'}
  onclick={() => void go()}
>
  <Icon of={Waypoints} size={16} />
</button>

<style>
  .open {
    position: relative;
    display: grid;
    place-items: center;
    width: 32px;
    height: 32px;
    padding: 0;
    border: 1px solid transparent;
    border-radius: 8px;
    background: none;
    color: var(--muted);
    cursor: pointer;
  }
  .open:hover {
    border-color: var(--line);
    color: var(--ink);
  }
  .open[data-state='on'] {
    color: var(--cable);
  }
  .open[data-state='starting'] {
    cursor: progress;
  }
  .open[data-state='on']::after {
    content: '';
    position: absolute;
    top: 5px;
    right: 5px;
    width: 7px;
    height: 7px;
    border-radius: 50%;
    background: var(--ok);
  }
</style>
