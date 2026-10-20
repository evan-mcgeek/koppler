<script lang="ts">
  import CommandDialog from './CommandDialog.svelte';
  import Icon from './Icon.svelte';
  import PanelLeft from '@lucide/svelte/icons/panel-left';
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
  import { credentials, opens } from './bar.svelte.ts';
  import HistoryIcon from '@lucide/svelte/icons/history';
  import RefreshCw from '@lucide/svelte/icons/refresh-cw';
  import BarMenu from './BarMenu.svelte';
  import BoardPicker from './BoardPicker.svelte';
  import Settings from './Settings.svelte';
  import { ALL, logs } from './logs.svelte.ts';
  import { traces, tracesAbout, tracesLabel } from './traces.ts';
  import Logs from './Logs.svelte';
  import Mark from './Mark.svelte';
  import Tip from './Tip.svelte';
  import Menu from './Menu.svelte';
  import Rail from './Rail.svelte';
  import AddOutside from './AddOutside.svelte';
  import CardPanel from './CardPanel.svelte';
  import Discover from './Discover.svelte';
  import LeftOut from './LeftOut.svelte';
  import SettingsPanel from './SettingsPanel.svelte';
  import Repos from './Repos.svelte';
  import Review from './Review.svelte';
  import { runs } from './run.svelte.ts';
  import { stacks } from './stacks.svelte.ts';
  import Setup from './Setup.svelte';
  import Side from './Side.svelte';
  import { discovered } from './discover.svelte.ts';
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
  let reading = $state(false);
  const readAgain = async () => {
    reading = true;
    const said = await post<{ unread: number }>('read-again');
    reading = false;
    if ('error' in said) {
      toasts.show(said.error, 'warning');
      return;
    }
    await board.reload();
    if (said.unread)
      toasts.show(
        `${String(said.unread)} ${said.unread === 1 ? 'repo' : 'repos'} could not be read from GitHub: is gh signed in (gh auth status)?`,
        'warning',
      );
  };
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
  /** What `koppler canvas` asked to show, in the address or sent to this open page: a board, or the repo picker. */
  const follow = (hash: string) => {
    // `koppler canvas --board "<name>"` opens on that board, once: a reload keeps what is opened next.
    if (hash.startsWith('#board=')) {
      const want = decodeURIComponent(hash.slice(7)).toLowerCase();
      const asked = [...board.own, ...board.team].find(one => one.name.toLowerCase() === want);
      if (asked && asked.name !== board.name) board.openBoard(asked);
    }
    // With no stack the page asks for one; with a stack that has no apps yet, for its repos.
    if (board.setup) dialogs.setup?.open();
    else if (!board.apps.length || hash === '#pick') void dialogs.repos?.open();
  };
  const opened = load().then(loaded => {
    if (loaded) {
      board.open(loaded);
      live.watch();
      const hash = location.hash;
      if (hash) history.replaceState(null, '', location.pathname + location.search);
      follow(hash);
      // While this page is open, `koppler canvas` shows it instead of opening another tab.
      new EventSource('data/events').onmessage = event => {
        follow((JSON.parse(String(event.data)) as { hash: string }).hash);
        window.focus();
      };
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
  // The tunnel, database and queue cards follow what is on the board: its apps, which of them run without tunnels or
  // are off their queues, which databases are local, and the environment.
  const needs = $derived(
    JSON.stringify([
      board.env,
      board.queues,
      board.databases,
      board.hiddenQueues,
      board.hiddenOutside,
      board.pinned,
      board.cards.map(node => [
        node.id,
        node.data.run,
        node.data.hideTunnels,
        node.data.showQueues,
        node.data.shownTunnels,
      ]),
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
        // A queue or database a feature step names is said by its name too.
        const name = (id: string) => (id.includes(':') ? discovered.data(id, false, 0).name : board.nameOf(id));
        if (one.delete) {
          board.deleteBoard(one.board);
          toasts.show(`The agent deleted ${one.board}. Recently deleted brings it back.`);
        } else if (one.preset) {
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
  const runWaits = $derived(!!live.status?.runs?.some(run => run.state === 'waiting'));
  // A full top bar drops its words: nothing moves out of it.
  let bar: HTMLElement | undefined = $state();
  const STEPS = ['l1', 'l2', 'l3', 'l4', 'l5', 'compact'];
  const fitBar = () => {
    if (!bar) return;
    const el = bar;
    const full = () => el.scrollWidth > el.clientWidth + 1;
    el.classList.remove(...STEPS);
    for (const step of STEPS) {
      if (!full()) break;
      el.classList.add(step);
    }
  };
  $effect(() => {
    if (!bar) return;
    // Fitted on the next frame, and only when its width changed: dropping the words changes its height, and a change
    // of size made while the browser hands out sizes is what it reports as a ResizeObserver loop.
    let width = 0;
    const watch = new ResizeObserver(([entry]) => {
      const now = Math.round(entry?.contentRect.width ?? 0);
      if (now === width) return;
      width = now;
      requestAnimationFrame(fitBar);
    });
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
  // A trackpad pinch the board did not take would zoom the page; Ctrl held with the wheel still zooms it.
  $effect(() => {
    let ctrl = false;
    const key = (ev: KeyboardEvent) => {
      if (ev.key === 'Control') ctrl = ev.type === 'keydown';
    };
    const wheel = (ev: WheelEvent) => {
      if (ev.ctrlKey && !ctrl) ev.preventDefault();
    };
    const gesture = (ev: Event) => {
      ev.preventDefault();
    };
    window.addEventListener('keydown', key);
    window.addEventListener('keyup', key);
    window.addEventListener('wheel', wheel, { passive: false });
    window.addEventListener('gesturestart', gesture);
    return () => {
      window.removeEventListener('keydown', key);
      window.removeEventListener('keyup', key);
      window.removeEventListener('wheel', wheel);
      window.removeEventListener('gesturestart', gesture);
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
  {#if !board.discovering}
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
  {/if}
  <button
    class="brand"
    type="button"
    aria-label="Help: shortcuts and legend"
    title="Shortcuts and legend (?)"
    onclick={() => {
      opens.help?.();
    }}><Mark size={22} /><span class="word">koppler</span></button
  >
  {#if board.stack}
    <span class="names"><StackPicker /></span>
    {#if board.discovering}
      <span class="slash" aria-hidden="true">/</span>
      <span class="boards"><BoardPicker /></span>
    {/if}
    <div
      class="seg views"
      role="radiogroup"
      aria-label="Board view"
      title="Discover (D): how the stack fits together. Plan (E): what runs and how it is wired. Live (L): what is running."
    >
      <label
        ><input
          type="radio"
          name="view"
          checked={board.discovering}
          onchange={() => {
            board.goDiscover();
          }}
        />Discover</label
      >
      <label
        ><input
          type="radio"
          name="view"
          checked={!board.discovering && !board.live}
          onchange={() => {
            board.goEdit();
          }}
        />Plan</label
      >
      <label
        ><input
          type="radio"
          name="view"
          checked={board.live && !board.discovering}
          onchange={() => {
            board.goLive();
          }}
        />Live</label
      >
    </div>
    <div class="seg env" role="radiogroup" aria-label="Environment">
      {#each board.envs as env (env)}
        <label class:prod={board.protected}
          ><input type="radio" name="env" value={env} bind:group={board.env} />{env.toUpperCase()}</label
        >
      {/each}
    </div>
  {/if}
  <span class="spacer"></span>
  {#if board.stack}
    {#if !board.discovering}
      <span class="chips"><Health /><Agent /></span>
      <BarMenu
        label="Activity"
        name="activity"
        title={runWaits ? 'A run is waiting for the agent' : 'Logs, history and traces'}
        items={[
          {
            label: 'Logs',
            about: 'The log of every app on the board, in one stream',
            run: () => {
              logs.active = logs.active === ALL ? null : ALL;
            },
          },
          {
            label: 'History',
            about: 'Every run and Stop, and how it ended',
            run: (from: HTMLElement) => opens.history?.(from),
          },
          { label: tracesLabel(), about: tracesAbout(), run: () => void traces() },
        ]}
      >
        <span class="glyph" class:mark={runWaits}><Icon of={HistoryIcon} size={15} /></span><span class="words"
          >Activity</span
        >
      </BarMenu>
    {/if}
    {#if board.discovering}
      <button
        class="read-again"
        type="button"
        aria-label={reading ? 'Reading…' : 'Read again'}
        title="Read the code again: your clones, and the repos not cloned here from GitHub"
        disabled={reading}
        onclick={() => void readAgain()}
        ><Icon of={RefreshCw} size={14} /><span class="words">{reading ? 'Reading…' : 'Read again'}</span></button
      >
    {/if}
    <BarMenu
      label="Settings"
      name="settings"
      title={credentials.missing
        ? `${String(credentials.missing)} ${credentials.missing === 1 ? 'credential is' : 'credentials are'} missing for the apps on the board (${board.env.toUpperCase()})`
        : 'Stack settings, credentials and appearance'}
      chevron={false}
      items={[
        {
          label: 'Stack settings',
          about: 'Its environments, apps, queues, sign-ins and team boards',
          run: () => void dialogs.settings?.open({ title: `${board.stack} settings`, path: '' }),
        },
        {
          label: 'Credentials',
          about: 'What the apps on the board need stored',
          run: (from: HTMLElement) => opens.credentials?.(from),
        },
        {
          label: 'Appearance',
          about: 'Colours, the debug log and this canvas address',
          run: (from: HTMLElement) => opens.settings?.(from),
        },
      ]}
    >
      <span class="glyph" class:mark={credentials.missing > 0}><Cog size={15} /></span><span class="words"
        >Settings</span
      >
    </BarMenu>
    {#if !board.discovering}
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
          <span class="stop-mark" aria-hidden="true"></span>
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
      <!-- Live shows what runs, and Discover runs nothing: Run is in Plan. -->
      {#if !board.live}
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
            }}><span class="play" aria-hidden="true"></span>Run</button
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
    {/if}
  {/if}
</header>
<History />
<Credentials />
<Help />
<Settings bare />
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
  <div class="frame" aria-hidden="true"></div>
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
        {#if board.present || board.discovering}{:else if side}<Side />{:else}<Rail open={openSide} />{/if}
        <div class="stage">
          <div class="work">
            <div class="board">
              {#if board.discovering}
                <SvelteFlowProvider><Discover /></SvelteFlowProvider>
              {:else}
                <SvelteFlowProvider><Board /></SvelteFlowProvider>
              {/if}
              <Toast />
            </div>
            {#if !board.present && !board.discovering}<CardPanel />{/if}
            {#if board.fromDiscover && !board.discovering && !board.live}<LeftOut />{/if}
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

<Tip />

<style>
  header[hidden] {
    display: none;
  }
  header {
    display: flex;
    align-items: center;
    gap: 10px;
    min-height: 56px;
    padding: 8px 14px;
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
    border-bottom-color: var(--prod);
  }
  /* The mark opens the shortcuts and legend. */
  .brand {
    display: flex;
    align-items: center;
    gap: 10px;
    padding: 0;
    border: 0;
    background: none;
    color: var(--ink);
    cursor: pointer;
  }
  .brand:focus-visible {
    outline: 2px solid var(--ink);
    outline-offset: 4px;
  }
  /* The stack picker brings its own slash: it sits on the line, a gap from the name, as the bar's other parts. */
  .names,
  .boards {
    display: flex;
    flex: none;
    align-items: center;
    gap: 10px;
  }
  /* The board's name reads as the stack's does: a name in the bar, not a field. */
  .boards {
    max-width: 360px;
  }
  .boards :global(.picker) {
    width: auto;
    max-width: 360px;
    margin-left: -8px;
    border-color: transparent;
    border-radius: 7px;
    background: none;
    color: var(--ink);
    font: 600 14px var(--sans);
  }
  .boards :global(.picker:hover),
  .boards :global(.picker[aria-expanded='true']) {
    border-color: var(--line);
  }
  .chips {
    display: flex;
    gap: 10px;
  }
  .read-again {
    display: inline-flex;
    align-items: center;
    gap: 8px;
    height: 32px;
    padding: 0 11px;
    border: 1px solid var(--line-strong);
    background: none;
    color: var(--ink);
    font: 600 13px var(--sans);
    white-space: nowrap;
    cursor: pointer;
  }
  .read-again:hover:not(:disabled) {
    border-color: var(--ink);
  }
  .read-again:focus-visible {
    outline: 2px solid var(--ink);
    outline-offset: 2px;
  }
  .read-again:disabled {
    color: var(--ink-muted);
    cursor: progress;
  }
  .glyph {
    position: relative;
    display: inline-flex;
  }
  /* Something in the menu waits on you: a run for the agent, a credential to store. */
  .glyph.mark::after {
    content: '';
    position: absolute;
    top: -3px;
    right: -4px;
    width: 6px;
    height: 6px;
    background: var(--warn, var(--ink));
  }
  /* As the bar runs short of room it gives way one step at a time, in this order; Run, Stop, the view switch and the
     environment keep their words at every width. */
  header:global(.l1) :global(.settings .words),
  header:global(.l1) .read-again .words,
  header:global(.l2) .word,
  header:global(.l4) :global(.activity :is(.words, .chev)),
  header:global(.l4) :global(.picker .kind) {
    display: none;
  }
  /* A menu without its word is its icon in a square, as the side pane's toggle is. */
  header:global(.l1) :global(.settings),
  header:global(.l1) .read-again,
  header:global(.l4) :global(.activity) {
    justify-content: center;
    width: 32px;
    padding: 0;
  }
  header:global(.l3) .chips {
    gap: 0;
  }
  header:global(.l3) .chips > :global(*:first-child) {
    border-right-width: 0;
  }
  header:global(.l5) :global(:is(.names, .boards) .picker) {
    max-width: 130px;
  }
  .word {
    font: 600 17px var(--display);
    letter-spacing: -0.005em;
  }
  .slash {
    margin: 0 -8px;
    color: var(--line-strong);
  }
  .env label,
  .views label {
    padding: 6px 11px;
  }
  .env label.prod:has(input:checked) {
    background: var(--prod-stripes);
    color: var(--on-prod);
    font-weight: 700;
  }
  .env:has(.prod) {
    border-color: var(--prod);
  }
  .stop-mark {
    width: 8px;
    height: 8px;
    background: currentColor;
  }
  .play {
    width: 0;
    height: 0;
    border-top: 4.5px solid transparent;
    border-bottom: 4.5px solid transparent;
    border-left: 7px solid currentColor;
  }
  .frame {
    position: fixed;
    z-index: 90;
    inset: 0;
    border: 3px solid var(--prod);
    pointer-events: none;
  }
  .spacer {
    flex: 1;
  }
  .banner {
    display: flex;
    align-items: center;
    min-height: 30px;
    padding: 0 16px;
    background: repeating-linear-gradient(-45deg, var(--prod) 0 12px, var(--prod-strong) 12px 24px);
    color: var(--on-prod);
    font: 700 11px var(--mono);
    letter-spacing: 0.08em;
    text-transform: uppercase;
  }
  .stop,
  .run {
    display: inline-flex;
    align-items: center;
    gap: 7px;
    padding: 7px 11px;
    border: 1px solid transparent;
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
    border-color: var(--line-strong);
    background: none;
    color: var(--ink);
  }
  .stop:disabled {
    color: var(--ink-muted);
    cursor: not-allowed;
  }
  .stop:disabled + :global(.more.stop) {
    color: var(--ink-muted);
  }
  .stop:not(:disabled):hover {
    background: color-mix(in oklab, var(--ink) 8%, transparent);
  }
  .run {
    padding-inline: 12px;
    background: var(--local);
    color: var(--desk);
  }
  /* The ring stands off the white fill so it reads against it. */
  .run:focus-visible {
    outline-color: var(--local);
    outline-offset: 3px;
  }
  .run:hover {
    background: color-mix(in oklab, var(--local) 85%, var(--desk));
  }
  .protected .run,
  .protected .run + :global(.more.run) {
    background: var(--prod);
    color: var(--on-prod);
  }
  .run:disabled {
    border: 1px dashed var(--line-strong);
    background: none;
    color: var(--ink-muted);
    cursor: not-allowed;
  }
  .side-toggle {
    display: grid;
    flex: none;
    place-items: center;
    width: 32px;
    height: 32px;
    padding: 0;
    border: 1px solid var(--line-strong);
    background: none;
    color: var(--ink);
    cursor: pointer;
  }
  .side-toggle:hover {
    background: color-mix(in oklab, var(--ink) 7%, transparent);
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
    align-content: start;
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
