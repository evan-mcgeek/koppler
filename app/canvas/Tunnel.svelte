<script lang="ts">
  import type { NodeProps } from '@xyflow/svelte';
  import { board, type TunnelNode } from './board.svelte.ts';

  const { id, data, selected }: NodeProps<TunnelNode> = $props();
</script>

<div class="tunnel" class:selected title={[data.host, ...data.about].join('\n')}>
  <span class="live" aria-hidden="true"></span>
  <span class="what">{data.what}</span>
  <span class="local" class:moved={data.moved}>{data.local}</span>
  <button
    class="hide nodrag"
    type="button"
    aria-label="Run without this tunnel"
    title="Turn it off: the tunnel is not opened, so calls to it fail. Turn Tunnels back on on the app's card to bring it back."
    onclick={() => {
      board.hideTunnel(id);
    }}>×</button
  >
  <span class="host">{data.host}</span>
</div>

<style>
  .tunnel {
    display: grid;
    grid-template-columns: 8px 1fr auto auto;
    column-gap: 8px;
    row-gap: 3px;
    align-items: baseline;
    width: max-content;
    min-width: 200px;
    max-width: 420px;
    padding: 10px 10px 12px 14px;
    border: 1px dashed color-mix(in oklab, var(--muted) 55%, var(--line));
    border-radius: 10px;
    background: var(--paper);
    color: var(--ink);
    font: 12.5px/1.4 var(--sans);
    user-select: none;
    cursor: grab;
  }
  .tunnel.selected,
  :global(.svelte-flow__node:focus-visible) .tunnel {
    outline: 2px solid var(--cable);
    outline-offset: 3px;
  }
  .live {
    align-self: center;
    width: 8px;
    height: 8px;
    border-radius: 50%;
    background: var(--line);
  }
  .what {
    font-weight: 600;
    white-space: nowrap;
  }
  .local {
    font: 12px var(--mono);
    color: var(--muted);
  }
  .local.moved {
    color: var(--warn);
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
  .host {
    grid-column: 2 / -1;
    max-width: 34ch;
    font: 12px var(--mono);
    color: var(--muted);
    overflow-wrap: anywhere;
  }
</style>
