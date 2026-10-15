<script lang="ts">
  import CommandDialog from './CommandDialog.svelte';
  import Icon from './Icon.svelte';
  import PanelLeft from '@lucide/svelte/icons/panel-left';
  import Square from '@lucide/svelte/icons/square';
  import Cog from './Cog.svelte';
  import Command from './Command.svelte';
  import { SvelteFlowProvider } from '@xyflow/svelte';
  import { tick, untrack } from 'svelte';
  import Agent from './Agent.svelte';
  import Board from './Board.svelte';
  import Credentials from './Credentials.svelte';
  import Checklist from './Checklist.svelte';
  import Findings from './Findings.svelte';
  import Health from './Health.svelte';
  import Help from './Help.svelte';
  import Inbox from './Inbox.svelte';
  import { inbox } from './inbox.svelte.ts';
  import History from './History.svelte';
  import Traces from './Traces.svelte';
  import Logs from './Logs.svelte';
  import Menu from './Menu.svelte';
  import Rail from './Rail.svelte';
  import AddOutside from './AddOutside.svelte';
  import CardPanel from './CardPanel.svelte';
  import SettingsPanel from './SettingsPanel.svelte';
  import Repos from './Repos.svelte';
  import Review from './Review.svelte';
  import { runs } from './run.svelte.ts';
  import { stacks } from './stacks.svelte.ts';
  import Setup from './Setup.svelte';
  import Side from './Side.svelte';
  import StackPicker from './StackPicker.svelte';
  import Toast from './Toast.svelte';
  import { board } from './board.svelte.ts';
  import { undo } from './undo.svelte.ts';
  import { openFile } from './boards.ts';
  import { dialogs } from './dialogs.svelte.ts';
  import { load, post, save } from './data.ts';
  import { describeEdit } from '../src/core/presets.ts';
  import { live } from './live.svelte.ts';
  import { toasts } from './toast.svelte.ts';

  // A board file can be dropped anywhere on the page, which shows where it will land.
  let dropping = $state(false);
  const withFile = (ev: DragEvent) => !!ev.dataTransfer?.types.includes('Files');
  const dragIn = (ev: DragEvent) => {
    if (withFile(ev)) dropping = true;
  };
  const dragOver = (ev: DragEvent) => {
    if (withFile(ev)) ev.preventDefault();
  };
  const dragOut = (ev: DragEvent) => {
    if (!ev.relatedTarget) dropping = false;
  };
  const dropped = (ev: DragEvent) => {
    if (!withFile(ev)) return;
    ev.preventDefault();
    dropping = false;
    void openFile(ev.dataTransfer?.files[0]);
  };
  let noting = $state<HTMLDialogElement>();
  let note = $state('');
  // Whatever the agent says next opens its panel, or is announced.
  $effect(() => {
    inbox.follow();
  });
  /** A stack on its way in, from here, another tab or the terminal: the board waits until the page reloads with it. */
  const loading = $derived(
    stacks.switching ?? (live.status?.loading && live.status.loading !== board.dir ? live.status.loading : null),
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
      // `koppler canvas --board "<name>"` opens on that board, once: a reload keeps what is opened next.
      if (location.hash.startsWith('#board=')) {
        const want = decodeURIComponent(location.hash.slice(7)).toLowerCase();
        const asked = [...board.own, ...board.team].find(one => one.name.toLowerCase() === want);
        history.replaceState(null, '', location.pathname + location.search);
        if (asked && asked.name !== board.name) board.openBoard(asked);
      }
      // With no stack the page asks for one; with a stack that has no apps yet, for its repos.
      if (board.setup) dialogs.setup?.open();
      else if (!board.apps.length || location.hash === '#pick') {
        history.replaceState(null, '', location.pathname + location.search);
        void dialogs.repos?.open();
      }
    }
    return !!loaded;
  });

  // Every change is kept: sent once the board has been still for a moment, and again as the page is left.
  let sent = '';
  let sending = '';
  let waiting: ReturnType<typeof setTimeout> | undefined;
  const keep = (leaving = false) => {
    clearTimeout(waiting);
    board.commit();
    const now = board.saved();
    const text = JSON.stringify(now);
    if (text === sent || text === sending) return;
    sending = text;
    void save(now, leaving).then(kept => {
      sending = '';
      board.unsaved = !kept;
      // Only what the server took counts as sent; what it did not is tried again until it does.
      if (kept) sent = text;
      else waiting = setTimeout(keep, 2000);
    });
  };
  // The tunnel and queue cards follow what is on the board: its apps, which of them run without tunnels or are off
  // their queues, and the environment.
  const needs = $derived(
    JSON.stringify([
      board.env,
      board.queues,
      board.hiddenQueues,
      board.hiddenOutside,
      board.pinned,
      board.cards.map(node => [node.id, node.data.hideTunnels, node.data.showQueues]),
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
  // A board changed from the terminal is changed here too, said, and kept, so this page never saves its older copy
  // over it. In Live it waits for Edit.
  const made: Record<string, true> = {};
  $effect(() => {
    const edits = live.status?.boardEdits ?? [];
    if (!board.stack || board.live) return;
    untrack(() => {
      for (const one of edits.filter(one => !made[one.id])) {
        made[one.id] = true;
        const name = board.nameOf;
        if (one.preset) {
          const out = board.importBoards(
            one.preset,
            typeof one.preset['source'] === 'string' ? one.preset['source'] : one.board,
          );
          toasts.show(
            out.error === undefined
              ? `Opened ${one.board} from the terminal.`
              : `Cannot open ${one.board}. ${out.error}`,
            out.error === undefined ? 'message' : 'warning',
          );
        } else if (board.edit(one.board, one.edit, one.create))
          toasts.show(
            one.create
              ? `The agent made a board, ${one.board}.`
              : `The agent changed ${one.board}: ${describeEdit(one.edit, name)}.`,
          );
        void post('board-edit-done', { id: one.id });
      }
    });
  });
  $effect(() => {
    if (board.stack) undo.record();
  });
  // `koppler refresh`: the stack and the board read again, in place. The first status only says when it last ran.
  let refreshed: string | null | undefined;
  $effect(() => {
    const asked = live.status?.refresh;
    if (asked === undefined) return;
    if (refreshed !== undefined && asked !== refreshed) void untrack(() => board.reload());
    refreshed = asked;
  });
  // A change only restarts the wait: the board is put together once, when it has been still for a moment.
  $effect(() => {
    if (!board.changes.length || !board.stack) return;
    untrack(() => {
      board.commit();
      // What the server handed over is what it has.
      if (!sent) sent = JSON.stringify(board.saved());
      else waiting = setTimeout(keep, 400);
    });
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
  // In a narrow window the pane folds by itself, and opens again when the window grows; a fold chosen by hand stays.
  let autoFolded = false;
  $effect(() => {
    const tight = matchMedia('(max-width: 1100px)');
    const follow = () => {
      untrack(() => {
        if (tight.matches && side) [autoFolded, side] = [true, false];
        else if (!tight.matches && !side && autoFolded) [autoFolded, side] = [false, true];
      });
    };
    follow();
    tight.addEventListener('change', follow);
    return () => {
      tight.removeEventListener('change', follow);
    };
  });
  // A full top bar drops its words: nothing moves out of it.
  let bar: HTMLElement | undefined = $state();
  const fitBar = () => {
    if (!bar) return;
    bar.classList.remove('compact');
    bar.classList.toggle('compact', bar.scrollWidth > bar.clientWidth + 1);
  };
  $effect(() => {
    if (!bar) return;
    const watch = new ResizeObserver(fitBar);
    watch.observe(bar);
    return () => {
      watch.disconnect();
    };
  });
  // What the bar says changes its width too.
  $effect(() => {
    const said = `${board.stack}${live.status?.running?.join() ?? ''}`;
    requestAnimationFrame(() => {
      if (said) fitBar();
    });
  });
  const toggleSide = () => {
    autoFolded = false;
    side = !side;
    try {
      localStorage.setItem('koppler-side', side ? 'open' : 'hidden');
    } catch {
      // Not remembered where the browser keeps nothing.
    }
  };
  // From the folded rail: its board button lands on the board picker.
  // A pinch zooms the board only: anywhere else the browser would zoom the whole page.
  $effect(() => {
    const outside = (ev: Event) => {
      if (!(ev.target instanceof Element && ev.target.closest('.svelte-flow'))) ev.preventDefault();
    };
    const wheel = (ev: WheelEvent) => {
      if (ev.ctrlKey) outside(ev);
    };
    window.addEventListener('wheel', wheel, { passive: false });
    // Safari's pinch.
    window.addEventListener('gesturestart', outside);
    return () => {
      window.removeEventListener('wheel', wheel);
      window.removeEventListener('gesturestart', outside);
    };
  });
  const openSide = async (at?: 'board') => {
    toggleSide();
    if (!at) return;
    await tick();
    document.querySelector<HTMLElement>('aside button[aria-label^="Board:"]')?.focus();
  };
</script>

<svelte:document
  onfullscreenchange={() => {
    if (!document.fullscreenElement && !board.entering) board.present = false;
  }}
/>
<svelte:window
  onkeydown={keys}
  onpagehide={() => {
    keep(true);
  }}
  ondragenter={dragIn}
  ondragover={dragOver}
  ondragleave={dragOut}
  ondrop={dropped}
/>

<header class:protected={board.protected} bind:this={bar} hidden={board.present}>
  <button
    class="side-toggle"
    type="button"
    aria-expanded={side}
    aria-label={side ? 'Hide the side pane' : 'Show the side pane'}
    title={side ? 'Hide the side pane' : 'Show the side pane'}
    onclick={toggleSide}
  >
    <Icon of={PanelLeft} size={16} />
  </button>
  <span class="title">Koppler</span>
  {#if board.stack}
    <StackPicker />
    <button
      class="side-toggle gear"
      type="button"
      aria-label="Stack settings"
      title="Stack settings: its environments, apps, queues, sign-ins and team boards"
      onclick={() => void dialogs.settings?.open({ title: `${board.stack} settings`, path: '' })}
    >
      <Cog size={16} />
    </button>
    <span class="env" class:prod={board.protected}>{board.env.toUpperCase()}</span>
  {/if}
  <span class="spacer"></span>
  {#if board.stack}<Health /><Agent />{/if}
  {#if board.stack}<History /><Traces /><Credentials />{/if}
  <Help />
  {#if board.stack}
    <span class="split" inert={!!loading}>
      <button
        class="stop"
        type="button"
        aria-label="Stop"
        disabled={!runs.started.length}
        title={runs.started.length
          ? 'Stop what the agent started and revert all temporary code changes'
          : 'Nothing is running'}
        onclick={() => {
          runs.stop();
        }}
      >
        <Icon of={Square} size={12} filled />
        <span class="words">Stop</span>
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
            label: 'Revert temporary changes',
            about: runs.left.length
              ? 'Undoes what the last run left: branches back, temporary edits gone'
              : 'Nothing to revert',
            off: !runs.left.length,
            run: () => {
              runs.stop();
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
{#if dropping}<div class="dropping">Drop to open this board</div>{/if}
<Review />
<Setup bind:this={dialogs.setup} />
<Repos bind:this={dialogs.repos} />
<AddOutside bind:this={dialogs.outside} />
<SettingsPanel bind:this={dialogs.settings} />
<Findings bind:this={dialogs.findings} />
<Checklist bind:this={dialogs.checklist} />
<CommandDialog bind:this={dialogs.command} />
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
        {#if board.present}{:else if side}<Side />{:else}<Rail open={openSide} />{/if}
        <div class="stage">
          <div class="work">
            <div class="board">
              <SvelteFlowProvider>
                <Board />
              </SvelteFlowProvider>
              <Toast />
            </div>
            {#if !board.present}<CardPanel />{/if}
          </div>
          {#if !board.present}<Logs />{/if}
        </div>
      {:else}
        <div class="empty">
          <p>No stack yet. Run this in your terminal, then open the canvas again.</p>
          <Command command="koppler init" />
        </div>
      {/if}
    {/await}
  </main>
  {#if !board.present}<Inbox />{/if}
</div>

<style>
  header[hidden] {
    display: none;
  }
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
  /* Still too full without its words, it takes a second row. */
  header:global(.compact) {
    flex-wrap: wrap;
  }
  header:global(.compact) :global(.words) {
    display: none;
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
  .stop:disabled {
    border-color: var(--line);
    color: var(--muted);
    cursor: not-allowed;
  }
  .stop:disabled + :global(.more.stop) {
    border-color: var(--line);
    color: var(--muted);
  }
  .stop:not(:disabled):hover {
    background: color-mix(in oklab, var(--prod) 12%, transparent);
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
  .gear {
    margin: 0 0 0 -8px;
  }
  .dropping {
    position: fixed;
    z-index: 60;
    inset: 12px;
    display: grid;
    place-items: center;
    border: 2px dashed var(--cable);
    border-radius: 14px;
    background: color-mix(in oklab, var(--cable) 10%, transparent);
    color: var(--cable-ink);
    font: 600 16px var(--sans);
    pointer-events: none;
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
  .work {
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
    display: grid;
    gap: 8px;
    max-width: 420px;
    padding: 24px 16px;
    color: var(--muted);
    font-size: 14px;
  }
  .empty p {
    margin: 0;
  }
</style>
