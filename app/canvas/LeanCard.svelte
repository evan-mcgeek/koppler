<script lang="ts">
  // A card on the Discover map: its name, its kind, and where its code is or what it is. On the board it is solid;
  // one step away it is drawn back. A +N chip on it brings in the links it leaves out.
  import Laptop from '@lucide/svelte/icons/laptop';
  import type { NodeProps } from '@xyflow/svelte';
  import { discovered, type LeanData } from './discover.svelte.ts';

  const { id, data, selected }: NodeProps & { data: LeanData } = $props();
  let height = $state(0);
  // Its links meet its edges where it is drawn, however tall its name makes it.
  $effect(() => {
    if (height && discovered.heights[id] !== height) discovered.heights = { ...discovered.heights, [id]: height };
  });
</script>

<div class="lean" class:ring={!data.onBoard} class:picked={selected} title={data.name} bind:offsetHeight={height}>
  <span class="top">
    <span class="name">{data.name}</span>
    <span class="tag">{data.tag}</span>
  </span>
  <span class="meta">
    {#if data.cloned}<Laptop size={12} aria-hidden="true" /><span class="here">Cloned here</span>{:else}{data.meta}{/if}
  </span>
  {#if data.hidden}
    <button
      class="more nodrag"
      type="button"
      title="Show {data.hidden} more {data.hidden === 1 ? 'link' : 'links'}"
      aria-label="Show {data.hidden} more {data.hidden === 1 ? 'link' : 'links'} of {data.name}"
      onclick={ev => {
        ev.stopPropagation();
        discovered.open(id);
      }}>+{data.hidden}</button
    >
  {/if}
</div>

<style>
  .lean {
    position: relative;
    display: flex;
    flex-direction: column;
    gap: 5px;
    box-sizing: border-box;
    width: 200px;
    min-height: 64px;
    padding: 9px 11px;
    border: 1px solid var(--line-strong);
    background: var(--panel);
    color: var(--ink);
    cursor: pointer;
  }
  /* One step from the board: no fill, a hairline edge, the name and tag drawn back. */
  .lean.ring {
    border-color: var(--line);
    background: var(--desk);
  }
  .lean.picked {
    outline: 2px solid var(--ink);
    outline-offset: 2px;
  }
  .top {
    display: flex;
    align-items: flex-start;
    gap: 8px;
  }
  .name {
    flex: 1;
    min-width: 0;
    font: 600 14px/18px var(--sans);
    overflow-wrap: anywhere;
    text-wrap: pretty;
  }
  .ring .name {
    color: var(--ink-muted);
  }
  .tag {
    flex: none;
    padding: 1px 5px;
    border: 1px solid var(--line-strong);
    color: var(--ink-muted);
    font: 400 10px var(--mono);
    letter-spacing: 0.06em;
    text-transform: uppercase;
    white-space: nowrap;
  }
  .meta {
    display: flex;
    align-items: center;
    gap: 6px;
    color: var(--ink-muted);
    font: 400 12px var(--sans);
    white-space: nowrap;
  }
  .here {
    color: var(--ink);
  }
  .ring .here {
    color: var(--ink-muted);
  }
  /* On the edge facing the hidden links: clicking brings exactly those in, and the chip goes. */
  .more {
    position: absolute;
    top: 50%;
    right: -14px;
    padding: 1px 5px;
    border: 1px solid var(--line-strong);
    background: var(--desk);
    color: var(--ink);
    font: 600 11px/18px var(--mono);
    transform: translateY(-50%);
    cursor: pointer;
  }
  .more:hover,
  .more:focus-visible {
    border-color: var(--ink);
    outline: none;
  }
</style>
