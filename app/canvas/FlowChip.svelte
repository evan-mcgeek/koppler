<script lang="ts">
  // On a run board planned from a feature board: the flow it came from, and the way back to it in Discover.
  import { board } from './board.svelte.ts';
  import { openFlow } from './boards.ts';
  import { discovered } from './discover.svelte.ts';

  const flow = $derived(board.boardNamed(board.flow ?? undefined));
</script>

{#if board.flow}
  <div class="flow-chip" role="note" aria-label="Flow">
    <span class="label">Flow</span><span class="name">{board.flow}</span>
    {#if flow?.['feature']}
      <button
        type="button"
        title="Its feature board in Discover, with this board's apps picked"
        onclick={() => {
          const apps = board.nodes.map(node => node.id);
          openFlow(flow);
          discovered.picked = apps;
        }}>Open in Discover</button
      >
    {:else}
      <span class="gone">No longer a feature board here</span>
    {/if}
  </div>
{/if}

<style>
  /* Under the cards' tool bars: a card moved up here keeps its actions within reach. */
  .flow-chip {
    position: absolute;
    top: 14px;
    left: 16px;
    z-index: 1;
    display: flex;
    align-items: center;
    gap: 10px;
    padding: 7px 10px;
    border: 1px solid var(--line-strong);
    background: var(--panel);
    color: var(--ink);
  }
  .label,
  .gone {
    color: var(--muted);
    font: 400 12px var(--sans);
  }
  .name {
    font: 600 13px var(--sans);
  }
  button {
    padding: 0;
    border: 0;
    background: none;
    color: var(--ink);
    font: 400 12px var(--sans);
    white-space: nowrap;
    text-decoration: underline;
    text-underline-offset: 3px;
    cursor: pointer;
  }
  button:focus-visible {
    outline: 2px solid var(--ink);
    outline-offset: 2px;
  }
</style>
