<script lang="ts">
  import { SvelteFlowProvider } from '@xyflow/svelte';
  import { untrack } from 'svelte';
  import Board from './Board.svelte';
  import Help from './Help.svelte';
  import Side from './Side.svelte';
  import Toast from './Toast.svelte';
  import { board } from './board.svelte.ts';
  import { load, save } from './data.ts';

  /** Asked for once, when the page opens. ponytail: no polling yet; it comes with the live state of the cards. */
  const opened = load().then(loaded => {
    if (loaded) board.open(loaded);
    return !!loaded;
  });

  // Every change is kept: sent once the board has been still for a moment, and again as the page is left.
  let sent = '';
  let waiting: ReturnType<typeof setTimeout> | undefined;
  const keep = (leaving = false) => {
    clearTimeout(waiting);
    const now = JSON.stringify(board.saved());
    if (now === sent) return;
    sent = now;
    void save(board.saved(), leaving).then(kept => (board.unsaved = !kept));
  };
  // The tunnel cards follow what is on the board: its apps, which of them run without tunnels, and the environment.
  const needs = $derived(
    JSON.stringify([
      board.env,
      board.queues,
      board.hiddenQueues,
      board.nodes.map(node => [node.id, node.data.hideTunnels]),
    ]),
  );
  $effect(() => {
    if (needs && board.stack)
      untrack(() => {
        board.syncInfra();
      });
  });
  $effect(() => {
    board.settle();
  });
  $effect(() => {
    if (board.stack) board.record();
  });
  $effect(() => {
    const now = JSON.stringify(board.saved());
    if (!board.stack) return;
    // What the server handed over is what it has.
    if (!sent) sent = now;
    else if (now !== sent) waiting = setTimeout(keep, 400);
    return () => {
      clearTimeout(waiting);
    };
  });

  const remembered = () => {
    try {
      return localStorage.getItem('koppler-side') !== 'hidden';
    } catch {
      return true;
    }
  };
  let side = $state(remembered());
  const toggleSide = () => {
    side = !side;
    try {
      localStorage.setItem('koppler-side', side ? 'open' : 'hidden');
    } catch {
      // Not remembered where the browser keeps nothing.
    }
  };
</script>

<svelte:window
  onpagehide={() => {
    keep(true);
  }}
/>

<header class:protected={board.protected}>
  <button
    class="side-toggle"
    type="button"
    aria-expanded={side}
    aria-label={side ? 'Hide the side pane' : 'Show the side pane'}
    title={side ? 'Hide the side pane' : 'Show the side pane'}
    onclick={toggleSide}
  >
    <svg viewBox="0 0 16 16" width="16" height="16" aria-hidden="true">
      <rect x="1.5" y="2.5" width="13" height="11" rx="2" />
      <path d="M6 3v10" />
    </svg>
  </button>
  <span class="title">Koppler</span>
  {#if board.stack}
    <span class="stack">{board.stack}</span>
    <span class="env" class:prod={board.protected}>{board.env.toUpperCase()}</span>
  {/if}
  <span class="spacer"></span>
  <Help />
</header>
{#if board.protected}
  <div class="banner" role="alert">
    {board.env.toUpperCase()}: local code runs against real {board.env.toUpperCase()} data and secrets.
  </div>
{/if}
<main>
  {#await opened then found}
    {#if found}
      {#if side}<Side />{/if}
      <div class="board">
        <SvelteFlowProvider>
          <Board />
        </SvelteFlowProvider>
        <Toast />
      </div>
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
  header.protected {
    border-bottom: 3px solid var(--prod);
  }
  .spacer {
    flex: 1;
  }
  .banner {
    padding: 6px 16px;
    background: color-mix(in oklab, var(--prod) 14%, var(--panel));
    color: var(--prod);
    font: 600 13px var(--sans);
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
  .side-toggle {
    display: grid;
    place-items: center;
    width: 32px;
    height: 32px;
    margin-right: -4px;
    padding: 0;
    border: 0;
    border-radius: 8px;
    background: none;
    color: var(--muted);
    cursor: pointer;
  }
  .side-toggle:hover {
    background: color-mix(in oklab, var(--ink) 7%, transparent);
  }
  .side-toggle svg {
    fill: none;
    stroke: currentColor;
    stroke-width: 1.4;
  }
  .side-toggle[aria-expanded='true'] path {
    stroke-width: 2.6;
  }
  main {
    display: flex;
    flex: 1;
    min-height: 0;
  }
  .board {
    position: relative;
    flex: 1;
    min-width: 0;
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
