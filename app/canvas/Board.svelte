<script lang="ts">
  import {
    Background,
    BackgroundVariant,
    ConnectionMode,
    MiniMap,
    SelectionMode,
    Panel,
    SvelteFlow,
    getViewportForBounds,
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
  import { board, FAR_ZOOM, type CardNode, type InfraNode } from './board.svelte.ts';
  import { ago, openBoard } from './boards.ts';
  import { live } from './live.svelte.ts';
  import { probes, type Job, type Probe } from './probes.svelte.ts';
  import { theme } from './theme.svelte.ts';

  const flow = useSvelteFlow();
  board.toFlow = at => flow.screenToFlowPosition(at, { snapToGrid: false });
  board.zoom = () => flow.getZoom();
  const viewport = useViewport();
  let area: HTMLElement | undefined = $state();
  board.area = () => area?.getBoundingClientRect() ?? new DOMRect();
  // Brings a card to the middle of the board, at the zoom the board is at, and picks it.
  board.show = id => {
    board.pick(id);
    const zoom = flow.getZoom();
    void flow.fitView({ nodes: [{ id }], minZoom: zoom, maxZoom: zoom, duration: 200 });
  };
  // Fitting never blows a small board up past its real size.
  const FIT = { padding: 0.15, duration: 200, maxZoom: 1 };
  // Not the library's zoomIn and zoomOut: taken here, before its board exists, they stay tied to an empty one.
  const zoomBy = (factor: number) => () => void flow.setZoom(flow.getZoom() * factor, { duration: 150 });

  /** For an empty board: the six boards opened last, then the rest in the order they are kept. */
  const lately = $derived(
    [...board.team.map(preset => ({ preset, team: true })), ...board.own.map(preset => ({ preset, team: false }))]
      .map((one, index) => ({
        ...one,
        index,
        at: board.recent.find(opened => opened.name === one.preset.name)?.at ?? '',
      }))
      .sort((a, b) => (a.at === b.at ? a.index - b.index : a.at > b.at ? -1 : 1))
      .slice(0, 6),
  );
  /** Where a socket was pressed, to tell a click in place from a slide. */
  let pressedAt = { x: 0, y: 0 };
  // Whenever what runs or what is cabled changes, cables whose apps both answer are tested.
  $effect(() => {
    probes.follow(jobs);
  });
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
  // A key the system takes over mid-press (a screenshot shortcut) never sends its key-up, and the board would keep
  // selecting instead of moving cards: the mouse says which keys are really held.
  const FLAGS = { Shift: 'shiftKey', Meta: 'metaKey', Control: 'ctrlKey', Alt: 'altKey' } as const;
  const held = { Shift: false, Meta: false, Control: false, Alt: false };
  const hold = (ev: KeyboardEvent) => {
    if (!(ev.key in FLAGS)) return;
    held[ev.key as keyof typeof FLAGS] = ev.type === 'keydown';
  };
  const release = (ev: PointerEvent) => {
    const keys = Object.keys(FLAGS) as (keyof typeof FLAGS)[];
    if (keys.every(key => !held[key] || ev[FLAGS[key]])) return;
    for (const key of keys) held[key] = false;
    // What the library does when the window loses focus: every key it tracks is let go.
    window.dispatchEvent(new Event('blur'));
  };
  const shortcut = (ev: KeyboardEvent) => {
    if (ev.altKey || (ev.target as Element).closest('input, select, textarea')) return;
    // A dialog or a menu over the board has the keyboard to itself.
    if (document.querySelector('dialog[open], :popover-open')) return;
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
    return { d: cablePath(from, fromSide, to, toSide), end: to };
  };
  const links = $derived(
    board.links.flatMap(({ from, to, tunnel }) => {
      const app = board.boxes.get(from);
      const card = board.infraBoxes.get(to);
      if (!app || !card) return [];
      const payload = { app: from, host: tunnel.bind, port: tunnel.port, original: tunnel.original };
      return [{ key: `${from}>${to}`, from, what: tunnel.what, payload, ...linkPath(app, card), idle: !live.up(from) }];
    }),
  );
  const name = (id: string) => board.apps.find(app => app.id === id)?.name ?? id;
  /** What a light says when the pointer rests on it. */
  const about = (probe: Probe | undefined, what: string) =>
    probe?.state === 'busy'
      ? probe.detail
        ? `${probe.text ?? ''}. ${probe.detail}`
        : 'Testing…'
      : probe?.detail
        ? `${probe.text ?? ''}. ${probe.detail} Click to test again.`
        : `Not tested yet. Click to test that ${what}.`;
  /** Every cable and tunnel link that can be tested, with the apps that have to answer first. */
  const jobs = $derived<Job[]>([
    ...board.edges.map(({ id, source, target }) => ({
      key: id,
      apps: [source, target],
      payload: { from: source, to: target },
    })),
    ...links.map(({ key, from, payload }) => ({ key, apps: [from], payload })),
  ]);
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
          // No socket sits at this end: the tip touches the card's edge.
          head: `translate(${String(end.x + x * 2)} ${String(end.y + y * 2)}) rotate(${String((Math.atan2(-y, -x) * 180) / Math.PI)})`,
          kind: queue ? (board.queues[queue] === 'local' ? 'msg local' : 'msg') : 'ext',
        },
      ];
    }),
  );
  const frame = () => new Promise(requestAnimationFrame);
  // Each card's last height and the form it was measured in: a change of form is not the card growing.
  const heights: Record<string, { brief: boolean; height: number } | undefined> = {};
  // Each card's size in full: zoomed out it is drawn, and so measured, in its short form.
  const full: Record<string, { w: number; h: number; live: boolean } | undefined> = {};
  $effect(() => {
    if (viewport.current.zoom < FAR_ZOOM) return;
    for (const [id, { w, h }] of board.boxes) full[id] = { w, h, live: board.live };
  });
  const arrange = async () => {
    // Cards are placed by their full size, so pressing again changes nothing, whatever the zoom.
    // Only a card never seen in full brings the board in close first, to be measured.
    if (viewport.current.zoom < FAR_ZOOM && !board.nodes.every(node => full[node.id]?.live === board.live)) {
      await flow.setZoom(1, { duration: 0 });
      await frame();
      await frame();
    }
    const size = (id: string) => full[id] ?? board.boxes.get(id) ?? { w: 260, h: 160 };
    board.arrange(size);
    // The cards move first; the view follows once they are placed, fitted to their full sizes too.
    requestAnimationFrame(() => {
      if (!area) return;
      const boxes = [
        ...board.nodes.map(node => ({ ...node.position, ...size(node.id) })),
        ...board.infraBoxes.values(),
      ];
      const x = Math.min(...boxes.map(box => box.x));
      const y = Math.min(...boxes.map(box => box.y));
      const bounds = {
        x,
        y,
        width: Math.max(...boxes.map(box => box.x + box.w)) - x,
        height: Math.max(...boxes.map(box => box.y + box.h)) - y,
      };
      const to = getViewportForBounds(bounds, area.clientWidth, area.clientHeight, 0.2, FIT.maxZoom, FIT.padding);
      void flow.setViewport(to, { duration: FIT.duration });
    });
  };
  // A board that was just opened: once its cards have their sizes it is arranged, or only brought into view.
  $effect(() => {
    const how = board.opened;
    if (!how || !board.nodes.every(node => node.measured?.width)) return;
    board.opened = null;
    if (how === 'arrange') void arrange();
    else requestAnimationFrame(() => void flow.fitView(FIT));
  });
</script>

<svelte:window
  onkeydown={(ev: KeyboardEvent) => {
    hold(ev);
    shortcut(ev);
  }}
  onkeyup={hold}
  onpointermovecapture={release}
/>

<!-- A card reached with Tab is the picked one: the arrow keys move it straight away. -->
<div
  class="area"
  role="presentation"
  bind:this={area}
  ondragover={ev => {
    if (ev.dataTransfer?.types.includes('text/app')) ev.preventDefault();
  }}
  ondrop={ev => {
    const id = ev.dataTransfer?.getData('text/app');
    if (!id || board.live) return;
    ev.preventDefault();
    board.add(id, { x: ev.clientX, y: ev.clientY });
  }}
  onfocusin={ev => {
    const id = (ev.target as Element).matches('.svelte-flow__node')
      ? (ev.target as Element).getAttribute('data-id')
      : null;
    if (id && ![...board.nodes, ...board.infra].find(node => node.id === id)?.selected) board.pick(id);
  }}
>
  <SvelteFlow
    bind:nodes={
      () => [...board.nodes, ...board.infra],
      (all: (CardNode | InfraNode)[]) => {
        // An app the library moved (a drag, the arrow keys) takes its tunnel cards along, in the same step.
        const was = new Map(board.nodes.map(node => [node.id, node.position]));
        const grew: Record<string, { bottom: number; by: number }> = {};
        let infra = all.filter(node => node.type !== 'app');
        let apps = all.filter(node => node.type === 'app');
        const brief = viewport.current.zoom < FAR_ZOOM || board.live;
        // Until the first status is shown, cards are still filling in: that growth is not theirs to push with.
        const settled = live.asked;
        for (const { id, measured } of apps) {
          // Grown or shrunk in the same form, it moves the app cards under it too, each with its own tunnel cards.
          // ponytail: only the cards straight under it; a card under one of those, off to the side, stays.
          const last = heights[id];
          const height = measured?.height;
          if (height) heights[id] = { brief, height };
          // Its own tunnel cards follow any change of height; the app cards under it only one in the same form.
          if (settled && last && height && height !== last.height)
            grew[id] = { bottom: last.height, by: height - last.height };
          const by = settled && last?.brief === brief && height ? height - last.height : 0;
          const box = board.boxes.get(id);
          if (by && box) {
            const under = (other: Box | undefined) =>
              !!other && other.y >= box.y + (last?.height ?? 0) && other.x < box.x + box.w && box.x < other.x + other.w;
            for (const below of apps.filter(node => node.id !== id && under(board.boxes.get(node.id))))
              infra = board.followed(below.id, { x: 0, y: by }, infra);
            apps = apps.map(node =>
              node.id !== id && under(board.boxes.get(node.id))
                ? { ...node, position: { x: node.position.x, y: node.position.y + by } }
                : node,
            );
          }
        }
        for (const { id, position } of apps) {
          // A card that grows or shrinks (its steps open, a note) moves the cards stacked under it by as much.
          const grown = grew[id];
          if (grown) infra = board.pushed(id, position.y + grown.bottom, grown.by, infra);
          const from = was.get(id);
          if (from && (from.x !== position.x || from.y !== position.y))
            infra = board.followed(id, { x: position.x - from.x, y: position.y - from.y }, infra);
        }
        board.nodes = apps;
        board.infra = infra;
        // Moved by a card's change of size, not by anyone: no step of its own to undo.
        if (Object.keys(grew).length) board.adopt();
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
    proOptions={{ hideAttribution: true }}
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
        <button title="Arrange cards by who calls whom, callers on top" onclick={() => void arrange()}>Arrange</button>
        <button title="Zoom to fit all apps (F)" onclick={() => void flow.fitView(FIT)}>Fit</button>
        <span class="sep" aria-hidden="true"></span>
        <div class="zoom" role="group" aria-label="Zoom">
          <button aria-label="Zoom out" onclick={zoomBy(1 / 1.2)}>−</button>
          <button class="percent" title="Reset to 100%" onclick={() => void flow.setZoom(1, { duration: 200 })}>
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
    <!-- The whole board at a glance; dragging in it moves the view, scrolling on it zooms. -->
    <MiniMap
      position="top-right"
      pannable
      zoomable
      width={168}
      height={112}
      ariaLabel="Overview of the board"
      nodeBorderRadius={8}
      nodeStrokeWidth={0}
      nodeColor={node => (node.type === 'app' ? 'color-mix(in oklab, var(--cable) 60%, var(--panel))' : 'var(--line)')}
      bgColor="var(--panel)"
      maskColor="color-mix(in oklab, var(--desk) 72%, transparent)"
      maskStrokeColor="var(--line)"
      maskStrokeWidth={1}
    />
    <!-- Under the cards: the links from each app to its tunnels. -->
    <ViewportPortal target="back">
      <svg class="links" aria-hidden="true">
        {#each links as link (link.key)}
          <path class="link" class:idle={link.idle} d={link.d} />
        {/each}
        {#each flows as flow (flow.key)}
          <g class="flow {flow.kind}">
            <path class="under" d={flow.d} />
            <path class="wire" d={flow.d} />
            <path class="head" d="M-9,-4.5 L0,0 L-9,4.5 L-6.75,0 Z" transform={flow.head} />
            <circle class="plug" cx={flow.start.x} cy={flow.start.y} r="5" />
          </g>
        {/each}
      </svg>
    </ViewportPortal>
    <!-- Above every card, a picked one too: each cable's two ends, which the pointer can grab, and the cable being drawn. -->
    <ViewportPortal target="front" style="position: absolute; z-index: 1001">
      <svg
        class="ends"
        class:reordering={!!board.grabbed}
        class:still={board.live}
        role="group"
        aria-label="Cable ends"
      >
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
            {@const tested = live.sent(edge.source) && live.sent(edge.target)}
            {@const probe = probes.results[edge.id]}
            <!-- Tested, the socket is a button for the keyboard too. -->
            <!-- svelte-ignore a11y_no_noninteractive_tabindex -->
            <circle
              role={tested ? 'button' : 'presentation'}
              tabindex={tested ? 0 : undefined}
              aria-label={tested ? `Test that local ${name(edge.target)} answers ${name(edge.source)}` : undefined}
              onkeydown={ev => {
                if (!tested || (ev.key !== 'Enter' && ev.key !== ' ')) return;
                ev.preventDefault();
                void probes.test({ key: edge.id, payload: { from: edge.source, to: edge.target } });
              }}
              class="socket nodrag nopan"
              class:tested
              data-cable={edge.id}
              class:grabbed={board.grabbed?.id === edge.id && board.grabbed.end === 'to'}
              cx={b.x}
              cy={b.y}
              r="8"
              onpointerdown={ev => {
                pressedAt = { x: ev.clientX, y: ev.clientY };
                board.grabEnd(ev, edge.id, 'to');
              }}
              onclick={ev => {
                // A press that slid reordered the cables or drew a new one: only a press in place tests.
                if (tested && Math.hypot(ev.clientX - pressedAt.x, ev.clientY - pressedAt.y) < 6)
                  void probes.test({ key: edge.id, payload: { from: edge.source, to: edge.target } });
              }}
              >{#if tested}<title>{about(probe, `local ${name(edge.target)} answers`)}</title>{/if}</circle
            >
            <circle
              class="light"
              data-state={tested ? (probe?.state ?? 'idle') : undefined}
              data-light={edge.id}
              cx={b.x}
              cy={b.y}
              r="3.4"
            />
          {/if}
        {/each}
        <!-- Where a tunnel link reaches its card: whether the app gets to its database or cache through the tunnel. -->
        {#each links as link (link.key)}
          {#if live.sent(link.from)}
            {@const probe = probes.results[link.key]}
            <circle
              role="button"
              tabindex="0"
              aria-label="Test that {name(link.from)} reaches its {link.what.toLowerCase()} through the tunnel"
              onkeydown={ev => {
                if (ev.key !== 'Enter' && ev.key !== ' ') return;
                ev.preventDefault();
                void probes.test(link);
              }}
              class="socket tested press nodrag nopan"
              data-link={link.key}
              cx={link.end.x}
              cy={link.end.y}
              r="7"
              onpointerdown={ev => {
                ev.stopPropagation();
              }}
              onclick={() => void probes.test(link)}
              ><title
                >{about(probe, `${name(link.from)} reaches its ${link.what.toLowerCase()} through the tunnel`)}</title
              ></circle
            >
            <circle
              class="light"
              data-state={probe?.state ?? 'idle'}
              data-light={link.key}
              cx={link.end.x}
              cy={link.end.y}
              r="3.4"
            />
          {/if}
        {/each}
        {#if draft}
          <path class="draft" d={draft} />
        {/if}
      </svg>
    </ViewportPortal>
  </SvelteFlow>
  {#if !board.nodes.length}
    <div class="empty">
      <p>Click the apps you want to run together.<br />Connect them; the board is saved as you go.</p>
      {#if lately.length && !board.live}
        <ul aria-label="Or open a board">
          {#each lately as { preset, team, at } (preset.name)}
            <li>
              <button
                type="button"
                onclick={() => {
                  openBoard(preset);
                }}
              >
                <span class="name">{preset.name}</span>
                <span class="meta">{team ? 'Team board' : 'Your board'}{at ? `, opened ${ago(at)}` : ''}</span>
              </button>
            </li>
          {/each}
        </ul>
      {/if}
    </div>
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
  .empty p {
    margin: 0;
  }
  .empty ul {
    display: flex;
    flex-direction: column;
    width: min(380px, 100%);
    margin: 18px auto 0;
    padding: 0;
    overflow: hidden;
    border: 1px solid var(--line);
    border-radius: 10px;
    background: var(--surface);
    list-style: none;
    text-align: left;
    pointer-events: auto;
  }
  .empty ul::before {
    content: 'Or open a board';
    padding: 10px 14px 6px;
    color: var(--muted);
    font-size: 12.5px;
  }
  .empty li + li {
    border-top: 1px solid var(--line);
  }
  .empty button {
    display: flex;
    flex-direction: column;
    gap: 2px;
    width: 100%;
    min-height: 44px;
    padding: 8px 14px;
    border: 0;
    background: none;
    color: var(--ink);
    font: inherit;
    text-align: left;
    cursor: pointer;
  }
  .empty button:hover,
  .empty button:focus-visible {
    background: color-mix(in oklab, var(--ink) 6%, transparent);
    outline: none;
  }
  .empty .name {
    font-weight: 600;
    font-size: 14px;
  }
  .empty .meta {
    color: var(--muted);
    font-size: 12px;
  }
  .area :global(.svelte-flow__minimap) {
    margin: 12px;
    overflow: hidden;
    border: 1px solid var(--line);
    border-radius: 10px;
    background: var(--panel);
    box-shadow: var(--lift);
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
  /* A tunnel link says "uses", not a direction: a plain line. Dashed until its app runs. */
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
  .flow .wire {
    stroke-width: 2;
  }
  .flow .head {
    stroke-width: 1.5;
  }
  .flow.msg :is(.wire, .head) {
    stroke: var(--msg);
  }
  .flow.msg .head {
    fill: var(--msg);
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
  .flow.ext .head {
    fill: var(--socket-rim);
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
  .socket.press {
    cursor: pointer;
  }
  .socket:focus-visible {
    outline: none;
    stroke: var(--cable);
    stroke-width: 3;
  }
  .socket.grabbed {
    r: 10px;
  }
  .light {
    fill: var(--socket-rim);
  }
  .light[data-state='ok'] {
    fill: var(--ok);
  }
  .light[data-state='warn'] {
    fill: var(--warn);
  }
  .light[data-state='bad'] {
    fill: var(--bad);
    stroke: color-mix(in oklab, var(--bad) 35%, transparent);
    stroke-width: 5;
    paint-order: stroke;
  }
  .light[data-state='busy'] {
    fill: var(--warn);
    animation: testing 0.9s ease-in-out infinite alternate;
  }
  @keyframes testing {
    to {
      opacity: 0.25;
    }
  }
  @media (prefers-reduced-motion: reduce) {
    .light[data-state='busy'] {
      animation: none;
    }
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
  .ends.still .socket.tested {
    pointer-events: auto;
    cursor: pointer;
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
  .tools .percent {
    width: 62px;
    padding-inline: 0;
    font-variant-numeric: tabular-nums;
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
