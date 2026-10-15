<script lang="ts">
  import Icon from './Icon.svelte';
  import X from '@lucide/svelte/icons/x';
  // What is worth knowing about the board before it runs: tunnels the plan moved, and apps on the board that are
  // still called in the deployed environment. Each note is dismissed for this board.
  import { describePlan } from '../src/core/ports.ts';
  import { board } from './board.svelte.ts';

  interface Note {
    key: string;
    text: string;
    /** The cable that would put it right. */
    cable?: { from: string; to: string };
  }
  const name = board.nameOf;
  const ports = $derived(
    describePlan(board.plan, name)
      .filter(line => !line.includes(' share one '))
      .map((text): Note => ({ key: `ports:${text}`, text })),
  );
  const unwired = $derived(
    board.cards.flatMap(({ id }) =>
      board
        .deployedCalls(id)
        .filter(to => board.cards.some(node => node.id === to.id))
        .map((to): Note => ({
          key: `unwired:${id}>${to.id}`,
          text: `${to.name} is on your board, but ${name(id)} still calls the ${board.env.toUpperCase()} one.`,
          cable: { from: id, to: to.id },
        })),
    ),
  );
  const notes = $derived([...ports, ...unwired].filter(note => !board.dismissed.includes(note.key)));
</script>

{#if notes.length && !board.live}
  <div class="notes" role="group" aria-label="About this board">
    {#each notes as note (note.key)}
      {@const cable = note.cable}
      <div class="note" role="note">
        <span>{note.text}</span>
        <button
          class="x"
          type="button"
          aria-label="Dismiss this note"
          onclick={() => {
            board.dismissed = [...board.dismissed, note.key];
          }}><Icon of={X} size={14} /></button
        >
        {#if cable}
          <button
            class="do"
            type="button"
            onclick={() => {
              board.connect(cable.from, cable.to);
            }}>Connect</button
          >
        {/if}
      </div>
    {/each}
  </div>
{/if}

<style>
  .notes {
    display: grid;
    gap: 6px;
    margin-top: 12px;
  }
  .note {
    display: grid;
    grid-template-columns: minmax(0, 1fr) auto;
    align-items: start;
    gap: 8px 10px;
    padding: 8px 8px 8px 10px;
    border: 1px solid var(--line);
    border-radius: 8px;
    background: var(--surface);
    color: var(--ink);
    font: 12.5px/1.45 var(--sans);
  }
  .x {
    grid-area: 1 / 2;
    display: grid;
    place-items: center;
    width: 20px;
    height: 20px;
    padding: 0;
    border: 0;
    border-radius: 5px;
    background: none;
    color: var(--muted);
    font-size: 15px;
    line-height: 1;
    cursor: pointer;
  }
  .x:hover {
    background: color-mix(in oklab, var(--ink) 10%, transparent);
    color: var(--ink);
  }
  .do {
    grid-row: 2;
    justify-self: start;
    padding: 4px 10px;
    border: 0;
    border-radius: 6px;
    background: var(--cable);
    color: var(--on-accent);
    font: 600 12px var(--sans);
    cursor: pointer;
  }
</style>
