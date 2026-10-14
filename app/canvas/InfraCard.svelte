<script lang="ts" module>
  import type { Component, Snippet } from 'svelte';
  /** A button in the card's header: an icon with what it does. */
  export interface CardAction {
    label: string;
    title: string;
    icon: 'cog' | Component;
    run: () => void;
  }
</script>

<script lang="ts">
  // The card of everything on the board that is not an app: a tunnel, a queue, an outside system. One frame, one
  // header (state, name, a detail, its buttons), and a second row for what is particular to it.
  import Cog from './Cog.svelte';
  import Icon from './Icon.svelte';
  import { board } from './board.svelte.ts';

  const {
    id,
    kind,
    name,
    detail = '',
    detailWarn = false,
    dot,
    dotTitle = '',
    hasDot = false,
    title = '',
    selected = false,
    active = false,
    actions,
    flag,
    children,
  }: {
    id: string;
    kind: 'tunnel' | 'queue' | 'outside';
    name: string;
    detail?: string;
    detailWarn?: boolean;
    /** Whether it answers, for a card that shows it (`hasDot`): true, false, or not known yet. */
    dot?: boolean | null | undefined;
    hasDot?: boolean;
    dotTitle?: string;
    title?: string;
    selected?: boolean;
    /** Switched to run locally: marked by its edge. */
    active?: boolean;
    actions: CardAction[];
    /** Something to notice, shown before the detail. */
    flag?: Snippet;
    children?: Snippet;
  } = $props();
</script>

<div class="infra {kind}" class:active class:selected class:dimmed={board.dimmed(id)} {title}>
  <span class="head">
    {#if hasDot}<span class="dot" data-on={dot ?? null} title={dotTitle}></span>{/if}
    <span class="name">{name}</span>
    {#if flag || detail}<span class="detail" class:warn={detailWarn}>{@render flag?.()}{detail}</span>{/if}
    <span class="acts">
      {#each actions as action (action.label)}
        <button
          class="nodrag"
          type="button"
          aria-label={action.label}
          title={action.title}
          onclick={() => {
            action.run();
          }}
        >
          {#if action.icon === 'cog'}<Cog size={13} />{:else}<Icon of={action.icon} size={13} />{/if}
        </button>
      {/each}
    </span>
  </span>
  {#if children}<div class="body" class:under-dot={hasDot}>{@render children()}</div>{/if}
</div>

<style>
  .infra {
    display: grid;
    row-gap: 6px;
    width: max-content;
    min-width: 200px;
    max-width: 420px;
    padding: 9px 8px 11px 12px;
    border: 1px solid color-mix(in oklab, var(--muted) 45%, var(--line));
    border-radius: 10px;
    background: var(--surface);
    color: var(--ink);
    font: 12.5px/1.4 var(--sans);
    user-select: none;
    cursor: grab;
  }
  .infra.active {
    border-color: var(--msg);
    box-shadow: 0 0 0 1px var(--msg);
  }
  .infra.selected,
  :global(.svelte-flow__node:focus-visible) .infra {
    outline: 2px solid var(--cable);
    /* On the border itself: one frame, not a ring around a frame. */
    outline-offset: -1px;
  }
  .head {
    display: flex;
    align-items: center;
    gap: 8px;
    min-height: 24px;
  }
  .dot {
    flex: none;
    width: 8px;
    height: 8px;
    border-radius: 50%;
    background: var(--line);
  }
  .dot[data-on='true'] {
    background: var(--ok);
  }
  .dot[data-on='false'] {
    background: var(--bad);
  }
  .name {
    font-weight: 600;
    white-space: nowrap;
  }
  .detail {
    display: inline-flex;
    align-items: center;
    gap: 6px;
    font: 12px var(--mono);
    color: var(--muted);
    white-space: nowrap;
  }
  .detail.warn {
    color: var(--warn);
  }
  .acts {
    display: flex;
    gap: 2px;
    margin-left: auto;
    padding-left: 4px;
  }
  .acts button {
    display: grid;
    place-items: center;
    width: 24px;
    height: 24px;
    padding: 0;
    border: 0;
    border-radius: 5px;
    background: none;
    color: var(--muted);
    cursor: pointer;
  }
  .acts button:hover {
    background: color-mix(in oklab, var(--ink) 9%, transparent);
    color: var(--ink);
  }
  .acts button:focus-visible {
    outline: 2px solid var(--cable);
    outline-offset: 1px;
  }
  .body {
    min-width: 0;
    font: 12px var(--mono);
    color: var(--muted);
    overflow-wrap: anywhere;
  }
  /* Lined up with the name, not the state dot before it. */
  .body.under-dot {
    padding-left: 16px;
  }
</style>
