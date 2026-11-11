<script lang="ts">
  // The flows a team shared, to read: pick one, move its cards and the map about, and walk its steps. Nothing is kept.
  import type { Point } from '../../src/core/arrange.ts';
  import { CARD, lineOf, type Exported, type Flow } from '../../src/core/export.ts';

  const { data }: { data: Exported } = $props();
  const W = CARD.w;
  const H = CARD.h;

  let picked = $state(0);
  const flow = $derived<Flow | undefined>(data.flows[picked]);
  let at = $state<Record<string, Point>>({});
  let view = $state({ x: 0, y: 0, z: 1 });
  let step = $state<number | null>(null);
  let board = $state<HTMLElement>();
  let panning = $state(false);

  const steps = $derived(flow?.phases.flatMap(phase => phase.steps) ?? []);
  const current = $derived(step === null ? null : (steps[step] ?? null));
  const name = (id: string) => flow?.cards.find(card => card.id === id)?.name ?? id;
  /** The card picked for its description: who it is, and its steps in this flow. */
  let shown = $state<string | null>(null);
  const shownCard = $derived(flow?.cards.find(card => card.id === shown));
  /** The threads the sharer included, on a card or on a step by its number: to read, never to answer. */
  const talksOn = (on: { card: string } | { step: string }) =>
    (flow?.comments ?? []).filter(one =>
      'card' in on ? 'card' in one.on && one.on.card === on.card : 'step' in one.on && one.on.step === on.step,
    );
  /** "Step 1.2: calls Payments API", "Step 1.1: called by Web Shop". */
  const inFlow = $derived(
    shown === null
      ? []
      : steps.flatMap(one =>
          one.from === shown
            ? [`Step ${one.number}: calls ${name(one.to)}`]
            : one.to === shown
              ? [`Step ${one.number}: called by ${name(one.from)}`]
              : [],
        ),
  );
  const exported = $derived(
    new Date(data.exported).toLocaleDateString(undefined, { day: 'numeric', month: 'short', year: 'numeric' }),
  );

  /** Brings the cards into view, zoomed out to fit them when needed, never in past 100%. */
  function fit(ids: string[] = flow?.cards.map(card => card.id) ?? [], pad = 70) {
    const box = board?.getBoundingClientRect();
    const points = ids.flatMap(id => (at[id] ? [at[id]] : []));
    if (!box || !points.length) return;
    const left = Math.min(...points.map(p => p.x));
    const top = Math.min(...points.map(p => p.y)) - 40;
    const w = Math.max(...points.map(p => p.x)) + W - left;
    const h = Math.max(...points.map(p => p.y)) + H - top;
    const z = Math.min(1, (box.width - pad * 2) / w, (box.height - pad * 2 - 60) / h);
    view = { x: (box.width - w * z) / 2 - left * z, y: (box.height - h * z) / 2 - top * z + 30, z };
  }
  function open(index: number) {
    picked = index;
    step = null;
    shown = null;
    at = structuredClone(data.flows[index]?.at ?? {});
    requestAnimationFrame(() => {
      fit();
    });
  }
  open(0);
  function walk(to: number | null) {
    step = to === null ? null : Math.max(0, Math.min(steps.length - 1, to));
    if (current) fit([current.from, current.to], 160);
  }

  /** Each phase's name, above the cards it starts from. */
  const labels = $derived(
    (flow?.phases ?? []).flatMap((phase, index) => {
      const seen = new Set(flow?.phases.slice(0, index).flatMap(one => one.steps.flatMap(s => [s.from, s.to])));
      const own = phase.steps.flatMap(one => [one.from, one.to]).filter(id => !seen.has(id));
      const points = (own.length ? own : [phase.steps[0]?.from ?? '']).flatMap(id => (at[id] ? [at[id]] : []));
      if (!points.length) return [];
      return [
        { index, name: phase.name, x: Math.min(...points.map(p => p.x)), y: Math.min(...points.map(p => p.y)) - 34 },
      ];
    }),
  );
  /** A link from the right of one card to the left of the other, as a curve. */
  function route(from: string, to: string) {
    const a = at[from];
    const b = at[to];
    if (!a || !b) return null;
    const start = { x: a.x + W, y: a.y + H / 2 };
    const end = { x: b.x, y: b.y + H / 2 };
    const bend = Math.max(40, Math.abs(end.x - start.x) / 2);
    return {
      start,
      end,
      d: `M${String(start.x)} ${String(start.y)}C${String(start.x + bend)} ${String(start.y)} ${String(end.x - bend)} ${String(end.y)} ${String(end.x)} ${String(end.y)}`,
      mid: { x: (start.x + end.x) / 2, y: (start.y + end.y) / 2 },
    };
  }

  function drag(event: PointerEvent, id: string) {
    event.stopPropagation();
    const from = at[id];
    if (!from) return;
    const start = { x: event.clientX, y: event.clientY, from: { ...from } };
    const target = event.currentTarget as HTMLElement;
    target.setPointerCapture(event.pointerId);
    target.onpointermove = move => {
      at[id] = {
        x: start.from.x + (move.clientX - start.x) / view.z,
        y: start.from.y + (move.clientY - start.y) / view.z,
      };
    };
    target.onpointerup = up => {
      target.onpointermove = null;
      // Let go where it was taken: a click, which shows the card's description.
      if (Math.hypot(up.clientX - start.x, up.clientY - start.y) < 4) shown = shown === id ? null : id;
    };
  }
  function pan(event: PointerEvent) {
    if ((event.target as Element).closest('button, .card')) return;
    const start = { x: event.clientX - view.x, y: event.clientY - view.y };
    const target = event.currentTarget as HTMLElement;
    target.setPointerCapture(event.pointerId);
    panning = true;
    target.onpointermove = move => {
      view = { ...view, x: move.clientX - start.x, y: move.clientY - start.y };
    };
    target.onpointerup = () => {
      target.onpointermove = null;
      panning = false;
    };
  }
  /** Zooms about a point of the board (its middle unless given), which stays where it is. */
  const zoom = (by: number, around?: { x: number; y: number }) => {
    const box = board?.getBoundingClientRect();
    const point = around ?? { x: (box?.width ?? 0) / 2, y: (box?.height ?? 0) / 2 };
    const z = Math.min(2, Math.max(0.3, view.z * by));
    const k = z / view.z;
    view = { x: point.x - (point.x - view.x) * k, y: point.y - (point.y - view.y) * k, z };
  };
  function keys(event: KeyboardEvent) {
    if (step === null) return;
    if (event.key === 'ArrowRight') walk(step + 1);
    else if (event.key === 'ArrowLeft') walk(step - 1);
    else if (event.key === 'Escape') walk(null);
  }
</script>

<svelte:window onkeydown={keys} />

<!-- eslint-disable @typescript-eslint/no-confusing-void-expression -- {@render} of a snippet returns nothing -->
{#snippet talks(list: NonNullable<Flow['comments']>)}
  {#each list as one, at (at)}
    <div class="talk">
      {#each one.thread as said, n (n)}<p><b>{said.by === 'agent' ? 'Agent' : 'Comment'}</b> {said.text}</p>{/each}
    </div>
  {/each}
{/snippet}

<header>
  <span class="stack">{data.stack}</span><span class="slash">/</span><span class="flow-name">{flow?.name ?? ''}</span>
  <span class="only">View only</span>
  <span class="stamp">{data.env ? `${data.env.toUpperCase()} · ` : ''}{exported}</span>
  <span class="made">Made with koppler</span>
</header>
<div class="layout">
  <nav aria-label="Flows">
    <h2>Flows</h2>
    {#each data.flows as one, index (index)}
      {@const count = one.phases.flatMap(phase => phase.steps).length}
      <button
        type="button"
        class="flow"
        aria-current={index === picked}
        onclick={() => {
          open(index);
        }}
      >
        {one.name}
        <small>{count} {count === 1 ? 'step' : 'steps'}</small>
      </button>
    {:else}
      <p class="none">No flows were shared yet.</p>
    {/each}
  </nav>
  <main
    class="board"
    class:panning
    aria-label="The flow's map"
    bind:this={board}
    onpointerdown={pan}
    onwheel={event => {
      event.preventDefault();
      const box = board?.getBoundingClientRect();
      zoom(event.deltaY > 0 ? 0.9 : 1.1, { x: event.clientX - (box?.left ?? 0), y: event.clientY - (box?.top ?? 0) });
    }}
  >
    <div class="world" style:transform="translate({view.x}px, {view.y}px) scale({view.z})">
      <svg class="links" aria-hidden="true">
        {#each steps as one (one.number)}
          {@const line = route(one.from, one.to)}
          {#if line}
            <g class="link" class:faded={current && current !== one} class:on={current === one}>
              <path d={line.d} />
              <circle class="start" cx={line.start.x} cy={line.start.y} r="4" />
              <circle class="end" cx={line.end.x} cy={line.end.y} r="4" />
              <rect x={line.mid.x - 17} y={line.mid.y - 10} width="34" height="20" />
              <text x={line.mid.x} y={line.mid.y + 4}>{one.number}</text>
            </g>
          {/if}
        {/each}
      </svg>
      {#each labels as label (label.index)}
        <div class="phase" style:left="{label.x}px" style:top="{label.y}px">
          <span class="num">{label.index + 1}</span>{label.name}
        </div>
      {/each}
      {#each flow?.cards ?? [] as card (card.id)}
        {@const place = at[card.id]}
        {#if place}
          <div
            class="card"
            class:dim={current && current.from !== card.id && current.to !== card.id}
            class:on={current && (current.from === card.id || current.to === card.id)}
            class:shown={shown === card.id}
            data-id={card.id}
            style:left="{place.x}px"
            style:top="{place.y}px"
            role="img"
            aria-label="{card.name}, {lineOf(card)}"
            title={card.description}
            onpointerdown={event => {
              drag(event, card.id);
            }}
          >
            <b>{card.name}</b><span>{lineOf(card)}</span>
          </div>
        {/if}
      {/each}
    </div>
    {#if current}
      <div class="stepbar" role="status" aria-label="Step {current.number}">
        <button
          type="button"
          onclick={() => {
            walk((step ?? 0) - 1);
          }}>Previous</button
        >
        <p>
          <span class="num">{current.number}</span>
          <b>{name(current.from)}</b> to <b>{name(current.to)}</b>{current.note ? `: ${current.note}` : ''}
        </p>
        <button
          type="button"
          onclick={() => {
            walk((step ?? 0) + 1);
          }}>Next</button
        >
        <button
          type="button"
          onclick={() => {
            walk(null);
          }}>Stop</button
        >
      </div>
    {/if}
    <div class="tools" role="group" aria-label="View">
      <button
        type="button"
        aria-label="Zoom out"
        onclick={() => {
          zoom(1 / 1.2);
        }}>−</button
      >
      <output>{Math.round(view.z * 100)}%</output>
      <button
        type="button"
        aria-label="Zoom in"
        onclick={() => {
          zoom(1.2);
        }}>+</button
      >
      <button
        type="button"
        onclick={() => {
          fit();
        }}>Fit</button
      >
    </div>
  </main>
  <aside aria-label="Steps">
    {#if shownCard}
      <section class="about" aria-label={shownCard.name}>
        <h2>{shownCard.name}</h2>
        <small>{shownCard.kind}</small>
        {#if shownCard.description}<p>{shownCard.description}</p>{/if}
        {#if inFlow.length}
          <small>In this flow</small>
          <ul>
            {#each inFlow as line (line)}<li>{line}</li>{/each}
          </ul>
        {/if}
        {@render talks(talksOn({ card: shownCard.id }))}
        <button
          type="button"
          class="walk"
          onclick={() => {
            shown = null;
          }}>Close</button
        >
      </section>
    {/if}
    {#if flow}
      <h1>{flow.name}</h1>
      {#if flow.request}<div class="request"><small>What it is for</small>{flow.request}</div>{/if}
      <button
        type="button"
        class="walk"
        onclick={() => {
          walk(0);
        }}>Walk through the steps</button
      >
      {#each flow.phases as phase, index (index)}
        <h3><span class="num">{index + 1}</span>{phase.name}</h3>
        {#each phase.steps as one (one.number)}
          <button
            type="button"
            class="step"
            aria-current={current === one}
            onclick={() => {
              walk(steps.indexOf(one));
            }}
          >
            <span class="n">{one.number}</span>
            <span
              ><b>{name(one.from)} → {name(one.to)}</b>{#if one.note}<span>{one.note}</span>{/if}</span
            >
          </button>
          {@render talks(talksOn({ step: one.number }))}
        {/each}
      {/each}
      <p class="note">Cards can be moved and the map dragged; nothing is kept. Open the file again to start over.</p>
    {/if}
  </aside>
</div>

<style>
  :global(html, body) {
    margin: 0;
    height: 100%;
  }
  :global(body) {
    display: grid;
    grid-template-rows: 56px minmax(0, 1fr);
    overflow: hidden;
    background: var(--desk);
    color: var(--ink);
    font:
      400 15px/1.5 Barlow,
      system-ui,
      sans-serif;
  }
  :global(#app) {
    display: contents;
  }
  header {
    display: flex;
    align-items: center;
    gap: 12px;
    min-width: 0;
    padding: 0 20px;
    border-bottom: 1px solid var(--line);
  }
  .slash {
    color: var(--ink-muted);
  }
  .stack {
    font-weight: 600;
  }
  .flow-name {
    font-weight: 600;
  }
  /* Said once, plainly: the page reads, it changes nothing. */
  .only {
    padding: 1px 6px;
    border: 1px solid var(--line);
    color: var(--ink-muted);
    font:
      600 12px Barlow,
      sans-serif;
  }
  .stamp,
  .made {
    color: var(--ink-muted);
    font-size: 13px;
    white-space: nowrap;
  }
  .made {
    margin-left: auto;
  }
  .layout {
    display: grid;
    grid-template-columns: 220px minmax(0, 1fr) 360px;
    min-height: 0;
  }
  nav {
    overflow: auto;
    padding: 20px 14px;
    border-right: 1px solid var(--line);
  }
  h2 {
    margin: 0 0 10px 6px;
    color: var(--ink-muted);
    font:
      600 12px Barlow,
      sans-serif;
  }
  .flow {
    display: block;
    width: 100%;
    padding: 9px 10px;
    border: 1px solid transparent;
    background: none;
    color: var(--ink);
    font:
      500 16px Barlow,
      sans-serif;
    text-align: left;
    cursor: pointer;
  }
  .flow small {
    display: block;
    color: var(--ink-muted);
    font-size: 13px;
    font-weight: 400;
  }
  .flow:hover,
  .flow[aria-current='true'] {
    background: var(--panel);
  }
  .flow[aria-current='true'] {
    border-color: var(--line-strong);
  }
  .none {
    margin: 0 6px;
    color: var(--ink-muted);
  }
  .board {
    position: relative;
    overflow: hidden;
    background-image: radial-gradient(var(--line) 1px, transparent 1px);
    background-size: 22px 22px;
    cursor: grab;
    touch-action: none;
  }
  .board.panning {
    cursor: grabbing;
  }
  .world {
    position: absolute;
    top: 0;
    left: 0;
    transform-origin: 0 0;
  }
  .links {
    position: absolute;
    top: 0;
    left: 0;
    overflow: visible;
    width: 1px;
    height: 1px;
    pointer-events: none;
  }
  .link {
    transition: opacity 0.2s;
  }
  .link path {
    fill: none;
    stroke: var(--ink-muted);
    stroke-width: 1.4;
  }
  .link .start {
    fill: var(--desk);
    stroke: var(--ink-muted);
    stroke-width: 1.5;
  }
  .link .end {
    fill: var(--ink-muted);
  }
  .link rect {
    fill: var(--desk);
    stroke: var(--ink-muted);
  }
  .link text {
    fill: var(--ink);
    font:
      400 12px 'Sometype Mono',
      monospace;
    text-anchor: middle;
  }
  .link.on path,
  .link.on .start,
  .link.on rect {
    stroke: var(--ink);
  }
  .link.on path {
    stroke-width: 2;
  }
  .link.on .end {
    fill: var(--ink);
  }
  .link.faded {
    opacity: 0.2;
  }
  .card {
    position: absolute;
    box-sizing: border-box;
    width: 200px;
    height: 60px;
    padding: 9px 12px;
    border: 1px solid var(--line-strong);
    background: var(--panel);
    cursor: move;
    user-select: none;
    transition:
      opacity 0.2s,
      border-color 0.2s;
  }
  .card b {
    display: block;
    overflow: hidden;
    font-weight: 600;
    white-space: nowrap;
    text-overflow: ellipsis;
  }
  .card span {
    display: block;
    overflow: hidden;
    color: var(--ink-muted);
    font-size: 13px;
    white-space: nowrap;
    text-overflow: ellipsis;
  }
  .card.dim {
    opacity: 0.3;
  }
  .card.on,
  .card.shown {
    border-color: var(--ink);
  }
  /* A picked card: what it is, and its part in the flow. */
  .about {
    margin-bottom: 18px;
    padding-bottom: 14px;
    border-bottom: 1px solid var(--line);
  }
  .about h2 {
    margin: 0;
    color: var(--ink);
    font:
      600 20px 'Barlow Semi Condensed',
      Barlow,
      sans-serif;
  }
  .about small {
    display: block;
    margin-top: 8px;
    color: var(--ink-muted);
    font-size: 13px;
  }
  .about p {
    margin: 8px 0 0;
  }
  .about ul {
    margin: 4px 0 10px;
    padding-left: 18px;
  }
  .phase {
    position: absolute;
    display: flex;
    align-items: center;
    gap: 8px;
    font-weight: 600;
    white-space: nowrap;
    pointer-events: none;
  }
  .num {
    display: inline-grid;
    place-items: center;
    min-width: 20px;
    height: 20px;
    padding: 0 4px;
    background: var(--ink);
    color: var(--desk);
    font:
      700 12px 'Sometype Mono',
      monospace;
  }
  .stepbar {
    position: absolute;
    top: 18px;
    left: 50%;
    display: flex;
    align-items: center;
    gap: 12px;
    max-width: calc(100% - 40px);
    padding: 10px 14px;
    border: 1px solid var(--ink);
    background: var(--panel);
    transform: translateX(-50%);
  }
  .stepbar p {
    width: 380px;
    min-width: 0;
    margin: 0;
  }
  .stepbar button,
  .tools button {
    border: 1px solid var(--line-strong);
    background: none;
    color: var(--ink);
    font:
      500 14px Barlow,
      sans-serif;
    white-space: nowrap;
    cursor: pointer;
  }
  .stepbar button {
    padding: 5px 10px;
  }
  .tools {
    position: absolute;
    bottom: 18px;
    left: 50%;
    display: flex;
    border: 1px solid var(--line-strong);
    background: var(--panel);
    transform: translateX(-50%);
  }
  .tools button {
    padding: 8px 14px;
    border-width: 0 1px 0 0;
  }
  .tools button:last-child {
    border-right: 0;
  }
  .tools output {
    min-width: 64px;
    padding: 8px 12px;
    border-right: 1px solid var(--line);
    font:
      400 14px 'Sometype Mono',
      monospace;
    text-align: center;
  }
  aside {
    overflow: auto;
    padding: 22px;
    border-left: 1px solid var(--line);
  }
  h1 {
    margin: 0 0 14px;
    font:
      700 30px/1.1 'Barlow Semi Condensed',
      Barlow,
      sans-serif;
  }
  .request {
    margin-bottom: 14px;
    padding: 12px 14px;
    border: 1px solid var(--line);
  }
  .request small {
    display: block;
    color: var(--ink-muted);
    font-size: 13px;
  }
  .walk {
    margin-bottom: 4px;
    padding: 9px 14px;
    border: 0;
    background: var(--ink);
    color: var(--desk);
    font:
      600 15px Barlow,
      sans-serif;
    cursor: pointer;
  }
  h3 {
    display: flex;
    align-items: center;
    gap: 10px;
    margin: 18px 0 6px;
    padding-top: 14px;
    border-top: 1px solid var(--line);
    font:
      600 17px Barlow,
      sans-serif;
  }
  .step {
    display: grid;
    grid-template-columns: 34px minmax(0, 1fr);
    gap: 6px;
    width: 100%;
    padding: 9px 6px;
    border: 0;
    border-left: 2px solid transparent;
    background: none;
    color: var(--ink);
    font: inherit;
    text-align: left;
    cursor: pointer;
  }
  .step:hover,
  .step[aria-current='true'] {
    background: var(--panel);
  }
  .step[aria-current='true'] {
    border-left-color: var(--ink);
  }
  .step .n {
    padding-top: 2px;
    color: var(--ink-muted);
    font:
      400 13px 'Sometype Mono',
      monospace;
  }
  .step b {
    font-weight: 500;
  }
  .step span span {
    display: block;
    color: var(--ink-muted);
    font-size: 14px;
  }
  .note {
    margin-top: 22px;
    padding-top: 12px;
    border-top: 1px solid var(--line);
    color: var(--ink-muted);
    font-size: 13px;
  }
  /* A thread the sharer included: to read only. */
  .talk {
    margin: 4px 0 10px 34px;
    padding: 6px 10px;
    border-left: 2px solid var(--line);
    font-size: 13px;
  }
  .talk p {
    margin: 2px 0;
  }
</style>
