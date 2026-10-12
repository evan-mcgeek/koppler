<script lang="ts">
  import { SvelteFlowProvider } from '@xyflow/svelte';
  import { untrack } from 'svelte';
  import Board from './Board.svelte';
  import Help from './Help.svelte';
  import Logs from './Logs.svelte';
  import Menu from './Menu.svelte';
  import Review from './Review.svelte';
  import { runs } from './run.svelte.ts';
  import Side from './Side.svelte';
  import StackPicker from './StackPicker.svelte';
  import Toast from './Toast.svelte';
  import { board } from './board.svelte.ts';
  import { load, save } from './data.ts';
  import { live } from './live.svelte.ts';

  let noting = $state<HTMLDialogElement>();
  let note = $state('');
  /** A stack on its way in, from here, another tab or the terminal: the board waits until the page reloads with it. */
  const loading = $derived(
    runs.switching ?? (live.status?.loading && live.status.loading !== board.dir ? live.status.loading : null),
  );
  const loadingName = $derived(live.status?.stacks?.find(stack => stack.dir === loading)?.name ?? 'the stack');
  // The stack in use changed and its data is loaded: this page shows the old one, so it opens again.
  $effect(() => {
    const here = live.status?.stack;
    if (!here || !board.dir || here === board.dir) return;
    try {
      // ponytail: at most one reload in ten seconds, so a stack that fails to match cannot loop the page.
      if (Number(sessionStorage.getItem('koppler-stack-reload')) > Date.now() - 10000) return;
      sessionStorage.setItem('koppler-stack-reload', String(Date.now()));
    } catch {
      return;
    }
    location.reload();
  });
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
    <StackPicker />
    <span class="env" class:prod={board.protected}>{board.env.toUpperCase()}</span>
  {/if}
  <span class="spacer"></span>
  <Help />
  {#if board.stack}
    <span class="split" inert={!!loading}>
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
      <Menu
        label="More ways to stop"
        tone="stop"
        items={[
          {
            label: 'Stop apps, keep changes',
            about: runs.started.length
              ? 'Stops every app, API and tunnel; branches and code changes stay until you revert'
              : 'Nothing is running',
            off: !runs.started.length,
            run: () => {
              runs.stopApps();
            },
          },
          {
            label: 'Shut down Koppler',
            about: 'Stops the agent listener and this canvas server; apps and tunnels keep running',
            danger: true,
            run: () => {
              runs.shutDown();
            },
          },
        ]}
      />
    </span>
    <span class="split" inert={!!loading}>
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
      {#if board.nodes.length}
        <Menu
          label="More ways to run"
          tone="run"
          items={[
            {
              label: 'Run with a note for the agent…',
              about: 'Tell the agent something for this run, like a test account or a flag',
              run: () => {
                noting?.showModal();
              },
            },
            {
              label: 'Get a checklist instead',
              about: 'The agent changes nothing and lists the steps for you to do yourself',
              run: () => {
                runs.start({ manual: true });
              },
            },
          ]}
        />
      {/if}
    </span>
  {/if}
</header>
<Review />
<dialog bind:this={noting} class="noting" aria-labelledby="noting-title" onclose={() => (note = '')}>
  <form
    method="dialog"
    onsubmit={() => {
      runs.start({ note: note.trim() });
    }}
  >
    <label id="noting-title" for="run-note">Note for the agent</label>
    <textarea
      id="run-note"
      rows="3"
      required
      placeholder="e.g. log in as the test account, or turn on the new checkout"
      bind:value={note}
    ></textarea>
    <div class="noting-acts">
      <button type="button" onclick={() => noting?.close()}>Cancel</button>
      <button class="go" type="submit">Review and send</button>
    </div>
  </form>
</dialog>
{#if board.protected}
  <div class="banner" role="alert">
    {board.env.toUpperCase()}: local code runs against real {board.env.toUpperCase()} data and secrets.
  </div>
{/if}
<div class="work">
  {#if loading}
    <div class="loading" role="status">
      <p><span class="dot" aria-hidden="true"></span><span class="what">Loading {loadingName}...</span></p>
    </div>
  {/if}
  <main inert={!!loading}>
    {#await opened then found}
      {#if found}
        {#if side}<Side />{/if}
        <div class="stage">
          <div class="board">
            <SvelteFlowProvider>
              <Board />
            </SvelteFlowProvider>
            <Toast />
          </div>
          <Logs />
        </div>
      {:else}
        <p class="empty">No stack yet. Run <code>koppler init</code>, then open the canvas again.</p>
      {/if}
    {/await}
  </main>
</div>

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
  /* A main button and the arrow beside it read as one. */
  .split {
    display: inline-flex;
    align-items: stretch;
  }
  .split > :is(.stop, .run):has(+ :global(.more)) {
    border-radius: 8px 0 0 8px;
  }
  .noting {
    width: min(420px, calc(100vw - 32px));
    padding: 16px;
    border: 1px solid var(--line);
    border-radius: 12px;
    background: var(--surface);
    color: var(--ink);
    box-shadow: var(--lift);
  }
  .noting::backdrop {
    background: color-mix(in oklab, var(--desk) 60%, transparent);
  }
  .noting form {
    display: grid;
    gap: 8px;
  }
  .noting label {
    font: 600 13px var(--sans);
  }
  .noting textarea {
    padding: 8px;
    border: 1px solid var(--line);
    border-radius: 6px;
    background: var(--paper);
    color: var(--ink);
    font: 13px var(--sans);
    resize: vertical;
  }
  .noting-acts {
    display: flex;
    justify-content: flex-end;
    gap: 8px;
  }
  .noting-acts button {
    padding: 6px 12px;
    border: 1px solid var(--line);
    border-radius: 8px;
    background: none;
    color: var(--ink);
    font: 600 13px var(--sans);
    cursor: pointer;
  }
  .noting-acts .go {
    border-color: transparent;
    background: var(--cable);
    color: var(--on-accent);
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
  .work {
    position: relative;
    display: flex;
    flex: 1;
    min-height: 0;
  }
  main {
    display: flex;
    flex: 1;
    min-width: 0;
    min-height: 0;
  }
  .loading {
    position: absolute;
    z-index: 40;
    inset: 0;
    display: grid;
    place-items: center;
    background: color-mix(in srgb, var(--desk) 70%, transparent);
  }
  .loading p {
    display: flex;
    align-items: center;
    gap: 10px;
    max-width: min(420px, 80%);
    margin: 0;
    padding: 10px 16px;
    border: 1px solid var(--line);
    border-radius: 8px;
    background: var(--panel);
    color: var(--ink);
    font: 600 13px var(--sans);
  }
  .loading .what {
    min-width: 0;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }
  .loading .dot {
    flex: none;
    width: 12px;
    height: 12px;
    border: 1.5px solid var(--line);
    border-top-color: var(--cable);
    border-radius: 50%;
    animation: turning 0.7s linear infinite;
  }
  @keyframes turning {
    to {
      rotate: 360deg;
    }
  }
  @media (prefers-reduced-motion: reduce) {
    .loading .dot {
      animation: none;
    }
  }
  .stage {
    display: flex;
    flex: 1;
    flex-direction: column;
    min-width: 0;
  }
  .board {
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
