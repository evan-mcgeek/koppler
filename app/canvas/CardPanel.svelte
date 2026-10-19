<script lang="ts">
  // Zoomed out, cards show only a summary: the one picked has its choices here, beside the board.
  import X from '@lucide/svelte/icons/x';
  import CardFields from './CardFields.svelte';
  import Icon from './Icon.svelte';
  import { board, CARD_PANEL } from './board.svelte.ts';

  const card = $derived(board.panelCard);
</script>

{#if card}
  <aside class="kind-{card.data.kind}" style:width="{CARD_PANEL}px" aria-labelledby="card-panel-title">
    <header>
      <h2 id="card-panel-title" title={card.data.name}>{card.data.name}</h2>
      <span class="kind">{card.data.kindLabel}</span>
      <button
        class="x"
        type="button"
        aria-label="Close"
        title="Close: deselects the card"
        onclick={() => {
          board.pick('');
        }}><Icon of={X} size={14} /></button
      >
    </header>
    {#key card.id}<CardFields id={card.id} />{/key}
  </aside>
{/if}

<style>
  aside {
    flex-shrink: 0;
    overflow: hidden auto;
    scrollbar-width: thin;
    border-left: 1px solid var(--line);
    background: var(--panel);
  }
  header {
    display: flex;
    align-items: center;
    gap: 8px;
    padding: 12px 10px 4px 16px;
  }
  h2 {
    min-width: 0;
    margin: 0;
    overflow: hidden;
    font-size: 15px;
    font-weight: 700;
    text-overflow: ellipsis;
    white-space: nowrap;
  }
  .kind {
    flex: none;
    padding: 1px 7px;
    border-radius: 999px;
    font: 600 12px/1.5 var(--sans);
    white-space: nowrap;
    color: var(--kind);
    background: color-mix(in oklab, var(--kind) 14%, transparent);
  }
  .x {
    display: grid;
    flex: none;
    place-items: center;
    width: 28px;
    height: 28px;
    margin-left: auto;
    border: 0;
    border-radius: 7px;
    background: none;
    color: var(--muted);
    cursor: pointer;
  }
  .x:hover {
    background: color-mix(in oklab, var(--ink) 7%, transparent);
    color: var(--ink);
  }
  .x:focus-visible {
    outline: 2px solid var(--ink);
    outline-offset: 1px;
  }
</style>
