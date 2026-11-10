<script lang="ts">
  // One section of a card that folds to a line: a chevron, its name and, folded, what it holds in one line.
  import type { Snippet } from 'svelte';
  import ChevronDown from '@lucide/svelte/icons/chevron-down';
  import ChevronRight from '@lucide/svelte/icons/chevron-right';
  import Icon from './Icon.svelte';
  import { folds, type Section } from './folds.svelte.ts';

  const {
    card,
    section,
    name,
    summary,
    words = false,
    tag,
    children,
  }: {
    card: string;
    section: Section;
    name: string;
    summary: string;
    /** The summary is words, not values: sans, not mono. */
    words?: boolean;
    /** Stays on the line, folded or open. */
    tag?: Snippet;
    children: Snippet;
  } = $props();
  const open = $derived(folds.isOpen(card, section));
</script>

<section class="fold">
  <button
    class="line nodrag"
    type="button"
    aria-expanded={open}
    title={open ? `Fold ${name}` : summary}
    onclick={ev => {
      folds.toggle(card, section, ev.altKey);
    }}
    onkeydown={ev => {
      if (ev.key !== 'Enter' || !ev.altKey) return;
      ev.preventDefault();
      folds.toggle(card, section, true);
    }}
  >
    <span class="chev" aria-hidden="true"><Icon of={open ? ChevronDown : ChevronRight} size={14} /></span>
    <span class="name">{name}</span>
    <span class="sum" class:words>{open ? '' : summary}</span>
    {@render tag?.()}
  </button>
  {#if open}<div class="content">{@render children()}</div>{/if}
</section>

<style>
  .fold {
    border-top: 1px solid var(--line);
  }
  .line {
    display: flex;
    align-items: center;
    gap: 6px;
    width: 100%;
    height: 30px;
    padding: 0 10px 0 6px;
    border: 0;
    background: none;
    color: var(--ink);
    text-align: left;
    cursor: pointer;
  }
  .line:hover {
    background: var(--desk);
  }
  .line:focus-visible {
    outline: 2px solid var(--ink);
    outline-offset: -2px;
  }
  .chev {
    display: flex;
    flex: none;
    align-items: center;
    justify-content: center;
    width: 16px;
    height: 16px;
    color: var(--ink-muted);
  }
  .line:hover .chev {
    color: var(--ink);
  }
  .name {
    flex: none;
    color: var(--ink-muted);
    font: 12px var(--sans);
    white-space: nowrap;
  }
  .sum {
    flex: 1;
    min-width: 0;
    overflow: hidden;
    color: var(--ink);
    font: 11px var(--mono);
    white-space: nowrap;
    text-overflow: ellipsis;
  }
  .sum.words {
    font: 12px var(--sans);
  }
  .content {
    display: grid;
    gap: 8px;
    padding: 2px 12px 12px;
  }
</style>
