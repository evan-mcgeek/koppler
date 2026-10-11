<script lang="ts">
  import 'diagram-js/assets/diagram-js.css';
  import type { Point, Side } from '../src/core/arrange.ts';
  import { arrangeBoard, fit, setup, zoomBy, type CardData } from './board.svelte.ts';

  let { cards, links }: { cards: (CardData & { id: string; x: number; y: number })[]; links: { from: string; to: string; fromSide: Side; toSide: Side; points?: Point[] }[] } = $props();
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
  .board {
    background-image: radial-gradient(var(--dot) 1.2px, transparent 1.3px);
  }
  .board :global(.ends) {
    pointer-events: none;
  }
  .board :global(.end) {
    pointer-events: auto;
    cursor: grab;
  }
  .board :global(.ends.reordering .end) {
    cursor: grabbing;
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
  .board :global(.djs-connection path) {
    fill: none;
    stroke-linecap: round;
    stroke-linejoin: round;
  }
  .board :global(.djs-connection .under) {
    stroke: var(--desk);
    stroke-width: 8;
    opacity: 0.75;
  }
  .board :global(.djs-connection :is(.wire, .head)) {
    stroke: var(--cable);
    stroke-width: 2.5;
  }
  .board :global(.djs-connection .draft) {
    stroke-dasharray: 6 6;
  }
  .board :global(.djs-connection:focus-visible) {
    outline: none;
  }
  .board :global(.djs-connection:focus-visible :is(.wire, .head)) {
    stroke: var(--cable-ink);
    stroke-width: 4;
  }
  /* The library switches the pointer off on everything it draws; the card needs it. */
  .board :global(.djs-shape > .djs-visual) {
    pointer-events: auto;
  }
  /* The card is HTML: the library's invisible hit box over it would swallow every press, and its outline is ours. */
  .board :global(.djs-shape > .djs-hit),
  .board :global(.djs-shape > .djs-outline) {
    display: none;
  }
</style>
