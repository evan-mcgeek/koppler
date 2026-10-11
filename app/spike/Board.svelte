<script lang="ts">
  import {
    Background,
    BackgroundVariant,
    ConnectionMode,
    Controls,
    Panel,
    SvelteFlow,
    useSvelteFlow,
    ViewportPortal,
  } from '@xyflow/svelte';
  import { cablePath, throughPath } from '../src/core/cables.ts';
  import AppCard from './AppCard.svelte';
  import Cable from './Cable.svelte';
  import { board } from './board.svelte.ts';

  const flow = useSvelteFlow();
  board.toFlow = at => flow.screenToFlowPosition(at, { snapToGrid: false });
  board.zoom = () => flow.getZoom();

  const draft = $derived.by(() => {
    const drawn = board.draft;
    if (!drawn) return '';
    return drawn.points.length
      ? throughPath(drawn.a, drawn.side, drawn.b, drawn.bSide, drawn.points)
      : cablePath(drawn.a, drawn.side, drawn.b, drawn.bSide);
  });
  const arrange = () => {
    board.arrange();
    // The cards move first; the view follows once they are placed.
    requestAnimationFrame(() => void flow.fitView({ padding: 0.15, duration: 200 }));
  };
</script>

<SvelteFlow
  bind:nodes={board.nodes}
  bind:edges={board.edges}
  nodeTypes={{ app: AppCard }}
  edgeTypes={{ cable: Cable }}
  connectionMode={ConnectionMode.Loose}
  colorMode="system"
  minZoom={0.2}
  fitView
  fitViewOptions={{ padding: 0.15 }}
  proOptions={{ hideAttribution: true }}
>
  <Background variant={BackgroundVariant.Dots} gap={24} size={2.4} bgColor="var(--paper)" patternColor="var(--dot)" />
  <Controls />
  <Panel position="top-left">
    <button class="tool" onclick={arrange}>Arrange</button>
  </Panel>
  <!-- Above every card, a picked one too: each cable's two ends, which the pointer can grab, and the cable being drawn. -->
  <ViewportPortal target="front" style="position: absolute; z-index: 1001">
    <svg class="ends" class:reordering={!!board.grabbed} aria-hidden="true">
      {#each board.edges as edge, index (edge.id)}
        {@const a = board.endPoint(index, 'from')}
        {@const b = board.endPoint(index, 'to')}
        {#if a && b}
          <circle
            role="presentation"
            class="plug nodrag nopan"
            class:grabbed={board.grabbed?.id === edge.id && board.grabbed.end === 'from'}
            cx={a.x}
            cy={a.y}
            r="5"
            onpointerdown={ev => {
              board.grabEnd(ev, edge.id, 'from');
            }}
          />
          <circle
            role="presentation"
            class="socket nodrag nopan"
            class:grabbed={board.grabbed?.id === edge.id && board.grabbed.end === 'to'}
            cx={b.x}
            cy={b.y}
            r="8"
            onpointerdown={ev => {
              board.grabEnd(ev, edge.id, 'to');
            }}
          />
          <circle class="light" cx={b.x} cy={b.y} r="3.4" />
        {/if}
      {/each}
      {#if draft}
        <path class="draft" d={draft} />
      {/if}
    </svg>
  </ViewportPortal>
</SvelteFlow>

<style>
  .ends {
    position: absolute;
    overflow: visible;
    width: 1px;
    height: 1px;
    pointer-events: none;
  }
  .plug,
  .socket {
    pointer-events: auto;
    cursor: grab;
  }
  .reordering,
  .reordering * {
    cursor: grabbing;
  }
  .plug {
    fill: var(--cable);
    stroke: var(--surface);
    stroke-width: 2;
  }
  .plug.grabbed {
    r: 7.5px;
  }
  .socket {
    fill: var(--socket);
    stroke: var(--socket-rim);
    stroke-width: 2;
  }
  .socket.grabbed {
    r: 10px;
  }
  .light {
    fill: var(--socket-rim);
  }
  .draft {
    fill: none;
    stroke: var(--cable);
    stroke-width: 2.5;
    stroke-linecap: round;
    stroke-dasharray: 6 6;
  }
  .tool {
    height: 32px;
    padding: 0 12px;
    border: 1px solid var(--line);
    border-radius: 8px;
    background: var(--surface);
    color: var(--ink);
    font: 600 13px var(--sans);
    cursor: pointer;
  }
  .tool:hover {
    border-color: var(--ink);
  }
</style>
