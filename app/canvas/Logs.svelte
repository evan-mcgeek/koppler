<script lang="ts">
  import { parseLog } from '../src/core/logfmt.ts';
  import { board } from './board.svelte.ts';
  import { live } from './live.svelte.ts';
  import { logs } from './logs.svelte.ts';

  const LABEL: Record<string, string> = {
    debug: 'DEBUG',
    warn: 'WARN',
    error: 'ERROR',
    koppler: 'KOPPLER',
    start: 'START',
  };
  const name = (id: string) => board.apps.find(app => app.id === id)?.name ?? id;
  const active = $derived(logs.active);
  const text = $derived(active ? logs.text(active) : '');
  const rows = $derived(logs.raw ? [] : parseLog(text));
  let body: HTMLElement | undefined = $state();
  let shown: string | null = null;
  // The open tab is read again as the status comes in.
  $effect(() => {
    if (live.status) logs.refresh();
  });
  // Stays at the newest line unless scrolled up; a tab just opened starts at its end.
  $effect.pre(() => {
    if (!body) return;
    // Read on every new text, so the pane follows it.
    const pinned = shown !== active || !text || body.scrollHeight - body.scrollTop - body.clientHeight < 24;
    shown = active;
    const pane = body;
    if (pinned)
      requestAnimationFrame(() => {
        pane.scrollTop = pane.scrollHeight;
      });
  });
</script>

{#if active}
  <section class="logs" aria-label="App log">
    <header>
      <div class="tabs" role="tablist">
        {#each logs.tabs as id (id)}
          {@const up = live.up(id)}
          <span class="tab" class:on={id === active}>
            <button
              type="button"
              role="tab"
              aria-selected={id === active}
              onclick={() => {
                logs.active = id;
              }}
            >
              <span class="live" data-on={up} aria-hidden="true"></span>{name(id)}
            </button>
            <button
              class="x"
              type="button"
              aria-label="Close {name(id)} log"
              onclick={() => {
                logs.close(id);
              }}>×</button
            >
          </span>
        {/each}
      </div>
      <span class="meta">{live.tail(active) ? '' : 'no log yet'}</span>
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
      <button
        type="button"
        onclick={() => {
          logs.closeAll();
        }}>Close all</button
      >
    </header>
    <div class="body" class:raw={logs.raw} class:no-time={!rows.some(row => row.time)} role="log" bind:this={body}>
      {#if !text}
        <p class="empty">
          {logs.cleared[active]
            ? 'Cleared. New lines show up here.'
            : 'No output captured for this app. Apps started from an IDE keep their output there.'}
        </p>
      {:else if logs.raw}
        {text}
      {:else}
        {#each rows as row, at (at)}
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
    border-top: 1px solid var(--line);
    background: var(--surface);
    color: var(--ink);
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
    padding: 2px 14px 2px 0;
    border-left: 2px solid transparent;
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
    border-left-color: var(--warn);
    background: color-mix(in oklab, var(--warn) 6%, transparent);
  }
  .row[data-level='warn'] .l {
    color: var(--warn);
  }
  .row[data-level='error'] {
    border-left-color: var(--bad);
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
