<script lang="ts">
  import LogsIcon from '@lucide/svelte/icons/logs';
  import Icon from './Icon.svelte';
  import { ALL, logs } from './logs.svelte.ts';

  const open = $derived(logs.active === ALL);
</script>

<button
  class="open"
  type="button"
  aria-pressed={open}
  title="The log of every app on the board, in one stream"
  onclick={() => {
    logs.active = open ? null : ALL;
  }}
>
  <Icon of={LogsIcon} size={15} />Logs
</button>

<style>
  .open {
    display: inline-flex;
    align-items: center;
    gap: 7px;
    height: 32px;
    padding: 0 10px;
    border: 1px solid transparent;
    border-radius: 8px;
    background: none;
    color: var(--muted);
    font: 500 12.5px var(--sans);
    white-space: nowrap;
    cursor: pointer;
  }
  .open:hover,
  .open[aria-pressed='true'] {
    border-color: var(--line);
    color: var(--ink);
  }
</style>
