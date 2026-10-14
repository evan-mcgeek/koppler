<script lang="ts">
  import TriangleAlert from '@lucide/svelte/icons/triangle-alert';
  import Icon from './Icon.svelte';
  import ListChecks from '@lucide/svelte/icons/list-checks';
  import PanelTop from '@lucide/svelte/icons/panel-top';
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
    <Icon of={PanelTop} size={16} />
    <span class="env">{board.env.toUpperCase()}</span>
  </button>
  <button
    type="button"
    title="Apps: on the board, and the rest of the stack"
    aria-label="Apps: {board.cards.length} of {board.apps.length} on the board"
    onclick={() => {
      open();
    }}
  >
    <Icon of={ListChecks} size={16} />
    <span>{board.cards.length}/{board.apps.length}</span>
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
        }}><Icon of={TriangleAlert} size={15} /></button
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
    display: grid;
    place-items: center;
    width: 24px;
    height: 24px;
    padding: 0;
    border: 0;
    border-radius: 50%;
    background: var(--warn);
    color: var(--on-accent);
    cursor: pointer;
  }
</style>
