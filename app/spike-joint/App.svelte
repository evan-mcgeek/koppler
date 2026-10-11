<script lang="ts">
  import type { dia } from '@joint/core';
  import { arrangeBoard, fit, setup, zoomBy, type CardData } from './board.svelte.ts';

  let { cards, links }: { cards: (CardData & { id: string; x: number; y: number })[]; links: dia.Link[] } = $props();
  const board = (el: HTMLElement) => {
    setup(el, cards, links);
  };
</script>

<div class="board" {@attach board}></div>
<div class="tools top"><button onclick={arrangeBoard}>Arrange</button></div>
<div class="tools">
  <button aria-label="Zoom in" onclick={() => zoomBy(1.25)}>+</button>
  <button aria-label="Zoom out" data-zoom-out onclick={() => zoomBy(0.8)}>−</button>
  <button onclick={fit}>Fit</button>
</div>

<style>
  .board {
    position: absolute;
    inset: 0;
    background: var(--paper);
  }
  .tools {
    position: absolute;
    left: 15px;
    bottom: 15px;
    display: grid;
    gap: 4px;
  }
  .tools.top {
    top: 15px;
    bottom: auto;
  }
  button {
    min-width: 32px;
    height: 32px;
    padding: 0 12px;
    border: 1px solid var(--line);
    border-radius: 8px;
    background: var(--surface);
    color: var(--ink);
    font: 600 13px var(--sans);
    cursor: pointer;
  }
  button:hover {
    border-color: var(--ink);
  }
  .board :global(.end) {
    cursor: grab;
  }
  .board :global(.end.from circle) {
    fill: var(--cable);
    stroke: var(--surface);
    stroke-width: 2;
  }
  .board :global(.end.to circle) {
    fill: var(--socket);
    stroke: var(--socket-rim);
    stroke-width: 2;
  }
  .board :global(.end.to circle.light) {
    fill: var(--socket-rim);
    stroke: none;
  }
  .board :global(.grabbed .end.from circle) {
    r: 7.5px;
  }
  .board :global(.grabbed .end.to circle:first-child) {
    r: 10px;
  }
  .board :global(.joint-link:focus-visible) {
    outline: none;
  }
  .board :global(.joint-link:focus-visible [joint-selector='line']) {
    stroke: var(--cable-ink);
    stroke-width: 4;
  }
</style>
