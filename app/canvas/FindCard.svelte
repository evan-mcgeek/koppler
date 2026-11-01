<script lang="ts">
  // Find a card by name among everything the stack knows; one not on the map yet is brought onto it.
  import type { Card } from '../src/core/discover.ts';
  import { board } from './board.svelte.ts';
  import { discovered } from './discover.svelte.ts';

  const { open, onpick, onclose }: { open: boolean; onpick: (card: Card) => void; onclose: () => void } = $props();
  let dialog = $state<HTMLDialogElement>();
  let query = $state('');
  let at = $state(0);

  $effect(() => {
    if (!open || !dialog || dialog.open) return;
    query = '';
    at = 0;
    dialog.showModal();
  });
  const all = $derived.by((): Card[] => {
    const facts = board.facts;
    if (!facts) return [];
    return [
      ...Object.keys(facts.apps),
      ...Object.keys(facts.queues ?? {}).map(id => `queue:${id}`),
      ...Object.keys(facts.databases ?? {}).map(id => `database:${id}`),
      ...Object.keys(facts.resources ?? {}).map(id => `resource:${id}`),
    ];
  });
  const shown = $derived(new Set(discovered.map.cards.map(one => one.card)));
  // Names that start with what was typed come first, then those on the map.
  const found = $derived.by(() => {
    const words = query.trim().toLowerCase();
    if (!words) return [];
    return all
      .map(card => ({ card, ...discovered.data(card, false, 0), on: shown.has(card) }))
      .filter(one => one.name.toLowerCase().includes(words))
      .sort(
        (a, b) =>
          Number(b.name.toLowerCase().startsWith(words)) - Number(a.name.toLowerCase().startsWith(words)) ||
          Number(b.on) - Number(a.on) ||
          a.name.localeCompare(b.name),
      )
      .slice(0, 8);
  });
  const pick = (card: Card | undefined) => {
    if (!card) return;
    dialog?.close();
    onpick(card);
  };
</script>

<dialog bind:this={dialog} aria-label="Find a card" {onclose}>
  <input
    type="search"
    aria-label="Find a card"
    placeholder="Find a card by name"
    autocomplete="off"
    spellcheck="false"
    bind:value={query}
    oninput={() => {
      at = 0;
    }}
    onkeydown={ev => {
      if (ev.key === 'ArrowDown' || ev.key === 'ArrowUp') {
        ev.preventDefault();
        at = (at + (ev.key === 'ArrowDown' ? 1 : found.length - 1)) % Math.max(found.length, 1);
      } else if (ev.key === 'Escape') {
        // A search field would only clear itself.
        ev.preventDefault();
        dialog?.close();
      } else if (ev.key === 'Enter') {
        ev.preventDefault();
        pick(found[at]?.card);
      }
    }}
  />
  {#if found.length}
    <ul role="listbox" aria-label="Cards found">
      {#each found as one, index (one.card)}
        <li role="option" aria-selected={index === at}>
          <button
            type="button"
            tabindex="-1"
            onpointermove={() => {
              at = index;
            }}
            onclick={() => {
              pick(one.card);
            }}
          >
            <span class="name">{one.name}</span>
            {#if one.tag}<span class="tag">{one.tag}</span>{/if}
            <span class="where">{one.on ? 'On the map' : 'Show'}</span>
          </button>
        </li>
      {/each}
    </ul>
  {:else if query.trim()}
    <p class="none">No card is called that</p>
  {/if}
</dialog>

<style>
  dialog {
    width: min(440px, calc(100vw - 32px));
    margin-top: 96px;
    padding: 0;
    border: 1px solid var(--ink);
    background: var(--panel);
    color: var(--ink);
  }
  dialog::backdrop {
    background: color-mix(in oklab, var(--desk) 50%, transparent);
  }
  input {
    box-sizing: border-box;
    width: 100%;
    padding: 12px 14px;
    border: 0;
    border-bottom: 1px solid var(--line);
    background: none;
    color: var(--ink);
    font: 400 15px var(--sans);
    outline: none;
  }
  input::-webkit-search-cancel-button {
    appearance: none;
  }
  ul {
    margin: 0;
    padding: 4px 0;
    list-style: none;
  }
  button {
    display: flex;
    align-items: center;
    gap: 10px;
    width: 100%;
    padding: 8px 14px;
    border: 0;
    background: none;
    color: var(--ink);
    font: 400 14px var(--sans);
    text-align: left;
    cursor: pointer;
  }
  [aria-selected='true'] button {
    background: color-mix(in oklab, var(--cable) 12%, transparent);
  }
  .name {
    flex: 1;
    min-width: 0;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }
  .tag {
    padding: 1px 5px;
    border: 1px solid var(--line-strong);
    color: var(--ink-muted);
    font: 400 10px var(--mono);
  }
  .where {
    color: var(--ink-muted);
    font-size: 12px;
  }
  .none {
    margin: 0;
    padding: 12px 14px;
    color: var(--ink-muted);
    font: 400 13px var(--sans);
  }
</style>
