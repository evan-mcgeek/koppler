<script lang="ts">
  import Icon from './Icon.svelte';
  import ArrowDown from '@lucide/svelte/icons/arrow-down';
  import Play from '@lucide/svelte/icons/play';
  import Plus from '@lucide/svelte/icons/plus';
  import Trash from '@lucide/svelte/icons/trash';
  import X from '@lucide/svelte/icons/x';
  import Command from './Command.svelte';
  import BoardPicker from './BoardPicker.svelte';
  import KindIcon from './KindIcon.svelte';
  import Needs from './Needs.svelte';
  import Summary from './Summary.svelte';
  import Settings from './Settings.svelte';
  import { board, type StackApp } from './board.svelte.ts';
  import { post } from './data.ts';
  import { dialogs } from './dialogs.svelte.ts';
  import { live } from './live.svelte.ts';
  import { runs } from './run.svelte.ts';
  import { toasts } from './toast.svelte.ts';

  type Sort = 'name' | 'added';
  const remembered = (): Sort => {
    try {
      return localStorage.getItem('koppler-sort') === 'added' ? 'added' : 'name';
    } catch {
      return 'name';
    }
  };
  let sort = $state(remembered());
  let search = $state('');
  let copied = $state('');
  // Outside systems count by their card: put there by hand, or because an app on the board uses them.
  const onBoard = $derived([
    ...board.cards.map(node => node.id),
    ...board.infra.filter(card => card.type === 'outside').map(card => card.id.slice(8)),
  ]);
  /** An app matches by any part of its name, or by the start of its kind: "pay", ".net", "lam". */
  const matches = (app: StackApp) => {
    const asked = search.trim().toLowerCase();
    const kind = (word: string) => word.toLowerCase().replace(/^\./, '');
    return !asked || app.name.toLowerCase().includes(asked) || kind(app.kindLabel).startsWith(kind(asked));
  };
  /** The apps on the board first, then the rest; each part by name, or in the order it was added. */
  const shown = $derived.by(() => {
    const place = (app: StackApp) => (onBoard.includes(app.id) ? onBoard.indexOf(app.id) : board.apps.indexOf(app));
    const order = (a: StackApp, b: StackApp) => (sort === 'name' ? a.name.localeCompare(b.name) : place(a) - place(b));
    const off = (app: StackApp) => (onBoard.includes(app.id) ? 0 : 1);
    return board.apps.filter(matches).sort((a, b) => off(a) - off(b) || order(a, b));
  });
  const firstOff = $derived(shown.find(app => !onBoard.includes(app.id)));
  const sortHint = $derived(
    sort === 'name'
      ? 'Sorted by name. Click to sort by when each was added.'
      : 'Sorted by when each was added. Click to sort by name.',
  );
  const toggleSort = () => {
    sort = sort === 'name' ? 'added' : 'name';
    try {
      localStorage.setItem('koppler-sort', sort);
    } catch {
      // Not remembered where the browser keeps nothing.
    }
  };
  const roots = $derived(board.roots.map(root => root.replace(/^\/Users\/[^/]+/, '~')).join(', '));
  const notCloned = $derived(board.apps.filter(app => !app.cloned && !app.outside));
  const missing = $derived(
    notCloned.length > 3
      ? `${notCloned
          .slice(0, 2)
          .map(app => app.name)
          .join(', ')} and ${String(notCloned.length - 2)} more`
      : new Intl.ListFormat('en', { type: 'conjunction' }).format(notCloned.map(app => app.name)),
  );
  let copiedAll = $state(false);
  const copyClones = async () => {
    const commands = notCloned.map(cloneCommand).join('\n');
    try {
      await navigator.clipboard.writeText(commands);
      copiedAll = true;
      setTimeout(() => (copiedAll = false), 2000);
    } catch {
      copied = `Copy is blocked here: ${commands}`;
    }
  };
  let scanning = $state(false);
  const rescan = async () => {
    scanning = true;
    const said = await post('rescan');
    scanning = false;
    if ('error' in said) toasts.show(said.error, 'warning');
    else location.reload();
  };
  const askDrop = (app: StackApp) => {
    runs.review = {
      title: `Remove ${app.name} from the stack?`,
      sub: 'The repo stays on your Mac. Other apps stop listing it as something they call.',
      notices: [],
      groups: [],
      ok: 'Remove from stack',
      prod: true,
      blocked: false,
      confirm: () => {
        void post('apps-remove', { id: app.id }).then(said => {
          if ('error' in said) toasts.show(said.error, 'warning');
          // The stack changed: the page opens again with it.
          else location.reload();
        });
      },
    };
  };
  const cloneCommand = (app: StackApp) => `git clone git@github.com:${app.slug}.git`;
  const copyClone = async (app: StackApp) => {
    try {
      await navigator.clipboard.writeText(cloneCommand(app));
      copied = `Clone command for ${app.name} copied.`;
    } catch {
      copied = `Copy is blocked here: ${cloneCommand(app)}`;
    }
  };
</script>

<aside aria-label="Board and apps" class:protected={board.protected}>
  <div class="head">
    <BoardPicker />
  </div>
  <section aria-labelledby="apps-title">
    <h2 id="apps-title">
      Apps
      {#if board.apps.length}
        <span class="count">{onBoard.length} of {board.apps.length} on the board</span>
      {/if}
      <button class="sort" type="button" onclick={toggleSort} title={sortHint} aria-label={sortHint}>
        <Icon of={ArrowDown} size={11} />
        {sort === 'name' ? 'Az' : 'Added'}
      </button>
    </h2>
    <input
      class="search"
      type="search"
      bind:value={search}
      placeholder="Find or filter: a name, .net, lambda"
      aria-label="Find an app by name or kind"
      autocomplete="off"
      spellcheck="false"
    />
    <div class="apps" role="list">
      {#each shown as app (app.id)}
        {@const on = onBoard.includes(app.id)}
        {@const missing = !!app.outside || !app.cloned}
        <div class="app" class:on class:missing class:first-off={app === firstOff && app !== shown[0]} role="listitem">
          <KindIcon kind={app.kind} label={app.kindLabel} />
          {#if on}
            <button
              class="main"
              type="button"
              title="Show its card"
              onclick={() => {
                board.show(app.outside ? `outside:${app.id}` : app.id);
              }}
            >
              <span class="name">{app.name}</span>
            </button>
            {@const up = live.up(app.id)}
            {#if up !== null}
              <span class="live" data-on={up} role="img" aria-label={up ? 'Running' : 'Not answering'}
                >{up ? '' : '!'}</span
              >
            {/if}
            <button
              class="act remove"
              type="button"
              aria-label="Remove {app.name} from the board"
              title="Remove from the board"
              onclick={() => {
                if (app.outside) board.showOutside(app.id, false);
                else board.remove(app.id);
              }}
            >
              <Icon of={X} size={11} />
            </button>
          {:else if app.outside}
            <button
              class="main"
              type="button"
              title="Does not run on this Mac: {app.outside}. Click to put its card on the board; it never runs."
              onclick={() => {
                board.showOutside(app.id, true);
              }}><span class="name">{app.name}</span></button
            >
            <span class="state">outside</span>
            <button
              class="act drop"
              type="button"
              aria-label="Remove {app.name} from the stack"
              title="Remove from the stack (the repo stays on your Mac)"
              onclick={() => {
                askDrop(app);
              }}
            >
              <Icon of={Trash} size={12} />
            </button>
          {:else if !app.cloned}
            <button
              class="main"
              type="button"
              title="Not cloned under {roots}. Click to copy the clone command."
              onclick={() => copyClone(app)}
            >
              <span class="name">{app.name}</span>
            </button>
            <span class="state">not cloned</span>
            <button
              class="act drop"
              type="button"
              aria-label="Remove {app.name} from the stack"
              title="Remove from the stack (the repo stays on your Mac)"
              onclick={() => {
                askDrop(app);
              }}
            >
              <Icon of={Trash} size={12} />
            </button>
          {:else}
            <button
              class="main"
              type="button"
              title="Add {app.name} to the board: click, or drag it there"
              draggable="true"
              ondragstart={ev => {
                ev.dataTransfer?.setData('text/app', app.id);
              }}
              onclick={() => {
                board.add(app.id);
              }}
            >
              <span class="name">{app.name}</span>
            </button>
            <button
              class="act drop"
              type="button"
              aria-label="Remove {app.name} from the stack"
              title="Remove from the stack (the repo stays on your Mac)"
              onclick={() => {
                askDrop(app);
              }}
            >
              <Icon of={Trash} size={12} />
            </button>
            <button
              class="act alone"
              type="button"
              aria-label="Run {app.name} alone"
              title="Run alone: just this app and its tunnels, on a board of its own"
              onclick={() => {
                runs.alone(app.id);
              }}
            >
              <Icon of={Play} size={12} filled />
            </button>
            <button
              class="act add"
              type="button"
              aria-label="Add {app.name} to the board"
              title="Add to the board"
              onclick={() => {
                board.add(app.id);
              }}
            >
              <Icon of={Plus} size={12} />
            </button>
          {/if}
        </div>
      {:else}
        <p class="empty">{board.apps.length ? 'No app matches.' : 'No apps in this stack yet.'}</p>
      {/each}
    </div>
    <div class="adds">
      <button class="add-repos" type="button" onclick={() => void dialogs.repos?.open()}>Add repos…</button>
      <button class="add-repos" type="button" onclick={() => dialogs.outside?.open()}>Add outside system…</button>
    </div>
    <p class="note" role="status">{copied}</p>
    <Summary />
  </section>
  <footer>
    {#if board.unsaved}
      <p class="unsaved" role="alert">Not saved: the canvas server is not answering. Changes stay on this page.</p>
    {/if}
    {#if live.status?.restart}
      <div class="warn">
        The canvas server runs older code, so some buttons fail until it restarts. Run this in your terminal:
        <Command command={live.status.restart} label="Copy restart command" />
      </div>
    {/if}
    {#if notCloned.length}
      <div class="clone" role="note" aria-label="Not cloned">
        <p>
          {missing}
          {notCloned.length === 1 ? 'is' : 'are'} not cloned on this Mac, so {notCloned.length === 1 ? 'it' : 'they'} cannot
          run here. Koppler looks for clones in {roots}.
        </p>
        <span class="acts">
          <button class="do" type="button" onclick={() => void copyClones()}>
            {copiedAll ? 'Copied' : notCloned.length === 1 ? 'Copy clone command' : 'Copy clone commands'}
          </button>
          <button type="button" disabled={scanning} onclick={() => void rescan()}>
            {scanning ? 'Looking…' : 'Look again'}
          </button>
        </span>
      </div>
    {/if}
    <Needs />
    <Settings />
  </footer>
</aside>

<style>
  aside {
    width: 324px;
    flex-shrink: 0;
    display: flex;
    flex-direction: column;
    gap: 18px;
    overflow: hidden auto;
    scrollbar-width: thin;
    padding: 0 12px 14px;
    border-right: 1px solid var(--line);
    background: var(--panel);
    color: var(--ink);
    font: 13px/1.4 var(--sans);
  }
  .head {
    display: grid;
    gap: 8px;
    position: sticky;
    top: 0;
    z-index: 2;
    margin: 0 -12px;
    padding: 12px;
    border-bottom: 1px solid var(--line);
    background: var(--panel);
  }
  .seg label {
    flex: 1;
    padding: 3px 12px;
    text-align: center;
    white-space: nowrap;
  }
  h2 {
    display: flex;
    align-items: baseline;
    gap: 6px;
    margin: 0 0 6px;
    padding: 0 8px;
    font-size: 13px;
    font-weight: 600;
  }
  .count {
    color: var(--muted);
    font-weight: 500;
    font-variant-numeric: tabular-nums;
  }
  .sort {
    display: inline-flex;
    align-items: center;
    gap: 3px;
    min-height: 24px;
    margin-left: auto;
    padding: 0 6px;
    border: 0;
    border-radius: 5px;
    background: none;
    color: var(--muted);
    font: 500 12px var(--sans);
    cursor: pointer;
  }
  .sort:hover {
    background: color-mix(in oklab, var(--ink) 8%, transparent);
    color: var(--ink);
  }
  .search {
    width: 100%;
    height: 32px;
    margin: 0 0 8px;
    padding: 0 10px;
    border: 1px solid var(--line);
    border-radius: 7px;
    background: var(--paper);
    color: var(--ink);
    font: 13px var(--sans);
  }
  .search::placeholder {
    color: var(--muted);
  }
  .apps {
    display: flex;
    flex-direction: column;
    gap: 1px;
  }
  .app {
    position: relative;
    display: flex;
    align-items: center;
    gap: 9px;
    min-height: 30px;
    padding: 3px 8px;
    border-radius: 6px;
    color: var(--muted);
  }
  .app:hover {
    background: color-mix(in oklab, var(--ink) 6%, transparent);
  }
  .app.on {
    color: var(--ink);
  }
  .app.first-off {
    margin-top: 7px;
  }
  .app.first-off::before {
    content: '';
    position: absolute;
    left: 8px;
    right: 8px;
    top: -4px;
    border-top: 1px solid var(--line);
  }
  .main {
    flex: 1;
    min-width: 0;
    min-height: 24px;
    padding: 0;
    border: 0;
    background: none;
    color: inherit;
    font: inherit;
    text-align: left;
    align-content: center;
  }
  button.main {
    cursor: pointer;
  }
  .on .main {
    font-weight: 600;
  }
  .name {
    display: block;
    overflow: hidden;
    white-space: nowrap;
    text-overflow: ellipsis;
  }
  .state {
    flex: none;
    font-size: 12px;
  }
  .act {
    flex: none;
    display: grid;
    place-items: center;
    width: 24px;
    height: 24px;
    margin-right: -4px;
    padding: 0;
    border: 0;
    border-radius: 5px;
    background: none;
    color: var(--muted);
    opacity: 0;
    cursor: pointer;
  }
  .app:hover .act,
  .act:focus-visible {
    opacity: 1;
  }
  .act:hover {
    background: color-mix(in oklab, var(--ink) 10%, transparent);
    color: var(--ink);
  }
  .act.remove:hover,
  .act.drop:hover {
    color: var(--bad);
  }
  .adds {
    display: flex;
    flex-wrap: wrap;
    gap: 0 12px;
  }
  .add-repos {
    margin: 4px 0 0 4px;
    padding: 6px 4px;
    border: 0;
    background: none;
    color: var(--cable-ink);
    font: 600 13px var(--sans);
    text-align: left;
    cursor: pointer;
  }
  .add-repos:hover {
    text-decoration: underline;
  }
  .act.add {
    color: var(--cable);
  }
  .live {
    flex: none;
    display: grid;
    place-items: center;
    width: 14px;
    height: 14px;
    border-radius: 50%;
    font-size: 12px;
    font-weight: 700;
    line-height: 1;
  }
  .live[data-on='true']::before {
    content: '';
    width: 8px;
    height: 8px;
    border-radius: 50%;
    background: var(--ok);
  }
  .live[data-on='false'] {
    background: var(--bad);
    color: var(--on-accent);
  }
  .empty,
  .note {
    margin: 0;
    padding: 0 8px;
    color: var(--muted);
  }
  footer {
    display: grid;
    grid-template-columns: minmax(0, 1fr);
    gap: 8px;
    margin-top: auto;
    padding: 0 2px;
  }
  .protected .seg label:has(input:checked) {
    background: var(--prod);
    color: var(--on-accent);
  }
  .unsaved {
    margin: 0;
    padding: 0 8px;
    color: var(--warn);
    font-weight: 600;
  }
  footer .warn {
    margin: 0;
    padding: 0 8px;
    color: var(--warn);
    font-size: 12.5px;
  }
  footer .warn :global(.cmd) {
    margin-top: 6px;
  }
  .clone {
    display: grid;
    min-width: 0;
    gap: 8px;
    padding: 8px 10px;
    border: 1px solid color-mix(in oklab, var(--warn) 45%, transparent);
    border-radius: 8px;
    background: color-mix(in oklab, var(--warn) 8%, var(--surface));
    font: 12.5px/1.45 var(--sans);
  }
  .clone p {
    margin: 0;
    overflow-wrap: anywhere;
  }
  .clone .acts {
    display: flex;
    gap: 6px;
  }
  .clone button {
    padding: 4px 10px;
    border: 1px solid var(--line);
    border-radius: 6px;
    background: none;
    color: var(--ink);
    font: 600 12px var(--sans);
    cursor: pointer;
  }
  .clone .do {
    border-color: transparent;
    background: var(--cable);
    color: var(--on-accent);
  }
  .clone button:disabled {
    opacity: 0.6;
    cursor: default;
  }
  .note:empty {
    display: none;
  }
  .note {
    margin-top: 8px;
  }
  :focus-visible {
    outline: 2px solid var(--cable);
    outline-offset: 2px;
  }
</style>
