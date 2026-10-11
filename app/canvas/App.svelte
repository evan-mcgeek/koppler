<script lang="ts">
  import { SvelteFlowProvider } from '@xyflow/svelte';
  import Board from './Board.svelte';
  import { board } from './board.svelte.ts';
  import { load } from './data.ts';

  /** Asked for once, when the page opens. ponytail: no polling yet; it comes with the live state of the cards. */
  const opened = load().then(loaded => {
    if (loaded) board.open(loaded);
    return !!loaded;
  });
</script>

<header>
  <span class="title">Koppler</span>
  {#if board.stack}
    <span class="stack">{board.stack}</span>
    <span class="env" class:prod={board.env === 'prod'}>{board.env.toUpperCase()}</span>
  {/if}
</header>
<main>
  {#await opened then found}
    {#if found}
      <SvelteFlowProvider>
        <Board />
      </SvelteFlowProvider>
    {:else}
      <p class="empty">No stack yet. Run <code>koppler init</code>, then open the canvas again.</p>
    {/if}
  {/await}
</main>

<style>
  header {
    display: flex;
    align-items: center;
    gap: 12px;
    min-height: 53px;
    padding: 10px 16px;
    border-bottom: 1px solid var(--line);
    background: var(--panel);
    color: var(--ink);
  }
  .title {
    font-weight: 700;
    font-size: 17px;
    letter-spacing: -0.01em;
  }
  .stack {
    font-weight: 600;
    font-size: 14px;
  }
  .stack::before {
    content: '/';
    margin-right: 12px;
    color: var(--muted);
    font-weight: 400;
  }
  .env {
    padding: 1px 8px;
    border-radius: 999px;
    background: color-mix(in oklab, var(--ink) 8%, transparent);
    color: var(--muted);
    font: 600 12px/1.5 var(--sans);
  }
  .env.prod {
    background: color-mix(in oklab, var(--prod) 14%, transparent);
    color: var(--prod);
  }
  main {
    position: relative;
    flex: 1;
    min-height: 0;
  }
  .empty {
    margin: 0;
    padding: 24px 16px;
    color: var(--muted);
    font-size: 14px;
  }
  code {
    font: 13px var(--mono);
  }
</style>
