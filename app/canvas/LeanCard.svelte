<script lang="ts">
  // A card on the Discover map: its name and its kind; the rest is in its panel. On a feature board, the cards it does
  // not use are drawn back. A dashed +N hidden counts the links the chosen areas leave out, and opens the
  // Areas checklist.
  import type { NodeProps } from '@xyflow/svelte';
  import { AREAS, discovered, type LeanData } from './discover.svelte.ts';
  import { live } from './live.svelte.ts';

  const { id, data, selected }: NodeProps & { data: LeanData } = $props();
  /** Its open threads, and whether the agent is at work on the last one. */
  const talks = $derived(discovered.openOn({ card: id }));
  const asked = $derived(
    talks.some(one => one.thread.at(-1)?.by === 'you') && (live.status?.agent?.state ?? 'none') === 'busy',
  );
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
  class:roomy={data.outside.length > 0 && discovered.direction !== 'DOWN'}
  title={data.name}
  bind:offsetHeight={height}
>
  <span class="top">
    <span class="name">{data.name}</span>
    {#if data.edited}<span class="edited" title={data.edited.says}>{data.edited.tag}</span>{/if}
    <span class="tag">{data.tag}</span>
  </span>
  <!-- Name and kind only: what it is, its repo, branch, schedule and a dead end are in its panel. -->
  {#if data.deadEnd}
    <!-- Where its links would go on: they stop here. -->
    <span class="stub" class:down={discovered.direction === 'DOWN'} aria-hidden="true"></span>
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
  {#if talks.length}
    <button
      class="talk nodrag"
      class:asked
      type="button"
      aria-label="{talks.length} {talks.length === 1 ? 'comment' : 'comments'} on {data.name}"
      title={asked ? 'The agent is looking into it' : 'Open the thread'}
      onclick={ev => {
        ev.stopPropagation();
        discovered.thread = { id: talks[0]?.id ?? '' };
      }}>{talks.length}</button
    >
  {/if}
  {#if data.outside.length}
    <button
      class="away nodrag"
      class:down={discovered.direction === 'DOWN'}
      type="button"
      title="Not in your areas: {data.outside.join(', ')}"
      aria-label="{data.outside.length} {data.outside.length === 1
        ? 'link'
        : 'links'} of {data.name} hidden by your areas"
      popovertarget={AREAS}
      onclick={ev => {
        ev.stopPropagation();
      }}>+{data.outside.length} hidden</button
    >
  {/if}
</div>

<style>
  /* A job: its schedule and whose repo it ships from between hairlines, and a foot saying it is always deployed. */
  .lean {
    position: relative;
    display: flex;
    flex-direction: column;
    gap: 5px;
    box-sizing: border-box;
    width: 200px;
    padding: 9px 11px;
    border: 1px solid var(--line-strong);
    background: var(--panel);
    color: var(--ink);
    cursor: pointer;
  }
  /* Not on the board: no fill, a hairline edge, the name and tag drawn back. */
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
  /* Solid, unlike its kind: something here the shared stack does not have yet. */
  .edited {
    flex: none;
    padding: 1px 5px;
    background: var(--ink);
    color: var(--desk);
    font: 600 10px var(--sans);
    white-space: nowrap;
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
  .away:hover,
  .away:focus-visible {
    border-color: var(--ink);
    outline: none;
  }
  /* Dashed: not in your view. It sits on an edge no link leaves from: under the card, or left of it laid out down. */
  .away {
    position: absolute;
    top: 100%;
    left: 50%;
    padding: 0 5px;
    border: 1px dashed var(--line-strong);
    background: var(--desk);
    color: var(--ink);
    font: 600 11px/16px var(--mono);
    white-space: nowrap;
    transform: translate(-50%, -50%);
    cursor: pointer;
  }
  .away.down {
    top: 50%;
    left: 14px;
    transform: translate(-100%, -50%);
  }
  .lean.roomy {
    padding-bottom: 14px;
  }
  /* Its open threads: an ink marker on its corner, with a warn dot while the agent works on one. */
  .talk {
    position: absolute;
    top: -9px;
    right: -9px;
    min-width: 20px;
    padding: 0 5px;
    border: 1px solid var(--ink);
    background: var(--ink);
    color: var(--desk);
    font: 600 11px/16px var(--mono);
    cursor: pointer;
  }
  .talk.asked::after {
    content: '';
    position: absolute;
    top: -4px;
    right: -4px;
    width: 6px;
    height: 6px;
    background: var(--warn);
  }
</style>
