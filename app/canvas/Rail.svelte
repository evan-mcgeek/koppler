<script lang="ts">
  // What is left of the side pane when it is folded: where the board stands, and the way back in.
  import Settings from './Settings.svelte';
  import { board } from './board.svelte.ts';
  import { live } from './live.svelte.ts';

  const { open }: { open: (at?: 'board') => void } = $props();
  const needs = $derived((live.status?.checks ?? []).some(check => check.state !== 'ok'));
</script>

<nav aria-label="Side pane, folded" class:protected={board.protected}>
  <button
    type="button"
    title="Board and environment"
    aria-label="Board and environment: {board.env.toUpperCase()}"
    onclick={() => {
      open('board');
    }}
  >
    <svg viewBox="0 0 16 16" width="16" height="16" aria-hidden="true">
      <rect x="2" y="2.5" width="12" height="11" rx="2" /><path d="M2 6h12" />
    </svg>
    <span class="env">{board.env.toUpperCase()}</span>
  </button>
  <button
    type="button"
    title="Apps: on the board, and the rest of the stack"
    aria-label="Apps: {board.nodes.length} of {board.apps.length} on the board"
    onclick={() => {
      open();
    }}
  >
    <svg viewBox="0 0 16 16" width="16" height="16" aria-hidden="true">
      <path d="M2.5 4.5l1.2 1.2 2-2.2M2.5 9.5l1.2 1.2 2-2.2M8.5 4.8h5M8.5 9.8h5" /><path d="M3 13.5h10" opacity=".5" />
    </svg>
    <span>{board.nodes.length}/{board.apps.length}</span>
  </button>
  <div class="foot">
    {#if needs}
      <button
        class="needs"
        type="button"
        title="This stack needs something on this Mac"
        aria-label="This stack needs something on this Mac"
        onclick={() => {
          open();
        }}>!</button
      >
    {/if}
    <Settings />
  </div>
</nav>

<style>
  nav {
    display: flex;
    flex-direction: column;
    flex-shrink: 0;
    align-items: center;
    gap: 4px;
    width: 52px;
    padding: 10px 0 14px;
    border-right: 1px solid var(--line);
    background: var(--panel);
  }
  nav > button {
    display: grid;
    justify-items: center;
    gap: 2px;
    width: 40px;
    padding: 7px 0 6px;
    border: 0;
    border-radius: 8px;
    background: none;
    color: var(--muted);
    cursor: pointer;
  }
  nav > button:hover {
    background: color-mix(in oklab, var(--ink) 8%, transparent);
    color: var(--ink);
  }
  svg {
    fill: none;
    stroke: currentColor;
    stroke-width: 1.4;
    stroke-linecap: round;
    stroke-linejoin: round;
  }
  span {
    color: var(--ink);
    font: 600 12px/1 var(--sans);
  }
  .protected .env {
    color: var(--prod);
  }
  .foot {
    display: grid;
    justify-items: center;
    gap: 8px;
    margin-top: auto;
  }
  .needs {
    width: 24px;
    height: 24px;
    padding: 0;
    border: 0;
    border-radius: 50%;
    background: var(--warn);
    color: var(--on-accent);
    font: 700 13px var(--sans);
    cursor: pointer;
  }
</style>
