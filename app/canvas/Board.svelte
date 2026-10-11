<script lang="ts">
  import {
    Background,
    BackgroundVariant,
    ConnectionMode,
    Panel,
    SvelteFlow,
    useSvelteFlow,
    useViewport,
    ViewportPortal,
  } from '@xyflow/svelte';
  import { cablePath, throughPath } from '../src/core/cables.ts';
  import AppCard from './AppCard.svelte';
  import Cable from './Cable.svelte';
  import { board } from './board.svelte.ts';

  const flow = useSvelteFlow();
  board.toFlow = at => flow.screenToFlowPosition(at, { snapToGrid: false });
  board.zoom = () => flow.getZoom();
  const viewport = useViewport();
  let area: HTMLElement | undefined = $state();
  board.area = () => area?.getBoundingClientRect() ?? new DOMRect();
  // Brings a card to the middle of the board, at the zoom the board is at, and picks it.
  board.show = id => {
    board.nodes = board.nodes.map(node => ({ ...node, selected: node.id === id }));
    const zoom = flow.getZoom();
    void flow.fitView({ nodes: [{ id }], minZoom: zoom, maxZoom: zoom, duration: 200 });
  };
  // Fitting never blows a small board up past its real size.
  const FIT = { padding: 0.15, duration: 200, maxZoom: 1 };
  // Not the library's zoomIn and zoomOut: taken here, before its board exists, they stay tied to an empty one.
  const zoomBy = (factor: number) => () => void flow.setZoom(flow.getZoom() * factor, { duration: 150 });

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
    requestAnimationFrame(() => void flow.fitView(FIT));
  };
</script>

<div class="area" bind:this={area}>
  <SvelteFlow
    bind:nodes={board.nodes}
    bind:edges={board.edges}
    nodeTypes={{ app: AppCard }}
    edgeTypes={{ cable: Cable }}
    connectionMode={ConnectionMode.Loose}
    colorMode="system"
    minZoom={0.2}
    attributionPosition="bottom-left"
    fitView
    fitViewOptions={{ padding: 0.15, maxZoom: 1 }}
  >
    <Background variant={BackgroundVariant.Dots} gap={24} size={2.4} bgColor="var(--paper)" patternColor="var(--dot)" />
    <Panel position="bottom-right">
      <div class="tools" role="toolbar" aria-label="Board">
        <button title="Arrange cards by who calls whom, callers on top" onclick={arrange}>Arrange</button>
        <button title="Zoom to fit all apps" onclick={() => void flow.fitView(FIT)}>Fit</button>
        <span class="sep" aria-hidden="true"></span>
        <div class="zoom" role="group" aria-label="Zoom">
          <button aria-label="Zoom out" onclick={zoomBy(1 / 1.2)}>−</button>
          <button title="Reset to 100%" onclick={() => void flow.setZoom(1, { duration: 200 })}>
            {Math.round(viewport.current.zoom * 100)}%
          </button>
          <button aria-label="Zoom in" onclick={zoomBy(1.2)}>+</button>
        </div>
      </div>
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
              data-cable={edge.id}
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
              data-cable={edge.id}
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
</div>

<style>
  .area {
    position: absolute;
    inset: 0;
  }
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
  .tools {
    display: flex;
    align-items: center;
    gap: 2px;
    padding: 3px;
    border: 1px solid var(--line);
    border-radius: 10px;
    background: var(--panel);
  }
  .zoom {
    display: flex;
    gap: 2px;
  }
  .tools button {
    padding: 6px 12px;
    border: 1px solid transparent;
    border-radius: 8px;
    background: none;
    color: var(--ink);
    font: 600 13px var(--sans);
    white-space: nowrap;
    cursor: pointer;
  }
  .tools button:hover {
    background: color-mix(in oklab, var(--ink) 7%, transparent);
  }
  .sep {
    width: 1px;
    height: 18px;
    margin: 0 4px;
    background: var(--line);
  }
</style>
