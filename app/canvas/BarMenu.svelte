<script lang="ts">
  // A menu in the top bar: its button shows an icon and a word, and the word drops when the bar is short of room.
  import ChevronDown from '@lucide/svelte/icons/chevron-down';
  import type { Snippet } from 'svelte';
  import Icon from './Icon.svelte';

  export interface BarItem {
    label: string;
    /** Run with the menu's button, for what opens under it. */
    run: (from: HTMLElement) => void;
    /** The key that does the same, shown beside it. */
    key?: string;
    about?: string;
    off?: boolean;
  }
  const {
    label,
    items,
    children,
    name,
    title,
    chevron = true,
  }: {
    label: string;
    items: BarItem[];
    children: Snippet;
    /** A class on the button, for which word drops first. */
    name?: string;
    title?: string;
    chevron?: boolean;
  } = $props();
  const id = $props.id();
  let button = $state<HTMLButtonElement>();
  let list = $state<HTMLDivElement>();
  let open = $state(false);
  const options = () => [...(list?.querySelectorAll<HTMLButtonElement>('button:not(:disabled)') ?? [])];
  // Under its button, their right edges lined up.
  const place = () => {
    const at = button?.getBoundingClientRect();
    if (!at || !list) return;
    list.style.top = `${String(at.bottom + 6)}px`;
    list.style.right = `${String(Math.max(12, innerWidth - at.right))}px`;
    options()[0]?.focus();
  };
  const step = (ev: KeyboardEvent) => {
    if (ev.key !== 'ArrowDown' && ev.key !== 'ArrowUp') return;
    ev.preventDefault();
    const all = options();
    const at = all.indexOf(document.activeElement as HTMLButtonElement);
    all[(at + (ev.key === 'ArrowDown' ? 1 : -1) + all.length) % all.length]?.focus();
  };
</script>

<button
  bind:this={button}
  class="bar-menu {name ?? ''}"
  type="button"
  aria-label={label}
  {title}
  aria-haspopup="menu"
  aria-expanded={open}
  popovertarget={id}
>
  {@render children()}
  {#if chevron}<span class="chev"><Icon of={ChevronDown} size={12} /></span>{/if}
</button>
<div
  bind:this={list}
  {id}
  class="bar-list"
  popover
  role="menu"
  tabindex="-1"
  aria-label={label}
  onkeydown={step}
  ontoggle={ev => {
    open = ev.newState === 'open';
    if (open) place();
  }}
>
  {#each items as item (item.label)}
    <button
      type="button"
      role="menuitem"
      title={item.about}
      disabled={item.off}
      onclick={() => {
        list?.hidePopover();
        if (button) item.run(button);
      }}
    >
      <span>{item.label}</span>
      {#if item.key}<kbd>{item.key}</kbd>{/if}
    </button>
  {/each}
</div>

<style>
  .bar-menu {
    display: inline-flex;
    align-items: center;
    gap: 7px;
    height: 32px;
    padding: 0 11px;
    border: 1px solid var(--line-strong);
    background: none;
    color: var(--ink);
    font: 600 13px var(--sans);
    white-space: nowrap;
    cursor: pointer;
  }
  .chev {
    display: inline-flex;
  }
  .bar-menu:hover,
  .bar-menu[aria-expanded='true'] {
    border-color: var(--ink);
  }
  .bar-menu:focus-visible {
    outline: 2px solid var(--ink);
    outline-offset: 2px;
  }
  .bar-list {
    position: fixed;
    inset: auto;
    min-width: 220px;
    margin: 0;
    padding: 0;
    border: 1px solid var(--line-strong);
    background: var(--panel);
    color: var(--ink);
  }
  .bar-list button {
    display: flex;
    align-items: center;
    width: 100%;
    padding: 10px 12px;
    border: 0;
    border-bottom: 1px solid var(--line);
    background: none;
    color: var(--ink);
    font: 400 13px var(--sans);
    text-align: left;
    cursor: pointer;
  }
  .bar-list button:last-child {
    border-bottom: 0;
  }
  .bar-list button span {
    flex: 1;
  }
  .bar-list button:hover,
  .bar-list button:focus-visible {
    background: var(--desk);
    outline: none;
  }
  .bar-list button:disabled {
    color: var(--ink-muted);
    cursor: default;
  }
  kbd {
    color: var(--ink-muted);
    font: 400 11px var(--mono);
  }
</style>
