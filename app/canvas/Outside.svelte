<script lang="ts">
  import Cog from './Cog.svelte';
  import type { NodeProps } from '@xyflow/svelte';
  import type { OutsideNode } from './board.svelte.ts';
  import { dialogs } from './dialogs.svelte.ts';

  const { id, data, selected }: NodeProps<OutsideNode> = $props();
</script>

<div class="outside" class:selected title={data.about.join('\n')}>
  <span class="what">{data.name}</span>
  <button
    class="gear nodrag"
    type="button"
    aria-label="Settings for {data.name}"
    title="Settings: its addresses, and the apps it calls"
    onclick={() => void dialogs.settings?.open({ title: data.name, path: `apps.${id.slice(8)}` })}
  >
    <Cog size={13} />
  </button>
  <span class="where">{data.where}</span>
</div>

<style>
  .outside {
    position: relative;
    display: grid;
    row-gap: 3px;
    width: max-content;
    min-width: 200px;
    max-width: 420px;
    padding: 10px 34px 12px 12px;
    border: 1px dashed color-mix(in oklab, var(--muted) 55%, var(--line));
    border-radius: 10px;
    background: color-mix(in oklab, var(--paper) 60%, transparent);
    color: var(--ink);
    font: 12.5px/1.4 var(--sans);
    user-select: none;
    cursor: grab;
  }
  .outside.selected,
  :global(.svelte-flow__node:focus-visible) .outside {
    outline: 2px solid var(--cable);
    /* On the border itself: one frame, not a ring around a frame. */
    outline-offset: -1px;
  }
  .gear {
    position: absolute;
    top: 6px;
    right: 6px;
    display: grid;
    place-items: center;
    width: 22px;
    height: 22px;
    padding: 0;
    border: 0;
    border-radius: 5px;
    background: none;
    color: var(--muted);
    cursor: pointer;
  }
  .gear:hover {
    background: color-mix(in oklab, var(--ink) 9%, transparent);
    color: var(--ink);
  }
  .what {
    font-weight: 600;
    white-space: nowrap;
  }
  .where {
    font: 12px var(--sans);
    color: var(--muted);
  }
</style>
