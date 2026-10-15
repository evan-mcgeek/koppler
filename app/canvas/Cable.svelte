<script lang="ts">
  import { useViewport, type EdgeProps } from '@xyflow/svelte';
  import { cablePath, SIDES, throughPath } from '../src/core/cables.ts';
  import { board, type CableData } from './board.svelte.ts';
  import { wiring } from './wiring.svelte.ts';
  import { live } from './live.svelte.ts';

  const { id, source, target, selected, data: given }: EdgeProps = $props();
  const viewport = useViewport();
  // Zoomed out, the mark to unplug a cable keeps its size on screen, so it can still be hit.
  const markScale = $derived(Math.max(1, 1 / viewport.current.zoom));
  const data = $derived(given as CableData | undefined);
  const index = $derived(board.edges.findIndex(edge => edge.id === id));
  const a = $derived(wiring.endPoint(index, 'from'));
  const b = $derived(wiring.endPoint(index, 'to'));
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
  const name = board.nameOf;
  /** The middle of the cable, where the mark to unplug it shows while it is pointed at or picked: measured only then. */
  const middle = $derived.by(() => {
    if (!path || (board.hovered !== id && !selected) || board.live) return '';
    const probe = document.createElementNS('http://www.w3.org/2000/svg', 'path');
    probe.setAttribute('d', path);
    const at = probe.getPointAtLength(probe.getTotalLength() / 2);
    return `translate(${String(at.x)} ${String(at.y)}) scale(${String(markScale)})`;
  });
</script>

{#if path}
  <!-- One group, so that the title in it is the SVG one: a cable that starts with <title> is taken for HTML. -->
  <g
    class:idle={!live.up(source) || !live.up(target)}
    class:dimmed={board.dimmedLink(source, target)}
    class:lit={board.lit(source, target)}
    class:snapped={board.snapped.includes(id)}
    role="presentation"
    onpointerenter={() => (board.hovered = id)}
    onpointerleave={() => (board.hovered = null)}
  >
    <title>{name(source)} calls local {name(target)}. Click to pick it; the × in its middle unplugs it.</title>
    <!-- As wide on screen at every zoom: a cable far away is as easy to point at. -->
    <path class="svelte-flow__edge-interaction hit" d={path} style:stroke-width="{16 * markScale}px" />
    <path class="under" d={path} />
    <path class="wire" d={path} />
    <path class="head" d="M-10,-5 L0,0 L-10,5 L-7.5,0 Z" transform={head} />
    {#if middle}
      <g
        class="cut nodrag"
        transform={middle}
        role="button"
        tabindex="-1"
        aria-label="Unplug {name(source)} from {name(target)}"
        onclick={ev => {
          ev.stopPropagation();
          board.cut(source, target);
        }}
        onkeydown={ev => {
          if (ev.key === 'Enter' || ev.key === ' ') board.cut(source, target);
        }}
      >
        <circle r="8" />
        <path d="M-3,-3 L3,3 M3,-3 L-3,3" />
      </g>
    {/if}
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
  :global(.svelte-flow__edge:hover) .cut,
  :global(.svelte-flow__edge.selected) .cut {
    visibility: visible;
    cursor: pointer;
  }
  .cut:hover circle {
    fill: var(--bad);
  }
  .cut:hover path {
    stroke: var(--surface);
  }
  /* Dashed until the apps at both ends run. */
  .idle :is(.wire, .head) {
    stroke: color-mix(in oklab, var(--cable) 38%, var(--line));
  }
  .idle .head {
    fill: color-mix(in oklab, var(--cable) 38%, var(--line));
  }
  .idle .wire {
    stroke-dasharray: 6 6;
    stroke-linecap: butt;
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
  .wire {
    stroke: var(--cable);
    stroke-width: 2.5;
  }
  /* A solid head with a notched back; its thin outline only rounds the corners. */
  .head {
    fill: var(--cable);
    stroke: var(--cable);
    stroke-width: 1.5;
  }
  :global(.svelte-flow__edge.selected) .wire,
  :global(.svelte-flow__edge:focus-visible) .wire,
  .lit .wire {
    stroke: var(--cable-ink);
    stroke-width: 4;
  }
  /* Snapped straight while a card is dragged: the cable goes a shade darker, nothing more. */
  .snapped .wire {
    stroke: var(--cable-ink);
  }
  .snapped .head {
    fill: var(--cable-ink);
    stroke: var(--cable-ink);
  }
  :global(.svelte-flow__edge.selected) .head,
  :global(.svelte-flow__edge:focus-visible) .head,
  .lit .head {
    fill: var(--cable-ink);
    stroke: var(--cable-ink);
    stroke-width: 3;
  }
</style>
