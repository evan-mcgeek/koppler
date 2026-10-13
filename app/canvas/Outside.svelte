<script lang="ts">
  import type { NodeProps } from '@xyflow/svelte';
  import type { OutsideNode } from './board.svelte.ts';

  const { data, selected }: NodeProps<OutsideNode> = $props();
</script>

<div class="outside" class:selected title={data.about.join('\n')}>
  <span class="what">{data.name}</span>
  <span class="where">{data.where}</span>
</div>

<style>
  .outside {
    display: grid;
    row-gap: 3px;
    width: max-content;
    min-width: 200px;
    max-width: 420px;
    padding: 10px 12px 12px;
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
  .what {
    font-weight: 600;
    white-space: nowrap;
  }
  .where {
    font: 12px var(--sans);
    color: var(--muted);
  }
</style>
