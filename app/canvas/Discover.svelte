<script lang="ts">
  // The Discover view: how the stack fits together around the board, read from its facts. Picking traces; the panel
  // lists a card's links; Plan a run with these takes the picked apps to Plan. Nothing here runs or changes the board.
  import X from '@lucide/svelte/icons/x';
  import Laptop from '@lucide/svelte/icons/laptop';
  import Maximize from '@lucide/svelte/icons/scan';
  import LayoutGrid from '@lucide/svelte/icons/layout-grid';
  import { SvelteFlow, Background, BackgroundVariant, ViewportPortal, useSvelteFlow, type Node } from '@xyflow/svelte';
  import type { Side } from '../src/core/arrange.ts';
  import { cablePath, SIDES, sidePoint, type Box } from '../src/core/cables.ts';
  import type { Card, Link } from '../src/core/discover.ts';
  import { isLight, appearance } from './appearance.svelte.ts';
  import { board } from './board.svelte.ts';
  import { CARD, discovered, type LeanData } from './discover.svelte.ts';
  import LeanCard from './LeanCard.svelte';

  const flow = useSvelteFlow();
  const map = $derived(discovered.map);
  // The map refits when it gains cards or the panel takes or gives back its room.
  const shape = $derived(`${String(map.cards.length)}:${String(!!discovered.last)}`);
  $effect(() => {
    if (shape) setTimeout(() => void flow.fitView({ duration: 200, maxZoom: 1, padding: 0.15 }), 80);
  });
  const near = $derived.by(() => {
    const picked = discovered.picked;
    if (!picked.length) return null;
    const touching = map.links.filter(({ from, to }) => picked.includes(from) || picked.includes(to));
    return new Set([...picked, ...touching.flatMap(({ from, to }) => [from, to])]);
  });
  // What the flow measured and where a card is while it is dragged: kept across redraws so fitting sees every card.
  let flowState = $state.raw<Record<Card, Node>>({});
  const nodes = $derived(
    map.cards.map(({ card, onBoard, hidden }): Node<LeanData> => ({
      id: card,
      type: 'lean',
      ...(flowState[card]?.measured && { measured: flowState[card].measured }),
      position:
        (flowState[card]?.dragging && flowState[card].position) || (discovered.positions[card] ?? { x: 0, y: 0 }),
      data: discovered.data(card, onBoard, hidden),
      selected: discovered.picked.includes(card),
      class: near && !near.has(card) ? 'dimmed' : '',
    })),
  );
  const box = (card: Card): Box | undefined => {
    const at = discovered.positions[card];
    return at && { x: at.x, y: at.y, w: CARD.w, h: discovered.heights[card] ?? CARD.h };
  };
  const onBoard = $derived(new Set(map.cards.filter(one => one.onBoard).map(one => one.card)));
  /** Each link from the side of one card that faces the other: a dot where it leaves, a ring and chevron where it lands. */
  const drawn = $derived(
    map.links.flatMap(link => {
      const [a, b] = [box(link.from), box(link.to)];
      if (!a || !b) return [];
      const dx = b.x + b.w / 2 - (a.x + a.w / 2);
      const dy = b.y + b.h / 2 - (a.y + a.h / 2);
      const sides: [Side, Side] =
        Math.abs(dx) * 0.6 > Math.abs(dy)
          ? dx > 0
            ? ['right', 'left']
            : ['left', 'right']
          : dy > 0
            ? ['bottom', 'top']
            : ['top', 'bottom'];
      const [start, end] = [sidePoint(a, sides[0]), sidePoint(b, sides[1])];
      const [nx, ny] = SIDES[sides[1]];
      const both = link.kind === 'uses';
      const arrow = both
        ? ''
        : `M${String(end.x + nx * 18 - ny * 5)} ${String(end.y + ny * 18 + nx * 5)}L${String(end.x + nx * 13)} ${String(end.y + ny * 13)}L${String(end.x + nx * 18 + ny * 5)} ${String(end.y + ny * 18 - nx * 5)}`;
      return [
        {
          key: `${link.from}>${link.to}>${link.kind}`,
          link,
          d: cablePath(start, sides[0], end, sides[1]),
          start,
          end,
          arrow,
          both,
          board: onBoard.has(link.from) && onBoard.has(link.to),
          faded: !!near && !(discovered.picked.includes(link.from) || discovered.picked.includes(link.to)),
        },
      ];
    }),
  );
  const name = (card: Card) => discovered.data(card, false, 0).name;
  const tag = (card: Card) => discovered.data(card, false, 0).tag;
  /** The picked card's links, by what they do, as the panel lists them. */
  const groups = $derived.by(() => {
    const card = discovered.last;
    if (!card) return [];
    const of = (test: (link: Link) => boolean, other: (link: Link) => Card) =>
      map.links.filter(test).map(link => ({ link, other: other(link) }));
    const into = (kind: Link['kind']) => (link: Link) => link.kind === kind && link.to === card;
    const out = (kind: Link['kind']) => (link: Link) => link.kind === kind && link.from === card;
    const queue = card.startsWith('queue:');
    const database = card.startsWith('database:');
    return [
      ...(queue || database
        ? []
        : [
            { title: 'Called by', rows: of(into('call'), link => link.from) },
            { title: 'Calls', rows: of(out('call'), link => link.to) },
            { title: 'Reads', rows: of(into('read'), link => link.from) },
            { title: 'Publishes', rows: of(out('publish'), link => link.to) },
            { title: 'Data', rows: of(out('uses'), link => link.to) },
          ]),
      ...(queue
        ? [
            { title: 'Published by', rows: of(into('publish'), link => link.from) },
            { title: 'Read by', rows: of(out('read'), link => link.to) },
            { title: 'Fed by', rows: of(into('feeds'), link => link.from) },
            { title: 'Feeds', rows: of(out('feeds'), link => link.to) },
          ]
        : []),
      ...(database ? [{ title: 'Used by', rows: of(into('uses'), link => link.from) }] : []),
    ];
  });
  const lastApp = $derived(discovered.last ? board.app(discovered.last) : undefined);
  const lastStack = $derived(discovered.last ? board.facts?.apps[discovered.last] : undefined);
  /** Brings a card to the middle of the map and picks it. */
  const show = (card: Card) => {
    discovered.picked = [card];
    discovered.last = card;
    void flow.fitView({ nodes: [{ id: card }], duration: 200, maxZoom: flow.getZoom(), minZoom: flow.getZoom() });
  };
  const keys = (ev: KeyboardEvent) => {
    if (ev.metaKey || ev.ctrlKey || ev.altKey) return;
    if ((ev.target as Element | null)?.closest('input, textarea, select, [contenteditable]')) return;
    if (ev.key === 'e' || ev.key === 'E') board.goEdit();
    else if (ev.key === 'l' || ev.key === 'L') board.goLive();
    else if (ev.key === 'f' || ev.key === 'F') void flow.fitView({ duration: 200, maxZoom: 1 });
    else if (ev.key === 'Escape') {
      discovered.picked = [];
      discovered.last = null;
    }
  };
  const pickedNames = $derived(discovered.picked.map(name));
  const runnable = $derived(discovered.picked.filter(card => discovered.data(card, false, 0).app));
  const notCloned = $derived(
    discovered.picked.filter(
      card => !card.includes(':') && !board.facts?.apps[card]?.outside && !runnable.includes(card),
    ),
  );
</script>

<svelte:window onkeydown={keys} />

<div class="discover">
  <div class="map" aria-label="Discover map">
    {#if !board.nodes.length}
      <div class="empty" role="status">
        <h2>No apps on this board</h2>
        <p>Discover starts from a board's apps and shows what is one step away. Add an app in Plan.</p>
        <button
          class="primary"
          type="button"
          onclick={() => {
            board.goEdit();
          }}>Add apps</button
        >
      </div>
    {:else}
      <SvelteFlow
        bind:nodes={
          () => nodes,
          (next: Node[]) => {
            flowState = Object.fromEntries(next.map(node => [node.id, node]));
          }
        }
        nodeTypes={{ lean: LeanCard }}
        edges={[]}
        fitView
        fitViewOptions={{ maxZoom: 1, padding: 0.15 }}
        minZoom={0.2}
        nodesConnectable={false}
        multiSelectionKey={['Shift', 'Meta', 'Control']}
        deleteKey={null}
        colorMode={isLight(appearance.now.scheme) ? 'light' : 'dark'}
        proOptions={{ hideAttribution: true }}
        onnodeclick={({ node, event }) => {
          const card = node.id;
          const adding = event.shiftKey || event.metaKey || event.ctrlKey;
          discovered.picked = adding
            ? discovered.picked.includes(card)
              ? discovered.picked.filter(one => one !== card)
              : [...discovered.picked, card]
            : [card];
          discovered.last = discovered.picked.includes(card) ? card : (discovered.picked.at(-1) ?? null);
        }}
        onpaneclick={() => {
          discovered.picked = [];
          discovered.last = null;
        }}
        onnodedragstop={({ targetNode }) => {
          if (targetNode) discovered.moved(targetNode.id, targetNode.position);
        }}
      >
        <Background
          variant={BackgroundVariant.Dots}
          gap={20}
          size={1.4}
          bgColor="var(--desk)"
          patternColor="var(--line)"
        />
        <ViewportPortal target="back">
          <svg class="links" aria-hidden="true">
            {#each drawn as one (one.key)}
              <g
                class="link"
                class:board={one.board}
                class:found={one.link.sure === 'found'}
                class:faded={one.faded}
                data-link={one.key}
              >
                <path class="wire" d={one.d} />
                <circle class="dot" cx={one.start.x} cy={one.start.y} r="3.5" />
                {#if one.both}
                  <circle class="dot" cx={one.end.x} cy={one.end.y} r="3.5" />
                {:else}
                  <circle class="ring" cx={one.end.x} cy={one.end.y} r="6" />
                  <path class="arrow" d={one.arrow} />
                {/if}
              </g>
            {/each}
          </svg>
        </ViewportPortal>
      </SvelteFlow>

      <div class="legend" aria-label="Legend">
        <span><svg width="28" height="8" aria-hidden="true"><path d="M0 4H28" /></svg>Confirmed</span>
        <span
          ><svg width="28" height="8" aria-hidden="true"><path d="M0 4H28" class="dash" /></svg>Found in code, not
          confirmed</span
        >
        <span class="dim"
          ><svg width="28" height="8" aria-hidden="true"><path d="M0 4H28" /></svg>One step from the board, dimmed</span
        >
      </div>

      {#if discovered.picked.length}
        <div class="pickbar" role="status">
          <span
            ><strong>{discovered.picked.length} picked{discovered.picked.length > 2 ? '.' : ':'}</strong>
            {#if discovered.picked.length > 2}{notCloned.length
                ? `${String(notCloned.length)} ${notCloned.length === 1 ? "isn't" : "aren't"} cloned and will stay deployed`
                : ''}{:else}{pickedNames.join(', ')}{/if}</span
          >
          <button
            class="text"
            type="button"
            onclick={() => {
              discovered.picked = [];
              discovered.last = null;
            }}>Clear</button
          >
          {#if runnable.length}
            <button
              class="primary"
              type="button"
              onclick={() => {
                discovered.planRun();
              }}>Plan a run with these</button
            >
          {:else}
            <span class="nothing">Nothing to run: pick an app</span>
          {/if}
        </div>
      {/if}

      <div class="tools" role="toolbar" aria-label="Discover">
        <button
          type="button"
          title="Fit (F)"
          aria-label="Fit the map in the window"
          onclick={() => void flow.fitView({ duration: 200, maxZoom: 1 })}><Maximize size={16} /></button
        >
        <button
          type="button"
          title="Lay the map out again"
          aria-label="Lay the map out again"
          onclick={() => {
            discovered.rearrange();
          }}><LayoutGrid size={16} /></button
        >
        <button type="button" aria-label="Zoom out" onclick={() => void flow.zoomOut({ duration: 150 })}>−</button>
        <span class="level">Who talks to whom</span>
        <button type="button" aria-label="Zoom in" onclick={() => void flow.zoomIn({ duration: 150 })}>+</button>
      </div>
    {/if}
  </div>

  {#if discovered.last}
    {@const card = discovered.last}
    <aside class="panel" aria-labelledby="discover-panel-title">
      <header>
        <span class="row">
          <h2 id="discover-panel-title">{name(card)}</h2>
          <span class="tag">{tag(card)}</span>
          <button
            class="close"
            type="button"
            aria-label="Close"
            onclick={() => {
              discovered.picked = discovered.picked.filter(one => one !== card);
              discovered.last = null;
            }}><X size={16} /></button
          >
        </span>
        {#if lastApp?.cloned}<span class="where"
            ><Laptop size={14} aria-hidden="true" />Cloned here{lastApp.current ? ` · ${lastApp.current}` : ''}</span
          >{:else if lastStack && !lastStack.outside}<span class="where">On GitHub</span>{/if}
        {#if lastStack?.slug}<span class="slug">{lastStack.slug}</span>{/if}
      </header>
      {#each groups as group (group.title)}
        <section>
          <h3>{group.title}</h3>
          {#if group.rows.length}
            {#each group.rows as { link, other } (`${link.from}>${link.to}>${link.kind}`)}
              <div class="item">
                <span class="line">
                  <svg width="18" height="8" aria-hidden="true"
                    ><path d="M0 4H18" class:dash={link.sure === 'found'} /></svg
                  >
                  <span class="tag">{tag(other)}</span>
                  <button
                    class="name"
                    type="button"
                    onclick={() => {
                      show(other);
                    }}>{name(other)}</button
                  >
                  <span class="source">{link.sure === 'found' ? 'Code' : 'Stack'}</span>
                </span>
                {#if link.sure === 'found'}
                  <span class="detail">
                    <span>Found in code, not confirmed</span>
                    <button class="text" type="button" onclick={() => void discovered.confirm(link)}>Confirm</button>
                  </span>
                {:else if link.via}<span class="detail"><span>{link.via}</span></span>{/if}
              </div>
            {/each}
          {:else}
            <p class="none">Nothing found</p>
          {/if}
        </section>
      {/each}
    </aside>
  {/if}
</div>

<style>
  .discover {
    display: flex;
    flex: 1;
    min-width: 0;
    height: 100%;
  }
  .map {
    position: relative;
    flex: 1;
    min-width: 0;
    background: var(--desk);
    container-type: inline-size;
  }
  /* Too narrow for the legend beside the pick bar: it goes to the top. */
  @container (width < 900px) {
    .legend {
      top: 16px;
      bottom: auto;
    }
  }
  .links {
    position: absolute;
    overflow: visible;
    width: 1px;
    height: 1px;
    pointer-events: none;
  }
  /* Between two of the board's apps a link is ink; out to the ring it is drawn back. Dashed: found, not confirmed. */
  .link {
    --tone: var(--line-strong);
  }
  .link.board {
    --tone: var(--ink);
  }
  .link .wire {
    fill: none;
    stroke: var(--tone);
    stroke-width: 1.5;
  }
  .link.found .wire {
    stroke-dasharray: 5 4;
  }
  .link .dot {
    fill: var(--tone);
  }
  .link .ring {
    fill: var(--desk);
    stroke: var(--tone);
    stroke-width: 1.5;
  }
  .link .arrow {
    fill: none;
    stroke: var(--tone);
    stroke-width: 2;
    stroke-linecap: round;
    stroke-linejoin: round;
  }
  .link.faded {
    opacity: 0.25;
  }
  :global(.svelte-flow__node.dimmed) {
    opacity: 0.25;
  }
  .legend {
    position: absolute;
    left: 16px;
    bottom: 16px;
    z-index: 5;
    display: grid;
    gap: 6px;
    padding: 10px 12px;
    border: 1px solid var(--line);
    background: var(--desk);
    color: var(--ink);
    font: 400 12px var(--sans);
  }
  .legend span {
    display: flex;
    align-items: center;
    gap: 10px;
  }
  .legend path {
    stroke: var(--ink-muted);
    stroke-width: 1.5;
  }
  .legend .dash,
  .item .dash {
    stroke-dasharray: 5 4;
  }
  .legend .dim {
    color: var(--ink-muted);
  }
  .legend .dim path {
    stroke: var(--line-strong);
  }
  .pickbar {
    position: absolute;
    left: 50%;
    bottom: 64px;
    z-index: 5;
    display: flex;
    align-items: center;
    gap: 14px;
    padding: 6px 6px 6px 14px;
    border: 1px solid var(--ink);
    background: var(--panel);
    color: var(--ink);
    font: 400 13px var(--sans);
    white-space: nowrap;
    transform: translateX(-50%);
  }
  .nothing {
    padding: 8px 14px;
    border: 1px dashed var(--line-strong);
    color: var(--ink-muted);
    font: 600 13px var(--sans);
  }
  button.primary {
    padding: 8px 14px;
    border: 0;
    background: var(--local);
    color: var(--desk);
    font: 600 13px var(--sans);
    cursor: pointer;
  }
  button.text {
    padding: 0;
    border: 0;
    background: none;
    color: var(--ink);
    font: 400 13px var(--sans);
    text-decoration: underline;
    text-underline-offset: 3px;
    cursor: pointer;
  }
  .tools {
    position: absolute;
    left: 50%;
    bottom: 16px;
    z-index: 5;
    display: flex;
    gap: 1px;
    border: 1px solid var(--line-strong);
    background: var(--line-strong);
    transform: translateX(-50%);
  }
  .tools button,
  .tools .level {
    display: grid;
    place-items: center;
    min-width: 32px;
    height: 32px;
    padding: 0 8px;
    border: 0;
    background: var(--panel);
    color: var(--ink);
    font: 600 12px var(--sans);
  }
  .tools button {
    cursor: pointer;
  }
  .empty {
    position: absolute;
    top: 50%;
    left: 50%;
    display: grid;
    gap: 10px;
    justify-items: start;
    width: min(420px, calc(100% - 32px));
    padding: 22px 22px 20px;
    border: 1px solid var(--line-strong);
    background: var(--panel);
    transform: translate(-50%, -50%);
  }
  .empty h2 {
    margin: 0;
    font: 600 22px var(--display);
  }
  .empty p {
    margin: 0;
    color: var(--ink-muted);
    font: 400 14px/1.5 var(--sans);
  }
  .panel {
    display: flex;
    flex: none;
    flex-direction: column;
    width: 340px;
    overflow-y: auto;
    padding: 16px 18px;
    border-left: 1px solid var(--line);
    background: var(--panel);
    color: var(--ink);
  }
  .panel header {
    display: grid;
    gap: 6px;
    padding-bottom: 12px;
    border-bottom: 1px solid var(--line);
  }
  .row {
    display: flex;
    align-items: center;
    gap: 10px;
  }
  .panel h2 {
    flex: 1;
    min-width: 0;
    margin: 0;
    font: 600 22px var(--display);
  }
  .tag {
    flex: none;
    padding: 1px 5px;
    border: 1px solid var(--line-strong);
    color: var(--ink-muted);
    font: 400 10px var(--mono);
    letter-spacing: 0.06em;
    text-transform: uppercase;
    white-space: nowrap;
  }
  .close {
    display: grid;
    place-items: center;
    width: 28px;
    height: 28px;
    padding: 0;
    border: 0;
    background: none;
    color: var(--ink);
    cursor: pointer;
  }
  .where {
    display: flex;
    align-items: center;
    gap: 8px;
    font: 400 13px var(--sans);
  }
  .slug {
    color: var(--ink-muted);
    font: 400 12px var(--mono);
  }
  section {
    display: flex;
    flex-direction: column;
    padding-top: 12px;
  }
  h3 {
    margin: 0;
    color: var(--ink-muted);
    font: 600 12px var(--sans);
  }
  .item {
    display: flex;
    flex-direction: column;
    gap: 4px;
    padding: 9px 0;
    border-bottom: 1px solid var(--line);
  }
  .line {
    display: flex;
    align-items: center;
    gap: 8px;
  }
  .line path {
    stroke: var(--ink);
    stroke-width: 1.5;
  }
  .item .name {
    flex: 1;
    min-width: 0;
    padding: 0;
    border: 0;
    background: none;
    color: var(--ink);
    font: 600 14px var(--sans);
    text-align: left;
    text-decoration: underline;
    text-decoration-color: var(--line-strong);
    text-underline-offset: 3px;
    cursor: pointer;
  }
  .source {
    color: var(--ink-muted);
    font: 400 12px var(--sans);
    white-space: nowrap;
  }
  .detail {
    display: flex;
    align-items: center;
    gap: 10px;
    padding-left: 26px;
    color: var(--ink-muted);
    font: 400 12px var(--sans);
  }
  .detail span {
    flex: 1;
    min-width: 0;
  }
  .detail button.text {
    font-size: 12px;
  }
  .none {
    margin: 0;
    padding: 9px 0;
    border-bottom: 1px solid var(--line);
    color: var(--ink-muted);
    font: 400 13px var(--sans);
  }
  :is(button):focus-visible {
    outline: 2px solid var(--ink);
    outline-offset: 2px;
  }
</style>
