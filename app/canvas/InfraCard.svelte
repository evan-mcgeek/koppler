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
  // The card of a tunnel, database, queue or outside system, framed like an app card: header, body, and a status line with one action.
  import CardNote from './CardNote.svelte';
  import Cog from './Cog.svelte';
  import Icon from './Icon.svelte';
  import { board } from './board.svelte.ts';

  const {
    id,
    kind,
    name,
    tag,
    dot,
    dotTitle = '',
    hasDot = false,
    status = '',
    act,
    title = '',
    selected = false,
    actions,
    flag,
    band,
    foot,
    variant = '',
    children,
  }: {
    id: string;
    kind: 'tunnel' | 'queue' | 'outside' | 'database';
    name: string;
    /** What it is, as a code: Tunnel, SQS, Outside. */
    tag: string;
    /** Whether it answers, for a card that shows it (`hasDot`): true, false, or not known yet. */
    dot?: boolean | null | undefined;
    hasDot?: boolean;
    dotTitle?: string;
    /** Its state in words, at its foot. */
    status?: string;
    /** The one action at its foot, as a word. */
    act?: (CardAction & { word: string }) | undefined;
    title?: string;
    selected?: boolean;
    actions: CardAction[];
    /** Something to notice, shown beside the name. */
    flag?: Snippet;
    /** A band above the header, such as PROD's. */
    band?: Snippet;
    /** The foot in place of the status line. */
    foot?: Snippet;
    /** More classes for the frame: local, prod. */
    variant?: string;
    children?: Snippet;
  } = $props();
  const note = $derived(board.cardNotes[id] ?? '');
  let noting = $state(false);
</script>

<div class="infra {kind} {variant}" class:selected class:dimmed={board.dimmed(id)} {title}>
  {@render band?.()}
  <span class="head">
    {#if hasDot}<span class="led" data-state={dot ? 'running' : dot === false ? 'failed' : undefined} title={dotTitle}
      ></span>{/if}
    <span class="name">{name}</span>
    {@render flag?.()}
    <span class="tag">{tag}</span>
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
          {#if action.icon === 'cog'}<Cog size={16} />{:else}<Icon of={action.icon} size={16} />{/if}
        </button>
      {/each}
    </span>
  </span>
  {#if children}<div class="body">{@render children()}</div>{/if}
  <!-- A written note reads as text above the foot; the run hands it to the agent. -->
  {#if note || noting}<div class="noted">
      <CardNote
        card
        reading={board.live}
        editing={noting}
        onediting={(open: boolean) => (noting = open)}
        value={note}
        placeholder="e.g. purge it before the run"
        onchange={(text: string) => {
          board.noteCard(id, text);
        }}
      />
    </div>{/if}
  {#if foot || status || (!board.live && !note)}
    <div class="foot" class:stack={!!foot} class:bare={!foot && !status}>
      {#if foot}{@render foot()}
      {:else if status}<span>{status}</span>
        {#if act}<button
            class="link nodrag"
            type="button"
            aria-label={act.label}
            title={act.title}
            onclick={() => {
              act.run();
            }}>{act.word}</button
          >{/if}
      {/if}
      {#if !board.live && !note && !noting}<button
          class="link add-note nodrag"
          type="button"
          onclick={() => (noting = true)}>Add note</button
        >{/if}
    </div>
  {/if}
</div>

<style>
  .infra {
    display: grid;
    /* One column as wide as the card, so a long name is cut instead of widening what is inside. */
    grid-template-columns: minmax(0, 1fr);
    width: max-content;
    min-width: 240px;
    max-width: 420px;
    border: 1px solid var(--line-strong);
    background: var(--panel);
    color: var(--ink);
    font: 400 12px/1.4 var(--sans);
    user-select: none;
    cursor: grab;
  }
  /* A system that never runs here has a dashed edge, in the deployed colour. */
  .infra.outside {
    border: 1px dashed var(--deployed);
    background: var(--desk);
  }
  /* Deployed data has a dashed edge in the deployed colour; one on this Mac a solid one. PROD's is red. */
  .infra.tunnel,
  .infra.database {
    border: 1px dashed var(--deployed);
  }
  .infra.database {
    width: 270px;
    min-width: 0;
  }
  .infra.database.local {
    border: 1px solid var(--line-strong);
  }
  .infra.database.prod {
    border: 2px solid var(--prod);
  }
  .infra.selected,
  :global(.svelte-flow__node:focus-visible) .infra {
    outline: 2px solid var(--ink);
    /* On the border itself: one frame, not a ring around a frame. */
    outline-offset: -1px;
  }
  .head {
    display: flex;
    align-items: center;
    gap: 8px;
    min-height: 40px;
    padding: 4px 4px 4px 12px;
    border-bottom: 1px solid var(--line);
  }
  /* A long name is cut short: the tag and the buttons stay on the card. The card's title holds it whole. */
  .name {
    min-width: 0;
    overflow: hidden;
    font: 600 15px var(--sans);
    text-overflow: ellipsis;
    white-space: nowrap;
  }
  .tag {
    margin-left: auto;
    padding: 2px 5px;
    border: 1px solid var(--line-strong);
    color: var(--ink-muted);
    font: 500 10px/1.3 var(--mono);
    letter-spacing: 0.04em;
    text-transform: uppercase;
    white-space: nowrap;
  }
  .acts {
    display: flex;
  }
  .acts button {
    display: grid;
    place-items: center;
    width: 32px;
    height: 32px;
    padding: 0;
    border: 0;
    background: none;
    color: var(--ink);
    cursor: pointer;
  }
  .acts button:hover {
    background: color-mix(in oklab, var(--ink) 9%, transparent);
  }
  .body {
    display: grid;
    gap: 6px;
    min-width: 0;
    padding: 10px 12px 12px;
    overflow-wrap: anywhere;
  }
  /* A note wraps inside the card's width: it never widens the card. */
  .noted {
    display: grid;
    padding: 0 12px 10px;
    contain: inline-size;
  }
  /* Offered only while the card is picked or has the keyboard: most of these cards never get a note. */
  /* Kept in its place while hidden, so picking the card moves nothing in its foot. */
  .add-note {
    margin-left: auto;
    color: var(--ink);
    visibility: hidden;
  }
  .infra.selected .add-note,
  .infra:focus-within .add-note,
  :global(.svelte-flow__node:focus-visible) .add-note {
    visibility: visible;
  }
  .foot.bare {
    display: none;
  }
  .infra.selected .foot.bare,
  .infra:focus-within .foot.bare,
  :global(.svelte-flow__node:focus-visible) .foot.bare {
    display: flex;
  }
  .foot {
    display: flex;
    justify-content: space-between;
    gap: 12px;
    margin: 0;
    padding: 8px 12px;
    border-top: 1px solid var(--line);
  }
  .foot.stack {
    display: grid;
    gap: 3px;
  }
  .foot.stack .add-note {
    justify-self: end;
  }
</style>
