<script lang="ts">
  import { Handle, Position, useViewport, type NodeProps } from '@xyflow/svelte';
  import type { Side } from '../src/core/arrange.ts';
  import { board, type CardNode } from './board.svelte.ts';

  const { id, data, selected }: NodeProps<CardNode> = $props();
  const SIDES: Side[] = ['top', 'right', 'bottom', 'left'];
  const FAR_ZOOM = 0.6;
  const viewport = useViewport();
  const far = $derived(viewport.current.zoom < FAR_ZOOM);
  /** A side whose one cable sits on the port: the ring stays lit under its end. */
  const lit = (side: Side) => board.ends.onPort.some(port => port.id === id && port.side === side);
</script>

<article
  class="card kind-{data.kind}"
  class:selected
  class:far
  class:drop={board.drop === id}
  class:wiring={!!board.draft}
>
  <header>
    <span class="kind">{data.kind}</span>
    <span class="name">{data.name}</span>
  </header>
  {#if far}
    <p class="glance"><span>{data.branch}</span></p>
  {:else}
    <dl>
      <div>
        <dt>Branch</dt>
        <dd>{data.branch}</dd>
      </div>
      <div>
        <dt>Address</dt>
        <dd>localhost:{data.port}</dd>
      </div>
    </dl>
  {/if}
  <!-- The one anchor Svelte Flow needs to draw this card's cables; the ports below are ours. -->
  <Handle type="source" position={Position.Top} isConnectable={false} class="anchor" />
  {#each SIDES as side (side)}
    <button
      class="port {side} nodrag nopan"
      class:on={lit(side)}
      aria-label="Draw a cable from the {side} of {data.name}"
      tabindex="-1"
      onpointerdown={ev => {
        if (ev.button !== 0) return;
        ev.stopPropagation();
        board.startWire(id, side);
      }}
    ></button>
  {/each}
</article>

<style>
  .card {
    position: relative;
    width: max-content;
    min-width: 260px;
    max-width: 380px;
    background: var(--surface);
    border: 1px solid var(--line);
    border-radius: 10px;
    color: var(--ink);
    font: 14px/1.4 var(--sans);
    user-select: none;
  }
  .card.selected,
  :global(.svelte-flow__node:focus-visible) .card {
    outline: 2px solid var(--cable);
    outline-offset: 3px;
  }
  .card.drop {
    outline: 2px solid var(--ok);
    outline-offset: 3px;
  }
  header {
    display: flex;
    align-items: center;
    gap: 8px;
    min-height: 44px;
    padding: 6px 16px;
    border-bottom: 1px solid var(--line);
    cursor: grab;
  }
  .far header {
    border-bottom: 0;
  }
  .kind {
    flex: none;
    padding: 1px 7px;
    border-radius: 999px;
    font: 600 12px/1.5 var(--sans);
    color: var(--kind);
    background: color-mix(in oklab, var(--kind) 14%, transparent);
  }
  .name {
    flex: 1;
    min-width: 0;
    font-weight: 700;
    font-size: 15px;
    line-height: 1.2;
  }
  .far .name {
    font-size: 26px;
  }
  dl {
    display: grid;
    gap: 8px;
    margin: 0;
    padding: 10px 16px 14px;
  }
  dl div {
    display: grid;
    grid-template-columns: 76px 1fr;
    align-items: baseline;
    gap: 8px;
  }
  dt {
    font-size: 12px;
    color: var(--muted);
  }
  dd {
    margin: 0;
    font: 12px var(--mono);
  }
  .glance {
    display: flex;
    margin: 0;
    padding: 0 16px 10px;
  }
  .glance span {
    padding: 2px 8px;
    border-radius: 6px;
    background: color-mix(in oklab, var(--ink) 7%, transparent);
    font: 15px var(--mono);
    color: var(--muted);
  }
  .port {
    position: absolute;
    width: 16px;
    height: 16px;
    margin: -8px 0 0 -8px;
    padding: 0;
    border: 2px solid var(--ink);
    border-radius: 50%;
    background: var(--surface);
    opacity: 0;
    cursor: crosshair;
    transition: opacity 0.1s;
  }
  .card:hover .port,
  .card.wiring .port,
  .port.on {
    opacity: 1;
  }
  .port:hover {
    border-color: var(--cable);
  }
  .port.top {
    left: 50%;
    top: 0;
  }
  .port.right {
    left: 100%;
    top: 50%;
  }
  .port.bottom {
    left: 50%;
    top: 100%;
  }
  .port.left {
    left: 0;
    top: 50%;
  }
  .card :global(.anchor) {
    visibility: hidden;
  }
  @media (prefers-reduced-motion: reduce) {
    .port {
      transition: none;
    }
  }
</style>
