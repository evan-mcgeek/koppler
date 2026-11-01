<script lang="ts">
  // A card on the Discover map: its name, its kind, and where its code is or what it is. On the board it is solid;
  // one step away it is drawn back. A +N chip on it brings in the links it leaves out.
  import GitBranch from '@lucide/svelte/icons/git-branch';
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

<div
  class="lean"
  class:ring={!data.onBoard}
  class:proposed={data.proposed}
  class:picked={selected}
  title={data.name}
  bind:offsetHeight={height}
>
  {#if data.repo}<span class="repo">{data.repo} /</span>{/if}
  <span class="top">
    <span class="name">{data.name}</span>
    <span class="tag">{data.tag}</span>
  </span>
  <span class="meta">
    {#if data.changed}<GitBranch size={12} aria-hidden="true" /><span class="here changed" title={data.changed}
        >{data.changed}</span
      >{:else if data.cloned}<Laptop size={12} aria-hidden="true" /><span class="here">Cloned here</span>{:else}<span
        class="what"
        title={data.meta}>{data.meta}</span
      >{/if}
  </span>
  {#if data.deadEnd}
    <span class="dead">Dead end · no readers</span>
    <!-- Where its links would go on: they stop here. -->
    {#if !data.hidden}<span class="stub" class:down={discovered.direction === 'DOWN'} aria-hidden="true"></span>{/if}
  {/if}
  {#if data.proposed}
    <span class="proposal">
      <strong>Proposed</strong>
      <span class="answers">
        <button
          class="nodrag"
          type="button"
          aria-label="Accept {data.name}"
          onclick={ev => {
            ev.stopPropagation();
            void discovered.accept(discovered.proposalsOf(id));
          }}>Accept</button
        >
        <button
          class="nodrag"
          type="button"
          aria-label="Drop {data.name}"
          onclick={ev => {
            ev.stopPropagation();
            discovered.drop(discovered.proposalsOf(id));
          }}>Drop</button
        >
      </span>
    </span>
  {/if}
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
  /* The agent's, not accepted yet: dashed, with its answers on it. */
  .lean.proposed {
    border-style: dashed;
    background: var(--desk);
  }
  .proposal {
    display: grid;
    gap: 4px;
    color: var(--ink);
    font: 600 12px var(--sans);
  }
  .answers {
    display: flex;
    gap: 10px;
  }
  .answers button {
    padding: 0;
    border: 0;
    background: none;
    color: var(--ink);
    font: 400 12px var(--sans);
    text-decoration: underline;
    text-underline-offset: 3px;
    cursor: pointer;
  }
  .lean.picked {
    outline: 2px solid var(--ink);
    outline-offset: 2px;
  }
  /* A piece of a repo that holds other apps too: the repo above its name. */
  .repo {
    margin-bottom: -3px;
    overflow: hidden;
    color: var(--ink-muted);
    font: 400 11px var(--sans);
    white-space: nowrap;
    text-overflow: ellipsis;
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
  /* A long description stays inside its card. */
  .what,
  .changed {
    min-width: 0;
    overflow: hidden;
    text-overflow: ellipsis;
  }
  .here {
    color: var(--ink);
  }
  .ring .here {
    color: var(--ink-muted);
  }
  /* Flagged, not drawn as a link: a short line out that stops at a bar. */
  .dead {
    display: flex;
    align-items: center;
    gap: 6px;
    color: var(--warn);
    font: 600 12px var(--sans);
    white-space: nowrap;
  }
  .dead::before {
    content: '';
    width: 10px;
    height: 2px;
    background: var(--warn);
  }
  .stub {
    position: absolute;
    top: 50%;
    left: 100%;
    width: 20px;
    height: 2px;
    background: var(--warn);
    transform: translateY(-50%);
  }
  .stub::after {
    content: '';
    position: absolute;
    top: -7px;
    right: 0;
    width: 2px;
    height: 16px;
    background: var(--warn);
  }
  .stub.down {
    top: 100%;
    left: 50%;
    width: 2px;
    height: 20px;
    transform: translateX(-50%);
  }
  .stub.down::after {
    top: auto;
    right: -7px;
    bottom: 0;
    width: 16px;
    height: 2px;
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
