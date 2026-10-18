<script lang="ts">
  import ScrollText from '@lucide/svelte/icons/scroll-text';
  import Icon from './Icon.svelte';
  import { ALL, logs } from './logs.svelte.ts';

  const open = $derived(logs.active === ALL);
</script>

<button
  class="open"
  type="button"
  aria-label="All apps log"
  aria-pressed={open}
  title="The log of every app on the board, in one stream"
  onclick={() => {
    logs.active = open ? null : ALL;
  }}
>
  <Icon of={ScrollText} size={16} />
</button>

<style>
  .open {
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
  .open:hover,
  .open[aria-pressed='true'] {
    border-color: var(--line);
    color: var(--ink);
  }
</style>
