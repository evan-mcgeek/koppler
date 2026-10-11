<script lang="ts">
  import { Handle, Position, useViewport, type NodeProps } from '@xyflow/svelte';
  import type { Side } from '../src/core/arrange.ts';
  import { board, type CardNode } from './board.svelte.ts';

  const { id, data, selected }: NodeProps<CardNode> = $props();
  const SIDES: Side[] = ['top', 'right', 'bottom', 'left'];
  const FAR_ZOOM = 0.6;
  const STARTERS = [
    ['cli', 'Koppler'],
    ['ide', 'Me'],
  ] as const;
  const viewport = useViewport();
  const far = $derived(viewport.current.zoom < FAR_ZOOM);
  const app = $derived(board.apps.find(one => one.id === id));
  const current = $derived(app?.current || 'current branch');
  /** The branches to pick from: the clone's own first, then whatever the board names that the clone does not list. */
  const branches = $derived([...new Set([...(app?.branches ?? []), data.branch].filter(Boolean))]);
  const starts = $derived(!!app?.runIn.some(([value]) => value === 'ide'));
  const tunnels = $derived(board.tunnelsOf(id));
  const queues = $derived(board.queuesOf(id));
  const hiddenQueues = $derived(queues.filter(queue => board.hiddenQueues[queue]));
  const noQueues = $derived(queues.length > 0 && hiddenQueues.length === queues.length);
  const calls = $derived(board.deployedCalls(id));
  /** "Acme Web Portal" reads as "Web Portal" on an Acme card. */
  const short = (name: string) => {
    const [first, ...rest] = name.split(' ');
    return rest.length && first === data.name.split(' ')[0] ? rest.join(' ') : name;
  };
  const mobile = $derived(!!app?.platforms.length && data.run === 'cli');
  const platform = $derived(app?.platforms.find(([value]) => value === data.platform)?.[1]);
  /** What the short card says about how it runs. */
  const runLabel = $derived(data.run === 'ide' ? 'Started by you' : mobile ? platform : undefined);
  /** Worked out when the menu is opened. */
  let cables = $state<ReturnType<typeof board.cablesOf>>({ can: [], wired: [] });
  let noting = $state(false);
  /** A side whose one cable sits on the port: the ring stays lit under its end. */
  const lit = (side: Side) => board.ends.onPort.some(port => port.id === id && port.side === side);
  const wire = (ev: Event) => {
    const menu = ev.currentTarget as HTMLSelectElement;
    const [what, to] = [menu.value[0], menu.value.slice(1)];
    if (what === '+') board.connect(id, to);
    else if (what === '-') board.cut(id, to);
    menu.value = '';
  };
  const grow = (box: HTMLTextAreaElement) => {
    box.style.height = 'auto';
    box.style.height = `${String(box.scrollHeight + 2)}px`;
  };
</script>

<article
  class="card kind-{data.kind}"
  class:selected
  class:far
  class:drop={board.drop === id}
  class:wiring={!!board.draft}
>
  <header>
    <span class="grip" aria-hidden="true" title="Drag to move">
      <svg viewBox="0 0 8 14" width="8" height="14">
        {#each [2.5, 7, 11.5] as cy (cy)}<circle cx="2" {cy} r="1.2" /><circle cx="6" {cy} r="1.2" />{/each}
      </svg>
    </span>
    <span class="name" title={data.name}>{data.name}</span>
    <span class="kind">{data.kindLabel}</span>
    <button
      class="remove nodrag"
      type="button"
      aria-label="Remove {data.name}"
      onclick={() => {
        board.remove(id);
      }}>×</button
    >
  </header>
  {#if far}
    <p class="glance">
      <span title="Branch: {data.branch || current}">{data.branch || current}</span>
      {#if runLabel}<span>{runLabel}</span>{/if}
      {#if noQueues}<span title="Its queues are hidden and stay the deployed ones">No queues</span>{/if}
      {#if data.hideTunnels && tunnels.length}<span
          class="off"
          title="Only the API runs; calls through its tunnels fail">No tunnels</span
        >{/if}
    </p>
  {:else}
    <div class="body nodrag nopan">
      <label class="field">
        Branch
        <span class="combo">
          <select
            class="mono"
            value={data.branch === app?.current ? '' : data.branch}
            onchange={ev => {
              board.set(id, { branch: ev.currentTarget.value });
            }}
          >
            <option value="">{current}{app?.dirty ? ', with your uncommitted changes' : ''}</option>
            {#each branches.filter(branch => branch !== app?.current) as branch (branch)}
              <option value={branch}>{branch}</option>
            {/each}
          </select>
        </span>
      </label>
      {#if starts || tunnels.length || queues.length}
        <div class="row">
          {#if starts}
            <div
              class="field"
              role="group"
              aria-label="Who starts it"
              title="Koppler: the agent starts it. Me: you start it yourself (IDE, terminal, anything); the agent only prepares it."
            >
              Started by
              <span class="seg">
                {#each STARTERS as [value, label] (value)}
                  <label>
                    <input
                      type="radio"
                      name="run-{id}"
                      {value}
                      checked={data.run === value}
                      onchange={() => {
                        board.set(id, { run: value });
                      }}
                    />{label}
                  </label>
                {/each}
              </span>
            </div>
          {/if}
          {#if mobile}
            <label class="field">
              Platform
              <span class="combo">
                <select
                  class="mono"
                  value={data.platform}
                  onchange={ev => {
                    board.set(id, { platform: ev.currentTarget.value });
                  }}
                >
                  {#each app?.platforms ?? [] as [value, label] (value)}<option {value}>{label}</option>{/each}
                </select>
              </span>
            </label>
          {/if}
          {#if tunnels.length}
            <div class="field">
              Tunnels
              <label
                class="switch"
                title={data.hideTunnels
                  ? 'Off: only the API runs; calls through its tunnels fail.'
                  : 'On: Koppler opens its tunnels. Turn off when you only need the API.'}
              >
                <input
                  type="checkbox"
                  role="switch"
                  aria-label="Open {data.name}'s tunnels"
                  checked={!data.hideTunnels}
                  onchange={ev => {
                    board.set(id, { hideTunnels: !ev.currentTarget.checked });
                  }}
                /><span class="track" aria-hidden="true"></span>{data.hideTunnels ? 'Off' : 'On'}
              </label>
            </div>
          {/if}
          {#if queues.length}
            <div class="field">
              Queues
              <label
                class="switch"
                title={noQueues
                  ? 'Off: its queues are hidden, and stay the deployed ones.'
                  : 'On: its queues show on the board, where each can be switched to a local copy.'}
              >
                <input
                  type="checkbox"
                  role="switch"
                  aria-label="Show {data.name}'s queues"
                  checked={!noQueues}
                  onchange={ev => {
                    board.showQueues(queues, ev.currentTarget.checked);
                  }}
                /><span class="track" aria-hidden="true"></span>{noQueues ? 'Off' : 'On'}
              </label>
              {#if hiddenQueues.length && !noQueues}
                <button
                  class="link"
                  type="button"
                  onclick={() => {
                    board.showQueues(queues, true);
                  }}>Show {hiddenQueues.length} hidden</button
                >
              {/if}
            </div>
          {/if}
        </div>
      {/if}
      <label class="field">
        Cables
        <span class="combo">
          <select
            aria-label="Add or remove a cable from {data.name}"
            onfocus={() => (cables = board.cablesOf(id))}
            onpointerdown={() => (cables = board.cablesOf(id))}
            onchange={wire}
          >
            <option value="">Add or remove…</option>
            {#if cables.can.length}
              <optgroup label="Call a local app">
                {#each cables.can as other (other.id)}<option value="+{other.id}">{other.name}</option>{/each}
              </optgroup>
            {/if}
            {#if cables.wired.length}
              <optgroup label="Remove the cable to">
                {#each cables.wired as other (other.id)}<option value="-{other.id}">{other.name}</option>{/each}
              </optgroup>
            {/if}
          </select>
        </span>
      </label>
      {#if data.note || noting}
        <label class="field">
          Note for the agent
          <textarea
            rows="2"
            placeholder="e.g. run with the new pricing flag on"
            value={data.note}
            {@attach grow}
            oninput={ev => {
              grow(ev.currentTarget);
              board.set(id, { note: ev.currentTarget.value });
            }}
            onblur={() => (noting = false)}
          ></textarea>
        </label>
      {:else}
        <button class="note-toggle" type="button" onclick={() => (noting = true)}>Add a note for the agent</button>
      {/if}
    </div>
  {/if}
  {#if calls.length}
    <div class="calls nodrag nopan">
      <span class="calls-label">Calls {board.env.toUpperCase()}</span>
      {#each calls as other (other.id)}
        {@const onBoard = board.nodes.some(node => node.id === other.id)}
        {@const can = onBoard || other.cloned}
        <button
          class="chip"
          type="button"
          disabled={!can}
          title="{other.name} stays on deployed {board.env.toUpperCase()}.{can
            ? ` Click to ${onBoard ? 'wire it to your local copy' : 'run it locally too and wire it'}.`
            : ' It is not cloned on this Mac.'}"
          onclick={() => {
            board.callLocally(id, other.id);
          }}>{short(other.name)}</button
        >
      {/each}
    </div>
  {/if}
  <!-- The one anchor Svelte Flow needs to draw this card's cables; the ports below are ours. -->
  <Handle type="source" position={Position.Top} isConnectable={false} class="anchor" />
  {#each SIDES as side (side)}
    <button
      class="port {side} nodrag nopan"
      class:on={lit(side)}
      aria-label="Draw a cable from the {side} of {data.name}"
      title="Drag a cable to an app this one should call locally"
      tabindex="-1"
      onpointerdown={ev => {
        if (ev.button !== 0) return;
        ev.stopPropagation();
        board.startWire(id, side);
      }}
    ></button>
  {/each}
</article>

<style>
  .card {
    position: relative;
    width: max-content;
    min-width: 260px;
    max-width: 380px;
    background: var(--surface);
    border: 1px solid var(--line);
    border-radius: 10px;
    color: var(--ink);
    font: 14px/1.4 var(--sans);
    user-select: none;
  }
  .card.selected,
  :global(.svelte-flow__node:focus-visible) .card {
    outline: 2px solid var(--cable);
    outline-offset: 3px;
  }
  .card.drop {
    outline: 2px solid var(--ok);
    outline-offset: 3px;
  }
  /* Only the title sets a card's width: everything below it fits whatever width the title makes. */
  .body,
  .glance {
    contain: inline-size;
  }
  header {
    display: flex;
    align-items: center;
    gap: 8px;
    min-height: 44px;
    padding: 6px 8px 6px 16px;
    border-bottom: 1px solid var(--line);
    cursor: grab;
  }
  .far header {
    border-bottom: 0;
  }
  .grip {
    display: grid;
    margin-left: -6px;
    fill: var(--muted);
    opacity: 0.6;
  }
  .kind {
    flex: none;
    margin-left: 10px;
    padding: 1px 7px;
    border-radius: 999px;
    font: 600 12px/1.5 var(--sans);
    white-space: nowrap;
    color: var(--kind);
    background: color-mix(in oklab, var(--kind) 14%, transparent);
  }
  .name {
    flex: 1;
    min-width: 0;
    font-weight: 700;
    font-size: 15px;
    line-height: 1.2;
    text-wrap: balance;
    overflow-wrap: anywhere;
  }
  .far .name {
    font-size: 26px;
  }
  .remove {
    width: 26px;
    height: 26px;
    padding: 0;
    border: 0;
    border-radius: 6px;
    background: none;
    color: var(--muted);
    font-size: 16px;
    line-height: 1;
    cursor: pointer;
  }
  .remove:hover {
    background: color-mix(in oklab, var(--ink) 8%, transparent);
    color: var(--ink);
  }
  .body {
    display: grid;
    gap: 8px;
    padding: 10px 14px 14px 16px;
    cursor: default;
  }
  .row {
    display: grid;
    grid-template-columns: 1fr 1fr;
    gap: 8px;
  }
  .field {
    display: grid;
    gap: 3px;
    font-size: 12px;
    color: var(--muted);
  }
  .combo {
    position: relative;
    display: block;
  }
  .combo::after {
    content: '';
    position: absolute;
    right: 11px;
    top: 50%;
    width: 6px;
    height: 6px;
    border-right: 1.5px solid var(--muted);
    border-bottom: 1.5px solid var(--muted);
    transform: translateY(-70%) rotate(45deg);
    pointer-events: none;
  }
  select {
    width: 100%;
    height: 30px;
    padding: 0 26px 0 8px;
    border: 1px solid var(--line);
    border-radius: 6px;
    background: var(--paper);
    color: var(--ink);
    font: 13px var(--sans);
    appearance: none;
    cursor: pointer;
    text-overflow: ellipsis;
  }
  select.mono {
    font: 12px var(--mono);
  }
  .seg {
    display: flex;
    gap: 2px;
    height: 30px;
    padding: 2px;
    border: 1px solid var(--line);
    border-radius: 8px;
    background: color-mix(in oklab, var(--ink) 5%, transparent);
  }
  .seg label {
    position: relative;
    flex: 1;
    display: grid;
    place-items: center;
    padding: 0 10px;
    border-radius: 6px;
    color: var(--muted);
    font-weight: 600;
    font-size: 12.5px;
    cursor: pointer;
  }
  .seg input {
    position: absolute;
    inset: 0;
    margin: 0;
    opacity: 0;
    cursor: pointer;
  }
  .seg label:has(input:checked) {
    background: var(--surface);
    color: var(--ink);
    box-shadow:
      0 0 0 1px var(--line),
      0 1px 2px rgb(0 0 0 / 0.12);
  }
  .seg label:has(input:focus-visible) {
    outline: 2px solid var(--cable);
    outline-offset: -2px;
  }
  .switch {
    position: relative;
    display: flex;
    align-items: center;
    gap: 8px;
    min-height: 30px;
    color: var(--ink);
    font-weight: 600;
    font-size: 13px;
    cursor: pointer;
  }
  .switch input {
    position: absolute;
    z-index: 1;
    inset: 0;
    width: 100%;
    height: 100%;
    margin: 0;
    opacity: 0;
    cursor: pointer;
  }
  .track {
    position: relative;
    flex: none;
    width: 28px;
    height: 16px;
    border-radius: 999px;
    background: color-mix(in oklab, var(--ink) 22%, transparent);
    transition: background 0.15s;
  }
  .track::after {
    content: '';
    position: absolute;
    top: 2px;
    left: 2px;
    width: 12px;
    height: 12px;
    border-radius: 50%;
    background: var(--surface);
    box-shadow: 0 1px 2px rgb(0 0 0 / 0.3);
    transition: transform 0.15s;
  }
  .switch input:checked + .track {
    background: var(--cable);
  }
  .switch input:checked + .track::after {
    transform: translateX(12px);
  }
  .switch input:focus-visible + .track {
    outline: 2px solid var(--cable);
    outline-offset: 2px;
  }
  @media (prefers-reduced-motion: reduce) {
    .track,
    .track::after {
      transition: none;
    }
  }
  .link {
    justify-self: start;
    padding: 0;
    border: 0;
    background: none;
    color: var(--cable);
    font: 500 12px var(--sans);
    cursor: pointer;
  }
  .link:hover {
    text-decoration: underline;
  }
  .calls {
    contain: inline-size;
    display: flex;
    flex-wrap: wrap;
    align-items: center;
    gap: 6px;
    padding: 8px 12px 10px 16px;
    border-top: 1px dashed var(--line);
    cursor: default;
  }
  .far .calls {
    display: none;
  }
  .calls-label {
    margin-right: 2px;
    color: var(--muted);
    font-size: 12px;
  }
  .chip {
    max-width: 180px;
    min-height: 24px;
    padding: 3px 8px;
    overflow: hidden;
    border: 1px dashed color-mix(in oklab, var(--muted) 70%, transparent);
    border-radius: 999px;
    background: none;
    color: var(--ink);
    font: 500 12px var(--sans);
    white-space: nowrap;
    text-overflow: ellipsis;
    cursor: pointer;
  }
  .chip:hover:not(:disabled) {
    border-style: solid;
    border-color: var(--cable);
    color: var(--cable);
  }
  .chip:disabled {
    color: var(--muted);
    cursor: default;
  }
  .glance .off {
    background: color-mix(in oklab, var(--warn) 14%, transparent);
    color: var(--warn);
    font: 600 15px var(--sans);
  }
  .note-toggle {
    display: inline-flex;
    justify-self: start;
    align-items: center;
    gap: 5px;
    min-height: 24px;
    padding: 2px 0;
    border: 0;
    background: none;
    color: var(--muted);
    font: 500 12.5px var(--sans);
    cursor: pointer;
  }
  .note-toggle::before {
    content: '+';
    font-size: 16px;
    line-height: 1;
  }
  .note-toggle:hover {
    color: var(--cable);
  }
  textarea {
    width: 100%;
    min-height: 52px;
    padding: 6px 8px;
    resize: none;
    overflow: hidden;
    border: 1px solid var(--line);
    border-radius: 6px;
    background: var(--paper);
    color: var(--ink);
    font: 13px/1.4 var(--sans);
  }
  textarea::placeholder {
    color: var(--muted);
  }
  :is(select, textarea, .remove, .note-toggle):focus-visible {
    outline: 2px solid var(--cable);
    outline-offset: 1px;
  }
  .glance {
    display: flex;
    flex-wrap: wrap;
    gap: 6px;
    margin: 0;
    padding: 0 16px 10px;
  }
  .glance span {
    padding: 2px 8px;
    border-radius: 6px;
    background: color-mix(in oklab, var(--ink) 7%, transparent);
    font: 15px var(--mono);
    color: var(--muted);
  }
  .port {
    position: absolute;
    width: 16px;
    height: 16px;
    margin: -8px 0 0 -8px;
    padding: 0;
    border: 2px solid var(--ink);
    border-radius: 50%;
    background: var(--surface);
    opacity: 0;
    cursor: crosshair;
    transition: opacity 0.1s;
  }
  .card:hover .port,
  .card.wiring .port,
  .port.on {
    opacity: 1;
  }
  .port:hover {
    border-color: var(--cable);
  }
  /* On the card's outer edge, where its cables end: one pixel out from where the border's inside puts them. */
  .port.top {
    left: 50%;
    top: -1px;
  }
  .port.right {
    left: calc(100% + 1px);
    top: 50%;
  }
  .port.bottom {
    left: 50%;
    top: calc(100% + 1px);
  }
  .port.left {
    left: -1px;
    top: 50%;
  }
  .card :global(.anchor) {
    visibility: hidden;
  }
  @media (prefers-reduced-motion: reduce) {
    .port {
      transition: none;
    }
  }
</style>
