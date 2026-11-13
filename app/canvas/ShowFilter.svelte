<script lang="ts">
  // The kinds of card to see on Discover: a button saying the choice, and a checklist of the stack's categories behind
  // it, each queue type under Queues.
  import ChevronDown from '@lucide/svelte/icons/chevron-down';
  import { CATEGORIES, countsOf } from '../src/core/categories.ts';
  import Icon from './Icon.svelte';
  import { board } from './board.svelte.ts';
  import { hidden } from './shown.svelte.ts';

  const id = $props.id();
  let button = $state<HTMLButtonElement>();
  let list = $state<HTMLDivElement>();
  let open = $state(false);
  const TYPES: Record<string, string> = { kafka: 'Kafka', sqs: 'SQS', sns: 'SNS', eventbridge: 'EventBridge' };
  const counts = $derived(board.facts ? countsOf(board.facts) : {});
  /** The categories the stack has, and under Queues each queue type when there is more than one. */
  const rows = $derived(
    CATEGORIES.filter(one => counts[one.id]).flatMap(one => {
      const types = Object.keys(counts).filter(key => key.startsWith(`${one.id}:`));
      return [
        { id: one.id, name: one.many, sub: false },
        ...(types.length > 1
          ? types.map(type => ({ id: type, name: TYPES[type.slice(6)] ?? type.slice(6), sub: true }))
          : []),
      ];
    }),
  );
  const top = $derived(rows.filter(row => !row.sub));
  const shownTop = $derived(top.filter(row => !hidden.ids.includes(row.id)).length);
  const label = $derived(hidden.ids.length ? `${String(shownTop)} of ${String(top.length)}` : 'All');
  const place = () => {
    const at = button?.getBoundingClientRect();
    if (!at || !list) return;
    list.style.top = `${String(at.bottom + 4)}px`;
    list.style.left = `${String(Math.max(8, Math.min(at.right - 268, innerWidth - 268)))}px`;
    list.querySelector<HTMLInputElement>('input')?.focus();
  };
</script>

<button
  bind:this={button}
  class="show"
  class:narrows={hidden.ids.length > 0}
  type="button"
  aria-haspopup="dialog"
  aria-expanded={open}
  aria-label="Show: {label}"
  popovertarget={id}
>
  <span class="word">Show</span><span class="choice">{label}</span><Icon of={ChevronDown} size={12} />
</button>
<div
  bind:this={list}
  {id}
  class="list"
  popover
  role="dialog"
  aria-label="Kinds of card to see"
  tabindex="-1"
  ontoggle={ev => {
    open = ev.newState === 'open';
    if (open) place();
  }}
>
  <label class="row all">
    <input
      type="checkbox"
      checked={!hidden.ids.length}
      onchange={() => {
        hidden.set(hidden.ids.length ? [] : top.map(row => row.id));
      }}
    />
    <span class="name">Everything</span>
  </label>
  {#each rows as row (row.id)}
    <label class="row" class:sub={row.sub}>
      <input
        type="checkbox"
        checked={!hidden.ids.includes(row.id) && !(row.sub && hidden.ids.includes('queue'))}
        disabled={row.sub && hidden.ids.includes('queue')}
        onchange={() => {
          hidden.toggle(row.id);
        }}
      />
      <span class="name">{row.name}</span><span class="count">{counts[row.id]}</span>
    </label>
  {/each}
  <p class="note">Kept in this browser. Links through hidden cards are drawn dotted.</p>
</div>

<style>
  .show {
    display: inline-flex;
    align-items: center;
    gap: 6px;
    height: 28px;
    padding: 0 8px;
    border: 1px solid var(--line);
    background: var(--panel);
    color: var(--ink);
    font: 600 12.5px var(--sans);
    white-space: nowrap;
    cursor: pointer;
  }
  .show.narrows,
  .show:hover,
  .show[aria-expanded='true'] {
    border-color: var(--ink);
  }
  .show:focus-visible {
    outline: 2px solid var(--ink);
    outline-offset: 2px;
  }
  .word {
    color: var(--ink-muted);
    font-weight: 400;
    font-size: 11.5px;
  }
  .list {
    position: fixed;
    inset: auto;
    width: 260px;
    margin: 0;
    padding: 4px;
    border: 1px solid var(--line-strong);
    background: var(--surface);
    box-shadow: var(--lift);
  }
  .row {
    display: flex;
    align-items: center;
    gap: 8px;
    min-height: 32px;
    padding: 0 8px;
    color: var(--ink);
    font: 400 13px var(--sans);
    cursor: pointer;
  }
  .row.all {
    font-weight: 600;
  }
  .row.sub {
    min-height: 28px;
    padding-left: 30px;
    font-size: 12.5px;
  }
  .row:hover,
  .row:focus-within {
    background: color-mix(in oklab, var(--ink) 7%, transparent);
  }
  .name {
    flex: 1;
    min-width: 0;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }
  input {
    accent-color: var(--ink);
  }
  .count {
    color: var(--ink-muted);
    font: 400 11px var(--mono);
  }
  .note {
    margin: 4px 8px 6px;
    color: var(--ink-muted);
    font: 400 11.5px/1.4 var(--sans);
  }
</style>
