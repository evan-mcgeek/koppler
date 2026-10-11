<script lang="ts">
  import type { EdgeProps } from '@xyflow/svelte';
  import { cablePath, SIDES, throughPath } from '../src/core/cables.ts';
  import { board, type CableData } from './board.svelte.ts';

  let { id, data: given }: EdgeProps = $props();
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
</script>

{#if path}
  <path class="svelte-flow__edge-interaction hit" d={path} />
  <path class="under" d={path} />
  <path class="wire" d={path} />
  <path class="head" d="M-8,-5.5 L0,0 L-8,5.5" transform={head} />
{/if}

<style>
  path {
    fill: none;
    stroke-linecap: round;
    stroke-linejoin: round;
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
