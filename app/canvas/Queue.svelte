<script lang="ts">
  import type { NodeProps } from '@xyflow/svelte';
  import { board, type QueueNode } from './board.svelte.ts';

  const { data, selected }: NodeProps<QueueNode> = $props();
  const env = $derived(board.env.toUpperCase());
</script>

<div class="queue" class:local={data.local} class:selected title={data.about.join('\n')}>
  <span class="what">{data.name}</span>
  <span class="kind">{data.kind}</span>
  <button
    class="hide nodrag"
    type="button"
    aria-label="Hide {data.name}"
    title="Hide this queue: its apps use the deployed one. Bring it back from Queues on an app's card."
    onclick={() => {
      board.showQueues([data.queue], false);
    }}>×</button
  >
  <span class="seg nodrag" role="radiogroup" aria-label="Which {data.name} its apps use">
    <label title="The {env} queue">
      <input
        type="radio"
        name="queue-{data.queue}"
        checked={!data.local}
        onchange={() => {
          board.setQueue(data.queue, false);
        }}
      />Deployed
    </label>
    <label
      aria-disabled={!data.can}
      title={data.can
        ? 'Koppler runs it on your Mac and points its apps at it'
        : `Koppler cannot run a ${data.kind} queue locally yet`}
    >
      <input
        type="radio"
        name="queue-{data.queue}"
        checked={data.local}
        disabled={!data.can}
        onchange={() => {
          board.setQueue(data.queue, true);
        }}
      />Local
    </label>
  </span>
  {#if data.shares}<span class="shares">{data.shares}</span>{/if}
</div>

<style>
  .queue {
    display: grid;
    grid-template-columns: 1fr auto auto;
    column-gap: 8px;
    row-gap: 3px;
    align-items: baseline;
    width: max-content;
    min-width: 200px;
    max-width: 420px;
    padding: 10px 12px 12px;
    border: 1px solid color-mix(in oklab, var(--msg) 60%, var(--line));
    border-radius: 10px;
    background: var(--surface);
    color: var(--ink);
    font: 12.5px/1.4 var(--sans);
    user-select: none;
    cursor: grab;
  }
  .queue.local {
    border-color: var(--msg);
    box-shadow: 0 0 0 1px var(--msg);
  }
  .queue.selected,
  :global(.svelte-flow__node:focus-visible) .queue {
    outline: 2px solid var(--cable);
    /* On the border itself: one frame, not a ring around a frame. */
    outline-offset: -1px;
  }
  .what {
    font-weight: 600;
    white-space: nowrap;
  }
  .kind {
    font: 12px var(--mono);
    color: var(--muted);
  }
  .hide {
    align-self: center;
    width: 24px;
    height: 24px;
    margin: -6px -4px -6px 0;
    padding: 0;
    border: 0;
    border-radius: 5px;
    background: none;
    color: var(--muted);
    font-size: 15px;
    line-height: 1;
    cursor: pointer;
  }
  .hide:hover {
    background: color-mix(in oklab, var(--ink) 9%, transparent);
    color: var(--ink);
  }
  .seg {
    grid-column: 1 / -1;
    justify-self: start;
    display: inline-flex;
    gap: 2px;
    margin-top: 4px;
    padding: 2px;
    border: 1px solid var(--line);
    border-radius: 8px;
    background: color-mix(in oklab, var(--ink) 5%, transparent);
  }
  .seg label {
    position: relative;
    padding: 2px 10px;
    border-radius: 6px;
    color: var(--muted);
    font-weight: 600;
    font-size: 12px;
    cursor: pointer;
  }
  .seg input {
    position: absolute;
    inset: 0;
    margin: 0;
    opacity: 0;
    cursor: pointer;
  }
  .seg label:has(input:checked) {
    background: var(--surface);
    color: var(--ink);
    box-shadow: 0 1px 2px rgb(0 0 0 / 0.12);
  }
  .local .seg label:has(input:checked) {
    background: var(--msg);
    color: var(--on-accent);
  }
  .seg label[aria-disabled='true'],
  .seg label[aria-disabled='true'] input {
    opacity: 0.45;
    cursor: not-allowed;
  }
  .seg label[aria-disabled='true'] input {
    opacity: 0;
  }
  .seg label:has(input:focus-visible) {
    outline: 2px solid var(--cable);
    outline-offset: 1px;
  }
  .shares {
    grid-column: 1 / -1;
    color: var(--warn);
    font-size: 12px;
    font-weight: 600;
  }
</style>
