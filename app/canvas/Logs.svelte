<script lang="ts">
  import Icon from './Icon.svelte';
  import X from '@lucide/svelte/icons/x';
  import { parseLog, parseStamped } from '../src/core/logfmt.ts';
  import { board } from './board.svelte.ts';
  import { live } from './live.svelte.ts';
  import { ALL, logs, type Names, type Span } from './logs.svelte.ts';

  const LABEL: Record<string, string> = {
    debug: 'DEBUG',
    warn: 'WARN',
    error: 'ERROR',
    koppler: 'KOPPLER',
    start: 'START',
  };
  const active = $derived(logs.active);
  const text = $derived(active ? logs.text(active) : '');
  // Keyed by what a row says, so a row keeps its place (and an open list of warnings stays open) as the log scrolls on.
  const rows = $derived.by(() => {
    const seen: Record<string, number> = {};
    return (logs.raw ? [] : parseLog(text)).map(row => {
      const said = `${row.time} ${row.text}`;
      const count = (seen[said] = (seen[said] ?? 0) + 1);
      return { ...row, key: `${said}#${String(count)}` };
    });
  });
  const all = $derived(active === ALL);
  const clock = (at: number) => new Date(at).toLocaleTimeString([], { hour12: false });
  const kindOf = $derived(Object.fromEntries(board.nodes.map(node => [node.id, node.data.kind])));
  const hidden = $derived(board.nodes.filter(node => board.hiddenLogs[node.id]));
  const merged = $derived.by(() => {
    if (!all) return [];
    const seen: Record<string, number> = {};
    return parseStamped(logs.all.filter(entry => !board.hiddenLogs[entry.app])).map((row, at, rows) => {
      const said = `${row.app} ${String(row.at)} ${row.text}`;
      const count = (seen[said] = (seen[said] ?? 0) + 1);
      const named = logs.names === 'every' || rows[at - 1]?.app !== row.app;
      return { ...row, named, key: `${said}#${String(count)}` };
    });
  });
  let body: HTMLElement | undefined = $state();
  let pane: HTMLElement | undefined = $state();
  // The pane's height as a share of the room it has, remembered; none until it is first changed.
  const KEY = 'koppler-logs-height';
  const kept = () => {
    try {
      return Number(localStorage.getItem(KEY)) || 0;
    } catch {
      return 0;
    }
  };
  let share = $state(kept());
  let dragging = $state(false);
  const room = () => pane?.parentElement?.getBoundingClientRect().height ?? 0;
  const setHeight = (px: number) => {
    if (!room()) return;
    share = Math.min(Math.max(px, 120), room() - 60) / room();
    try {
      localStorage.setItem(KEY, String(share));
    } catch {
      // Not kept; the pane still has the size.
    }
  };
  const height = () => pane?.getBoundingClientRect().height ?? 0;
  const big = $derived(share > 0.6);
  const toggleSize = () => {
    setHeight(room() * (big ? 0.38 : 0.85));
  };
  const drag = (ev: PointerEvent) => {
    ev.preventDefault();
    const start = ev.clientY;
    const from = height();
    dragging = true;
    const move = (now: PointerEvent) => {
      setHeight(from + start - now.clientY);
    };
    addEventListener('pointermove', move);
    addEventListener(
      'pointerup',
      () => {
        removeEventListener('pointermove', move);
        dragging = false;
      },
      { once: true },
    );
  };
  const step = (ev: KeyboardEvent) => {
    if (ev.key !== 'ArrowUp' && ev.key !== 'ArrowDown') return;
    ev.preventDefault();
    setHeight(height() + (ev.key === 'ArrowUp' ? 40 : -40));
  };
  let shown: string | null = null;
  // The open tab is read again as the status comes in.
  $effect(() => {
    if (live.status) logs.refresh();
  });
  // Read again at once on opening the tab, or leaving an app out or bringing it back.
  $effect(() => {
    logs.reload();
  });
  // Stays at the newest line unless scrolled up; a tab just opened starts at its end.
  $effect.pre(() => {
    if (!body) return;
    // Read on every new text, so the pane follows it.
    const filled = all ? merged.length : text;
    const pinned = shown !== active || !filled || body.scrollHeight - body.scrollTop - body.clientHeight < 24;
    shown = active;
    const pane = body;
    if (pinned)
      requestAnimationFrame(() => {
        pane.scrollTop = pane.scrollHeight;
      });
  });
</script>

{#if active}
  <section
    class="logs"
    class:dragging
    aria-label="App log"
    bind:this={pane}
    style:height={share ? `${String(share * 100)}%` : undefined}
  >
    <!-- svelte-ignore a11y_no_noninteractive_tabindex, a11y_no_noninteractive_element_interactions -->
    <div
      class="grip"
      role="separator"
      aria-orientation="horizontal"
      aria-label="Resize the log"
      tabindex="0"
      title="Drag to resize. Double-click to switch between big and small."
      onpointerdown={drag}
      ondblclick={toggleSize}
      onkeydown={step}
    ></div>
    <header>
      <div class="tabs" role="tablist">
        <span class="tab" class:on={all}>
          <button
            type="button"
            role="tab"
            aria-selected={all}
            onclick={() => {
              logs.active = ALL;
            }}>{logs.label(ALL)}</button
          >
        </span>
        {#each logs.tabs as id (id)}
          {@const up = logs.past(id) ? null : live.up(id)}
          <span class="tab" class:on={id === active}>
            <button
              type="button"
              role="tab"
              aria-selected={id === active}
              onclick={() => {
                logs.active = id;
              }}
            >
              <span class="live" data-on={up} aria-hidden="true"></span>{logs.label(id)}
            </button>
            <button
              class="x"
              type="button"
              aria-label="Close {logs.label(id)} log"
              onclick={() => {
                logs.close(id);
              }}><Icon of={X} size={14} /></button
            >
          </span>
        {/each}
      </div>
      <span class="meta">{all || (logs.past(active) ? text : live.tail(active)) ? '' : 'no log yet'}</span>
      {#if all}
        {#if hidden.length}
          <details class="left-out">
            <summary>{hidden.length} left out</summary>
            <div class="menu">
              {#each hidden as node (node.id)}
                <button
                  type="button"
                  title="Show {board.nameOf(node.id)} in this log again"
                  onclick={() => {
                    board.showLog(node.id, true);
                  }}>{board.nameOf(node.id)}</button
                >
              {/each}
            </div>
          </details>
        {/if}
        <select
          aria-label="Names"
          value={logs.names}
          onchange={ev => {
            logs.setNames(ev.currentTarget.value as Names);
          }}
        >
          <option value="every">Name on every line</option>
          <option value="change">Name when the app changes</option>
        </select>
        <select
          aria-label="How much"
          value={logs.since}
          onchange={ev => {
            logs.setSince(ev.currentTarget.value as Span);
          }}
        >
          <option value="run">Since the run started</option>
          <option value="hour">Last hour</option>
          <option value="lines">Last 2,000 lines</option>
        </select>
      {:else}
        <button
          type="button"
          title="Hide what is in this log so far; new lines keep coming. The log file is not touched."
          onclick={() => {
            logs.clear();
          }}>Clear</button
        >
        <button
          type="button"
          aria-pressed={logs.raw}
          title="Show the log exactly as the app wrote it"
          onclick={() => (logs.raw = !logs.raw)}>Raw</button
        >
      {/if}
      <button type="button" onclick={toggleSize}>{big ? 'Shrink' : 'Expand'}</button>
      <button
        type="button"
        onclick={() => {
          logs.closeAll();
        }}>Close all</button
      >
    </header>
    <div
      class="body"
      class:raw={logs.raw && !all}
      class:all
      class:no-time={!all && !rows.some(row => row.time)}
      role="log"
      bind:this={body}
    >
      {#if all}
        {#if !merged.length}
          <p class="empty">
            {logs.allApps().length ? 'No lines yet from the apps on the board.' : 'No apps on the board to show.'}
          </p>
        {/if}
        {#each merged as row (row.key)}
          <div class="row" data-level={row.level}>
            <span class="t" title={row.approx ? 'Approximate: the time Koppler first read this line' : undefined}
              >{row.approx ? '~' : ''}{clock(row.at)}</span
            ><span class="l">{LABEL[row.level] ?? ''}</span>
            {#if row.named}
              <button
                type="button"
                class="n kind-{kindOf[row.app]}"
                title="Leave {board.nameOf(row.app)} out of this log"
                onclick={() => {
                  board.showLog(row.app, false);
                }}>{board.nameOf(row.app)}</button
              >
            {:else}
              <span></span>
            {/if}
            {#if row.items}
              <details class="m"><summary>{row.text}</summary><span class="x">{row.items.join('\n')}</span></details>
            {:else}
              <span class="m">{row.text}</span>
              {#if row.detail}<span class="x">{row.detail}</span>{/if}
            {/if}
          </div>
        {/each}
      {:else if !text}
        <p class="empty">
          {logs.cleared[active]
            ? 'Cleared. New lines show up here.'
            : 'No output captured for this app. Apps started from an IDE keep their output there.'}
        </p>
      {:else if logs.raw}
        {text}
      {:else}
        {#each rows as row (row.key)}
          <div class="row" data-level={row.level}>
            <span class="t">{row.time}</span><span class="l">{LABEL[row.level] ?? ''}</span>
            {#if row.items}
              <details class="m"><summary>{row.text}</summary><span class="x">{row.items.join('\n')}</span></details>
            {:else}
              <span class="m">{row.text}</span>
              {#if row.detail}<span class="x">{row.detail}</span>{/if}
            {/if}
          </div>
        {/each}
      {/if}
    </div>
  </section>
{/if}

<style>
  .logs {
    position: relative;
    flex: none;
    display: flex;
    flex-direction: column;
    height: 38%;
    min-height: 120px;
    max-height: calc(100% - 60px);
    border-top: 1px solid var(--line);
    background: var(--surface);
    color: var(--ink);
  }
  .grip {
    position: absolute;
    z-index: 2;
    top: -4px;
    right: 0;
    left: 0;
    height: 8px;
    cursor: ns-resize;
  }
  .grip::after {
    position: absolute;
    top: 2px;
    left: 50%;
    width: 36px;
    height: 4px;
    margin-left: -18px;
    border-radius: 2px;
    background: var(--line);
    content: '';
  }
  .grip:hover::after,
  .grip:focus-visible::after,
  .dragging .grip::after {
    background: var(--cable);
  }
  .dragging {
    cursor: ns-resize;
    user-select: none;
  }
  header {
    display: flex;
    align-items: stretch;
    gap: 10px;
    padding: 0 12px 0 4px;
    border-bottom: 1px solid var(--line);
    font: 13px var(--sans);
  }
  .tabs {
    display: flex;
    min-width: 0;
    overflow-x: auto;
  }
  .tab {
    display: flex;
    align-items: center;
    padding-right: 8px;
    border-right: 1px solid var(--line);
    border-bottom: 2px solid transparent;
  }
  .tab.on {
    border-bottom-color: var(--cable);
    background: color-mix(in oklab, var(--ink) 4%, transparent);
  }
  .tab button[role='tab'] {
    display: flex;
    align-items: center;
    gap: 7px;
    padding: 7px 4px 7px 12px;
    border: 0;
    background: none;
    color: var(--muted);
    font: 500 13px var(--sans);
    white-space: nowrap;
    cursor: pointer;
  }
  .tab.on button[role='tab'] {
    color: var(--ink);
    font-weight: 600;
  }
  .live {
    width: 8px;
    height: 8px;
    border-radius: 50%;
    background: var(--line);
  }
  .live[data-on='true'] {
    background: var(--ok);
  }
  .live[data-on='false'] {
    background: var(--bad);
  }
  .x {
    display: grid;
    place-items: center;
    width: 24px;
    height: 24px;
    padding: 0;
    border: 0;
    border-radius: 4px;
    background: none;
    color: var(--muted);
    font-size: 14px;
    cursor: pointer;
  }
  .x:hover {
    background: color-mix(in oklab, var(--ink) 10%, transparent);
    color: var(--ink);
  }
  .meta {
    flex: 1;
    align-self: center;
    overflow: hidden;
    color: var(--muted);
    font-size: 12px;
    white-space: nowrap;
    text-overflow: ellipsis;
  }
  header > button {
    align-self: center;
    padding: 4px 10px;
    border: 1px solid transparent;
    border-radius: 8px;
    background: none;
    color: var(--ink);
    font: 600 13px var(--sans);
    cursor: pointer;
  }
  header > button:hover,
  header > button[aria-pressed='true'] {
    background: color-mix(in oklab, var(--ink) 10%, transparent);
  }
  .body {
    flex: 1;
    padding: 6px 0 10px;
    overflow: auto;
    font: 12px/1.55 var(--mono);
    user-select: text;
    scrollbar-width: thin;
  }
  .body.raw {
    padding: 10px 14px;
    white-space: pre-wrap;
    overflow-wrap: anywhere;
    line-height: 1.5;
  }
  .empty {
    max-width: 72ch;
    margin: 0;
    padding: 14px 16px;
    color: var(--muted);
    font: 13px var(--sans);
  }
  .row {
    display: grid;
    grid-template-columns: 64px 50px minmax(0, 1fr);
    column-gap: 10px;
    padding: 2px 14px 2px 2px;
  }
  .row + .row {
    border-top: 1px solid color-mix(in oklab, var(--line) 45%, transparent);
  }
  .row:hover {
    background: color-mix(in oklab, var(--ink) 4%, transparent);
  }
  .t {
    padding-left: 12px;
    color: var(--muted);
    font-variant-numeric: tabular-nums;
    opacity: 0.8;
  }
  .l {
    color: var(--muted);
    font-size: 12px;
    font-weight: 700;
    letter-spacing: 0.02em;
  }
  .m {
    white-space: pre-wrap;
    overflow-wrap: anywhere;
  }
  .x:not(button) {
    grid-column: 3;
    max-height: 220px;
    margin: 2px 0 4px;
    padding: 6px 10px;
    overflow: auto;
    border-radius: 6px;
    background: color-mix(in oklab, var(--ink) 5%, transparent);
    color: var(--muted);
    font-size: 12px;
    line-height: 1.5;
    white-space: pre-wrap;
    overflow-wrap: anywhere;
  }
  details .x {
    display: block;
    margin-top: 4px;
  }
  summary {
    color: var(--warn);
    cursor: pointer;
  }
  .row[data-level='debug'] .m {
    color: var(--muted);
  }
  .row[data-level='warn'] {
    background: color-mix(in oklab, var(--warn) 6%, transparent);
  }
  .row[data-level='warn'] .l {
    color: var(--warn);
  }
  .row[data-level='error'] {
    background: color-mix(in oklab, var(--bad) 9%, transparent);
  }
  .row[data-level='error'] .l {
    color: var(--bad);
  }
  .row[data-level='koppler'] .m {
    color: var(--muted);
    font-style: italic;
  }
  .row[data-level='start'] {
    margin-top: 6px;
    border-top: 1px solid var(--line);
  }
  .row[data-level='start'] .m {
    font-weight: 600;
  }
  .all .row {
    grid-template-columns: 72px 50px 128px minmax(0, 1fr);
  }
  .all .x:not(button) {
    grid-column: 4;
  }
  .n {
    overflow: hidden;
    padding: 0;
    border: 0;
    background: none;
    color: var(--kind, var(--ink));
    font: 600 12px/1.55 var(--mono);
    text-align: left;
    white-space: nowrap;
    text-overflow: ellipsis;
    cursor: pointer;
  }
  .n:hover {
    text-decoration: line-through;
  }
  header > select {
    align-self: center;
    padding: 3px 6px;
    border: 1px solid var(--line);
    border-radius: 8px;
    background: var(--surface);
    color: var(--ink);
    font: 500 13px var(--sans);
  }
  .left-out {
    position: relative;
    align-self: center;
  }
  .left-out summary {
    padding: 4px 10px;
    border-radius: 8px;
    color: var(--ink);
    font-weight: 600;
    list-style: none;
  }
  .left-out summary:hover,
  .left-out[open] summary {
    background: color-mix(in oklab, var(--ink) 10%, transparent);
  }
  .menu {
    position: absolute;
    z-index: 3;
    top: calc(100% + 4px);
    right: 0;
    display: grid;
    min-width: 160px;
    padding: 4px;
    border: 1px solid var(--line);
    border-radius: 8px;
    background: var(--surface);
    box-shadow: 0 6px 20px color-mix(in oklab, var(--ink) 16%, transparent);
  }
  .menu button {
    padding: 6px 10px;
    border: 0;
    border-radius: 6px;
    background: none;
    color: var(--ink);
    font: 500 13px var(--sans);
    text-align: left;
    cursor: pointer;
  }
  .menu button:hover {
    background: color-mix(in oklab, var(--ink) 8%, transparent);
  }
  .no-time .row {
    grid-template-columns: 0 58px minmax(0, 1fr);
  }
  .no-time .t {
    padding: 0;
  }
  .no-time .l {
    padding-left: 12px;
  }
</style>
