<script lang="ts">
  import {
    Background,
    BackgroundVariant,
    ConnectionMode,
    SelectionMode,
    Panel,
    SvelteFlow,
    useSvelteFlow,
    useViewport,
    ViewportPortal,
  } from '@xyflow/svelte';
  import type { Side } from '../src/core/arrange.ts';
  import { cablePath, sidePoint, SIDES, throughPath, type Box } from '../src/core/cables.ts';
  import AppCard from './AppCard.svelte';
  import Cable from './Cable.svelte';
  import Outside from './Outside.svelte';
  import Queue from './Queue.svelte';
  import Tunnel from './Tunnel.svelte';
  import { board, type CardNode, type InfraNode } from './board.svelte.ts';
  import { live } from './live.svelte.ts';
  import { theme } from './theme.svelte.ts';

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
  /** What a drag on the empty board does: select an area, or move the board. Space held moves it either way. */
  let tool = $state<'select' | 'hand'>('select');
  const TOOLS = [
    [
      'select',
      'Select (V): drag on the board to select an area',
      'M3.5 2.5 L12 8.2 L8.3 8.9 L10.4 13.2 L8.8 14 L6.7 9.7 L3.9 12.2 Z',
    ],
    [
      'hand',
      'Hand (H): drag to move around. Or hold Space while dragging',
      'M5 8V3.6a1 1 0 0 1 2 0V7.5M7 7V2.8a1 1 0 0 1 2 0V7M9 7.2V3.6a1 1 0 0 1 2 0V8.5M11 8V5.6a1 1 0 0 1 2 0V9.5c0 2.6-1.8 4.5-4.4 4.5H8c-1.5 0-2.5-.6-3.4-1.8L2.8 9.8a1 1 0 0 1 1.6-1.1L5 9.4',
    ],
  ] as const;
  const shortcut = (ev: KeyboardEvent) => {
    if (ev.altKey || (ev.target as Element).closest('input, select, textarea')) return;
    const key = ev.key.toLowerCase();
    if (ev.metaKey || ev.ctrlKey) {
      if (key !== 'z') return;
      ev.preventDefault();
      if (ev.shiftKey) board.redo();
      else board.undo();
    } else if (key === 'f') void flow.fitView(FIT);
    else if (key === 'e') board.goEdit();
    else if (key === 'l') board.goLive();
    else if (ev.key === 'v' || ev.key === 'V') tool = 'select';
    else if (ev.key === 'h' || ev.key === 'H') tool = 'hand';
  };
  // The board opens where it was left; one that was never placed is fitted to the window.
  const start = board.view ? { initialViewport: board.view } : { fitView: true, fitViewOptions: FIT };
  // A board left where none of its cards shows is brought back into view, once its cards have their sizes.
  let checked = false;
  $effect(() => {
    if (checked || !board.nodes.length || board.boxes.size < board.nodes.length) return;
    checked = true;
    const view = board.area();
    const shown = [...(area?.querySelectorAll('.svelte-flow__node') ?? [])].some(card => {
      const box = card.getBoundingClientRect();
      return box.right > view.left && box.left < view.right && box.bottom > view.top && box.top < view.bottom;
    });
    if (!shown) void flow.fitView({ ...FIT, duration: 0 });
  });
  /** A link from an app to a tunnel card: it leaves the app level with the card when it can, so it runs straight. */
  const linkPath = (app: Box, card: Box) => {
    const dx = card.x + card.w / 2 - (app.x + app.w / 2);
    const dy = card.y + card.h / 2 - (app.y + app.h / 2);
    const across = Math.abs(dx) * 0.6 > Math.abs(dy);
    const [fromSide, toSide]: [Side, Side] = across
      ? dx > 0
        ? ['right', 'left']
        : ['left', 'right']
      : dy > 0
        ? ['bottom', 'top']
        : ['top', 'bottom'];
    const to = sidePoint(card, toSide);
    const from = sidePoint(app, fromSide);
    const within = (value: number, low: number, high: number) => Math.min(Math.max(value, low), Math.max(low, high));
    if (across) from.y = within(to.y, app.y + 12, app.y + app.h - 12);
    else from.x = within(to.x, app.x + 12, app.x + app.w - 12);
    return cablePath(from, fromSide, to, toSide);
  };
  const links = $derived(
    board.links.flatMap(({ from, to }) => {
      const app = board.boxes.get(from);
      const card = board.infraBoxes.get(to);
      return app && card ? [{ key: `${from}>${to}`, d: linkPath(app, card), idle: !live.up(from) }] : [];
    }),
  );
  /** A message link or a call to an outside system, between the sides of its two cards that face each other. */
  const flows = $derived(
    board.flows.flatMap(({ from, to, queue }) => {
      const box = (key: string) => board.boxes.get(key) ?? board.infraBoxes.get(key);
      const [a, b] = [box(from), box(to)];
      if (!a || !b) return [];
      const dx = b.x + b.w / 2 - (a.x + a.w / 2);
      const dy = b.y + b.h / 2 - (a.y + a.h / 2);
      const level: [Side, Side] = dx > 0 ? ['right', 'left'] : ['left', 'right'];
      let sides: [Side, Side] =
        Math.abs(dx) * 0.6 > Math.abs(dy) ? level : dy > 0 ? ['bottom', 'top'] : ['top', 'bottom'];
      // An app's side with its tunnel and queue cards is left to them: a link from elsewhere leaves sideways
      // instead. A card of the app's own stack is joined on whichever side it sits, as it is moved around the app.
      const own = board.ledBy(from).includes(to) || board.ledBy(to).includes(from);
      const taken = (key: string, side: Side) =>
        board.boxes.has(key) && !!board.ledBy(key).length && board.infraSide(key) === side;
      if (!own && (taken(from, sides[0]) || taken(to, sides[1]))) sides = level;
      const [start, end] = [sidePoint(a, sides[0]), sidePoint(b, sides[1])];
      const [x, y] = SIDES[sides[1]];
      return [
        {
          key: `${from}>${to}`,
          d: cablePath(start, sides[0], end, sides[1]),
          start,
          head: `translate(${String(end.x + x * 10)} ${String(end.y + y * 10)}) rotate(${String((Math.atan2(-y, -x) * 180) / Math.PI)})`,
          kind: queue ? (board.queues[queue] === 'local' ? 'msg local' : 'msg') : 'ext',
        },
      ];
    }),
  );
  const arrange = () => {
    board.arrange();
    // The cards move first; the view follows once they are placed.
    requestAnimationFrame(() => void flow.fitView(FIT));
  };
</script>

<svelte:window onkeydown={shortcut} />

<!-- A card reached with Tab is the picked one: the arrow keys move it straight away. -->
<div
  class="area"
  bind:this={area}
  onfocusin={ev => {
    const id = (ev.target as Element).matches('.svelte-flow__node')
      ? (ev.target as Element).getAttribute('data-id')
      : null;
    if (id && !board.nodes.find(node => node.id === id)?.selected)
      board.nodes = board.nodes.map(node => ({ ...node, selected: node.id === id }));
  }}
>
  <SvelteFlow
    bind:nodes={
      () => [...board.nodes, ...board.infra],
      (all: (CardNode | InfraNode)[]) => {
        // An app the library moved (a drag, the arrow keys) takes its tunnel cards along, in the same step.
        const was = new Map(board.nodes.map(node => [node.id, node.position]));
        const tall = new Map(board.nodes.map(node => [node.id, node.measured?.height]));
        let nudged = false;
        let infra = all.filter(node => node.type !== 'app');
        const apps = all.filter(node => node.type === 'app');
        for (const { id, position, measured } of apps) {
          // A card that grows or shrinks (its steps open, a note) moves the cards stacked under it by as much.
          const [before, now] = [tall.get(id), measured?.height];
          if (before && now && before !== now) {
            infra = board.pushed(id, position.y + before, now - before, infra);
            nudged = true;
          }
          const from = was.get(id);
          if (from && (from.x !== position.x || from.y !== position.y))
            infra = board.followed(id, { x: position.x - from.x, y: position.y - from.y }, infra);
        }
        board.nodes = apps;
        board.infra = infra;
        // Moved by a card's change of size, not by anyone: no step of its own to undo.
        if (nudged) board.adopt();
      }
    }
    bind:edges={board.edges}
    nodeTypes={{ app: AppCard, tunnel: Tunnel, queue: Queue, outside: Outside }}
    edgeTypes={{ cable: Cable }}
    connectionMode={ConnectionMode.Loose}
    deleteKey={board.live ? null : ['Backspace', 'Delete']}
    nodesDraggable={!board.live}
    nodeDragThreshold={4}
    nodeClickDistance={4}
    panOnScroll
    panOnScrollSpeed={1}
    panOnDrag={tool === 'hand' ? true : [1, 2]}
    selectionOnDrag={tool === 'select'}
    selectionMode={SelectionMode.Partial}
    onedgeclick={({ edge }) => {
      if (!board.live) board.cut(edge.source, edge.target);
    }}
    colorMode={theme.now}
    minZoom={0.2}
    attributionPosition="bottom-left"
    {...start}
    onmoveend={(_event, viewport) => {
      if (!board.live) board.view = viewport;
    }}
  >
    <Background variant={BackgroundVariant.Dots} gap={24} size={2.4} bgColor="var(--paper)" patternColor="var(--dot)" />
    <Panel position="top-left">
      <div
        class="views"
        role="radiogroup"
        aria-label="Board view"
        title="Edit (E): set up apps and cables. Live (L): what is running, large enough to read at a glance."
      >
        <label>
          <input
            type="radio"
            name="view"
            checked={!board.live}
            onchange={() => {
              board.goEdit();
            }}
          />Edit
        </label>
        <label>
          <input
            type="radio"
            name="view"
            checked={board.live}
            onchange={() => {
              board.goLive();
            }}
          />Live
        </label>
      </div>
    </Panel>
    <Panel position="bottom-right">
      <div class="tools" role="toolbar" aria-label="Board">
        <div class="switch" role="radiogroup" aria-label="Dragging on the board">
          {#each TOOLS as [name, title, d] (name)}
            <button
              class="tool"
              type="button"
              role="radio"
              aria-checked={tool === name}
              aria-label={title}
              {title}
              onclick={() => (tool = name)}
            >
              <svg viewBox="0 0 16 16" width="15" height="15" aria-hidden="true" class={name}><path {d} /></svg>
            </button>
          {/each}
        </div>
        <span class="sep" aria-hidden="true"></span>
        <button
          class="tool"
          type="button"
          aria-label="Undo"
          title="Undo (Ctrl+Z or Cmd+Z)"
          disabled={!board.canUndo}
          onclick={() => {
            board.undo();
          }}
        >
          <svg viewBox="0 0 16 16" width="15" height="15" aria-hidden="true" class="line">
            <path d="M5.5 3.5 2.5 6.5l3 3" /><path d="M2.5 6.5h7a3.5 3.5 0 0 1 0 7H7" />
          </svg>
        </button>
        <button
          class="tool"
          type="button"
          aria-label="Redo"
          title="Redo (Shift+Ctrl+Z or Shift+Cmd+Z)"
          disabled={!board.canRedo}
          onclick={() => {
            board.redo();
          }}
        >
          <svg viewBox="0 0 16 16" width="15" height="15" aria-hidden="true" class="line">
            <path d="M10.5 3.5l3 3-3 3" /><path d="M13.5 6.5h-7a3.5 3.5 0 0 0 0 7H9" />
          </svg>
        </button>
        <span class="sep" aria-hidden="true"></span>
        <button title="Arrange cards by who calls whom, callers on top" onclick={arrange}>Arrange</button>
        <button title="Zoom to fit all apps (F)" onclick={() => void flow.fitView(FIT)}>Fit</button>
        <span class="sep" aria-hidden="true"></span>
        <div class="zoom" role="group" aria-label="Zoom">
          <button aria-label="Zoom out" onclick={zoomBy(1 / 1.2)}>−</button>
          <button title="Reset to 100%" onclick={() => void flow.setZoom(1, { duration: 200 })}>
            {Math.round(viewport.current.zoom * 100)}%
          </button>
          <button aria-label="Zoom in" onclick={zoomBy(1.2)}>+</button>
        </div>
        <span class="sep" aria-hidden="true"></span>
        <button
          class="clear"
          title="Remove every card from this board. Undo brings them back."
          onclick={() => {
            board.clear();
          }}>Clear</button
        >
      </div>
    </Panel>
    <!-- Under the cards: the links from each app to its tunnels. -->
    <ViewportPortal target="back">
      <svg class="links" aria-hidden="true">
        <defs>
          <marker
            id="link-end"
            viewBox="-8 -6 10 12"
            markerWidth="10"
            markerHeight="12"
            refX="0"
            refY="0"
            orient="auto-start-reverse"
            markerUnits="userSpaceOnUse"
          >
            <path d="M-6,-4.5 L0,0 L-6,4.5" />
          </marker>
        </defs>
        {#each links as link (link.key)}
          <path class="link" class:idle={link.idle} d={link.d} />
        {/each}
        {#each flows as flow (flow.key)}
          <g class="flow {flow.kind}">
            <path class="under" d={flow.d} />
            <path class="wire" d={flow.d} />
            <path class="head" d="M-8,-5.5 L0,0 L-8,5.5" transform={flow.head} />
            <circle class="plug" cx={flow.start.x} cy={flow.start.y} r="5" />
          </g>
        {/each}
      </svg>
    </ViewportPortal>
    <!-- Above every card, a picked one too: each cable's two ends, which the pointer can grab, and the cable being drawn. -->
    <ViewportPortal target="front" style="position: absolute; z-index: 1001">
      <svg class="ends" class:reordering={!!board.grabbed} class:still={board.live} aria-hidden="true">
        {#each board.edges as edge, index (edge.id)}
          {@const a = board.endPoint(index, 'from')}
          {@const b = board.endPoint(index, 'to')}
          {#if a && b}
            <circle
              role="presentation"
              class="plug nodrag nopan"
              class:cut={board.hovered === edge.id}
              class:idle={!live.up(edge.source) || !live.up(edge.target)}
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
  {#if !board.nodes.length}
    <p class="empty">
      Click the apps you want to run together.<br />Connect them; the board is saved as you go.
    </p>
  {/if}
</div>

<style>
  .area {
    position: absolute;
    inset: 0;
  }
  .empty {
    position: absolute;
    inset: 0;
    display: grid;
    place-content: center;
    margin: 0;
    padding: 0 24px;
    color: var(--muted);
    font: 15px/1.55 var(--sans);
    text-align: center;
    text-wrap: balance;
    pointer-events: none;
  }
  .links {
    position: absolute;
    overflow: visible;
    width: 1px;
    height: 1px;
    pointer-events: none;
  }
  .links path {
    fill: none;
    stroke: var(--muted);
    stroke-width: 1.5;
    stroke-linecap: round;
    stroke-linejoin: round;
  }
  .link {
    marker-start: url(#link-end);
    marker-end: url(#link-end);
  }
  /* Dashed until its app runs. */
  .link.idle {
    stroke-dasharray: 5 5;
    stroke-linecap: butt;
  }
  /* Message links are teal, dashed while the queue is the deployed one; calls to an outside system are dotted grey. */
  .flow .under {
    stroke: var(--desk);
    stroke-width: 7;
    opacity: 0.75;
  }
  .flow .wire,
  .flow .head {
    stroke-width: 2;
  }
  .flow.msg :is(.wire, .head) {
    stroke: var(--msg);
  }
  .flow.msg .wire {
    stroke-dasharray: 7 5;
    stroke-linecap: butt;
  }
  .flow.msg.local .wire {
    stroke-dasharray: none;
    stroke-linecap: round;
  }
  .flow.msg .plug {
    fill: var(--msg);
    stroke: var(--surface);
    stroke-width: 2;
  }
  .flow.ext :is(.wire, .head) {
    stroke: var(--socket-rim);
    stroke-width: 1.5;
  }
  .flow.ext .wire {
    stroke-dasharray: 2 5;
  }
  .flow.ext .plug {
    display: none;
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
  .plug.idle {
    fill: color-mix(in oklab, var(--cable) 38%, var(--line));
  }
  .plug.cut {
    fill: var(--bad);
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
  .views {
    display: inline-flex;
    gap: 2px;
    padding: 2px;
    border: 1px solid var(--line);
    border-radius: 8px;
    background: var(--panel);
  }
  .views label {
    position: relative;
    padding: 3px 12px;
    border-radius: 6px;
    color: var(--muted);
    font: 600 13px var(--sans);
  }
  .views input {
    position: absolute;
    inset: 0;
    margin: 0;
    opacity: 0;
    cursor: pointer;
  }
  .views label:has(input:checked) {
    background: var(--surface);
    color: var(--ink);
    box-shadow:
      0 0 0 1px var(--line),
      0 1px 2px rgb(0 0 0 / 0.12);
  }
  .views label:has(input:focus-visible) {
    outline: 2px solid var(--cable);
    outline-offset: -2px;
  }
  /* In Live nothing on the board is pulled or unplugged. */
  .ends.still :is(.plug, .socket) {
    pointer-events: none;
  }
  .area:has(.ends.still) :global(.svelte-flow__edge) {
    pointer-events: none;
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
  .switch {
    display: flex;
    gap: 2px;
  }
  .tools .tool {
    display: grid;
    place-items: center;
    width: 30px;
    height: 28px;
    padding: 0;
    color: var(--muted);
  }
  .tools .tool[aria-checked='true'] {
    background: color-mix(in oklab, var(--cable) 22%, transparent);
    color: var(--ink);
  }
  .tools .tool:disabled {
    opacity: 0.35;
    cursor: default;
  }
  .tools .clear:hover {
    color: var(--bad);
  }
  .line path {
    fill: none;
    stroke: currentColor;
    stroke-width: 1.5;
    stroke-linecap: round;
    stroke-linejoin: round;
  }
  .select path {
    fill: currentColor;
  }
  .hand path {
    fill: none;
    stroke: currentColor;
    stroke-width: 1.3;
    stroke-linecap: round;
    stroke-linejoin: round;
  }
  .area :global(.svelte-flow__selection) {
    border: 1px solid var(--cable);
    border-radius: 3px;
    background: color-mix(in oklab, var(--cable) 12%, transparent);
  }
  .sep {
    width: 1px;
    height: 18px;
    margin: 0 4px;
    background: var(--line);
  }
</style>
