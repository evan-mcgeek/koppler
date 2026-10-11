<script lang="ts">
  import { SvelteFlowProvider } from '@xyflow/svelte';
  import { untrack } from 'svelte';
  import Board from './Board.svelte';
  import Help from './Help.svelte';
  import Review from './Review.svelte';
  import { runs } from './run.svelte.ts';
  import Side from './Side.svelte';
  import Toast from './Toast.svelte';
  import { board } from './board.svelte.ts';
  import { load, save } from './data.ts';
  import { live } from './live.svelte.ts';

  /** Asked for once, when the page opens. ponytail: no polling yet; it comes with the live state of the cards. */
  const opened = load().then(loaded => {
    if (loaded) {
      board.open(loaded);
      live.watch();
    }
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

  const keys = (ev: KeyboardEvent) => {
    if (!(ev.metaKey || ev.ctrlKey) || ev.key !== 'Enter' || !board.nodes.length || runs.review) return;
    ev.preventDefault();
    runs.start();
  };
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
  onkeydown={keys}
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
  {#if board.stack}
    <button
      class="stop"
      type="button"
      title="Stop what the agent started and revert all temporary code changes"
      onclick={() => {
        runs.stop();
      }}
    >
      <svg viewBox="0 0 16 16" width="12" height="12" aria-hidden="true"
        ><rect x="3" y="3" width="10" height="10" rx="1.5" /></svg
      >
      Stop
    </button>
    <button
      class="run"
      type="button"
      disabled={!board.nodes.length}
      title={board.nodes.length
        ? 'Review what will run, then send it (Cmd or Ctrl + Enter)'
        : 'Add an app to the board first'}
      onclick={() => {
        runs.start();
      }}>Run</button
    >
  {/if}
</header>
<Review />
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
  .stop,
  .run {
    display: inline-flex;
    align-items: center;
    gap: 6px;
    padding: 6px 12px;
    border: 1px solid transparent;
    border-radius: 8px;
    font: 600 13px var(--sans);
    cursor: pointer;
  }
  .stop {
    border-color: color-mix(in oklab, var(--prod) 45%, transparent);
    background: none;
    color: var(--prod);
  }
  .stop:hover {
    background: color-mix(in oklab, var(--prod) 12%, transparent);
  }
  .stop rect {
    fill: currentColor;
  }
  .run {
    background: var(--cable);
    color: var(--on-accent);
  }
  .run:hover {
    background: color-mix(in oklab, var(--cable) 85%, var(--ink));
  }
  .protected .run {
    background: var(--prod);
  }
  .run:disabled {
    border-color: var(--line);
    background: color-mix(in oklab, var(--ink) 8%, transparent);
    color: var(--muted);
    cursor: not-allowed;
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
