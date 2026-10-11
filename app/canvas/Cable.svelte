<script lang="ts">
  import type { EdgeProps } from '@xyflow/svelte';
  import { cablePath, SIDES, throughPath } from '../src/core/cables.ts';
  import { board, type CableData } from './board.svelte.ts';

  const { id, source, target, data: given }: EdgeProps = $props();
  const data = $derived(given as CableData | undefined);
  const index = $derived(board.edges.findIndex(edge => edge.id === id));
  const a = $derived(board.endPoint(index, 'from'));
  const b = $derived(board.endPoint(index, 'to'));
  const path = $derived(
    !a || !b || !data
      ? ''
      : data.points?.length
        ? throughPath(a, data.fromSide, b, data.toSide, data.points)
        : cablePath(a, data.fromSide, b, data.toSide),
  );
  /** The arrow's tip touches the socket's rim, pointing into the card. */
  const head = $derived.by(() => {
    if (!b || !data) return '';
    const [x, y] = SIDES[data.toSide];
    return `translate(${String(b.x + x * 10)} ${String(b.y + y * 10)}) rotate(${String((Math.atan2(-y, -x) * 180) / Math.PI)})`;
  });
  const name = (app: string) => board.apps.find(one => one.id === app)?.name ?? app;
  /** The middle of the cable, where the mark to unplug it shows: measured on a path of that shape. */
  const middle = $derived.by(() => {
    if (!path) return '';
    const probe = document.createElementNS('http://www.w3.org/2000/svg', 'path');
    probe.setAttribute('d', path);
    const at = probe.getPointAtLength(probe.getTotalLength() / 2);
    return `translate(${String(at.x)} ${String(at.y)})`;
  });
</script>

{#if path}
  <!-- One group, so that the title in it is the SVG one: a cable that starts with <title> is taken for HTML. -->
  <g role="presentation" onpointerenter={() => (board.hovered = id)} onpointerleave={() => (board.hovered = null)}>
    <title>{name(source)} calls local {name(target)}. Click to unplug.</title>
    <path class="svelte-flow__edge-interaction hit" d={path} />
    <path class="under" d={path} />
    <path class="wire" d={path} />
    <path class="head" d="M-8,-5.5 L0,0 L-8,5.5" transform={head} />
    <g class="cut" transform={middle}>
      <circle r="8" />
      <path d="M-3,-3 L3,3 M3,-3 L-3,3" />
    </g>
  </g>
{/if}

<style>
  path {
    fill: none;
    stroke-linecap: round;
    stroke-linejoin: round;
  }
  :global(.svelte-flow__edge) {
    cursor: pointer;
  }
  .cut {
    visibility: hidden;
  }
  .cut circle {
    fill: var(--surface);
    stroke: var(--bad);
    stroke-width: 1.5;
  }
  .cut path {
    stroke: var(--bad);
    stroke-width: 1.8;
  }
  :global(.svelte-flow__edge:hover) .cut {
    visibility: visible;
  }
  :global(.svelte-flow__edge:hover) :is(.wire, .head) {
    stroke: var(--bad);
  }
  .hit {
    stroke: transparent;
    stroke-width: 16;
  }
  .under {
    stroke: var(--desk);
    stroke-width: 8;
    opacity: 0.75;
  }
  .wire,
  .head {
    stroke: var(--cable);
    stroke-width: 2.5;
  }
  :global(.svelte-flow__edge.selected) :is(.wire, .head),
  :global(.svelte-flow__edge:focus-visible) :is(.wire, .head) {
    stroke: var(--cable-ink);
    stroke-width: 4;
  }
</style>
