<script lang="ts">
  import { discovered } from './discover.svelte.ts';
  import Icon from './Icon.svelte';
  import Play from '@lucide/svelte/icons/play';
  import Plus from '@lucide/svelte/icons/plus';
  import Ellipsis from '@lucide/svelte/icons/ellipsis';
  import { flushSync, tick } from 'svelte';
  import { appGroups, type AppGroup } from '../src/core/areas.ts';
  import AreaFilter from './AreaFilter.svelte';
  import { chosen as areaChoice } from './areas.svelte.ts';
  import X from '@lucide/svelte/icons/x';
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
  const onBoard = $derived(board.cards.map(node => node.id));
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
  const hasAreas = $derived(Object.keys(board.areas).length > 0);
  /** With a choice of areas: the apps under the chosen areas, the board's own outside them first. */
  const areaGroups = $derived(
    appGroups(
      { areas: board.areas, apps: Object.fromEntries(board.apps.map(app => [app.id, { areas: app.areas }])) },
      shown.map(app => app.id),
      onBoard,
      areaChoice.ids,
    ),
  );
  const listed = $derived(areaGroups?.groups.reduce((n, group) => n + group.apps.length, 0) ?? shown.length);
  const groups = $derived([
    { title: `On the board · ${String(onBoard.length)}`, apps: shown.filter(app => onBoard.includes(app.id)) },
    { title: 'Not on the board', apps: shown.filter(app => !onBoard.includes(app.id)) },
  ]);
  /** A click on a name: its card shown, an outside system seen in Discover, a clone command copied, or the app added. */
  const pick = (app: StackApp, on: boolean) => {
    if (on) board.show(app.id);
    else if (app.outside) {
      board.goDiscover();
      discovered.picked = [app.id];
      discovered.last = app.id;
    } else if (!app.cloned) void copyClone(app);
    else board.add(app.id);
  };
  /** Added or taken off, the row moves to the other list: the keyboard stays on it. */
  const move = async (id: string, on: boolean) => {
    if (on) board.remove(id);
    else board.add(id);
    await tick();
    document.querySelector<HTMLElement>(`aside .app[data-id="${id}"] .main`)?.focus();
  };
  const hintOf = (app: StackApp, on: boolean) =>
    on
      ? 'Click to show its card.'
      : app.outside
        ? `Does not run on this Mac: ${typeof app.outside === 'string' ? app.outside : 'an outside system'}. Click to see it in Discover, with what it talks to.`
        : !app.cloned
          ? `Not cloned under ${roots}. Click to copy the clone command.`
          : 'Click or drag it onto the board to add it.';

  // The panel's width: dragged by its edge or moved from the keyboard, kept on this Mac, and never so wide the board
  // gets less than 640px.
  const MIN = 280;
  const MAX = 560;
  const WIDE = 300;
  const kept = () => {
    try {
      const n = Number(localStorage.getItem('koppler-side-width'));
      return n >= MIN && n <= MAX ? n : WIDE;
    } catch {
      return WIDE;
    }
  };
  let chosen = $state(kept());
  let inner = $state(innerWidth);
  const cap = $derived(Math.max(MIN, Math.min(MAX, inner - 640)));
  const width = $derived(Math.min(chosen, cap));
  let dragging = $state(false);
  let from = { x: 0, width: 0 };
  const choose = (n: number) => {
    chosen = Math.round(Math.max(MIN, Math.min(cap, n)));
    try {
      localStorage.setItem('koppler-side-width', String(chosen));
    } catch {
      // Not remembered where the browser keeps nothing.
    }
  };
  const grab = (ev: PointerEvent) => {
    (ev.currentTarget as HTMLElement).setPointerCapture(ev.pointerId);
    from = { x: ev.clientX, width };
    dragging = true;
  };
  const drag = (ev: PointerEvent) => {
    if (dragging) chosen = Math.round(Math.max(MIN, Math.min(cap, from.width + ev.clientX - from.x)));
  };
  const letGo = () => {
    if (!dragging) return;
    dragging = false;
    choose(chosen);
  };
  const nudge = (ev: KeyboardEvent) => {
    const by = ev.shiftKey ? 40 : 8;
    if (ev.key === 'ArrowLeft') choose(width - by);
    else if (ev.key === 'ArrowRight') choose(width + by);
    else if (ev.key === 'Enter') choose(WIDE);
    else return;
    ev.preventDefault();
  };

  // Up and down move between the rows; Tab goes into a row's actions.
  const rowStep = (ev: KeyboardEvent) => {
    if (ev.key !== 'ArrowDown' && ev.key !== 'ArrowUp') return;
    ev.preventDefault();
    const row = ev.currentTarget as HTMLButtonElement;
    const all = [...(row.closest('aside')?.querySelectorAll<HTMLButtonElement>('.app .main') ?? [])];
    all[all.indexOf(row) + (ev.key === 'ArrowDown' ? 1 : -1)]?.focus();
  };
  let more = $state<HTMLDivElement>();
  let moreFor = $state<{ app: StackApp; on: boolean } | null>(null);
  let moreOpen = $state(false);
  let edgeFocused = $state(false);
  const openMore = (app: StackApp, on: boolean, from: HTMLElement) => {
    moreFor = { app, on };
    // Drawn for this app before it is placed and focused.
    flushSync();
    if (!more) return;
    const at = from.getBoundingClientRect();
    more.style.top = `${String(at.bottom + 4)}px`;
    more.style.left = `${String(Math.max(8, at.right - 220))}px`;
    more.showPopover();
    const tall = more.getBoundingClientRect().height;
    if (at.bottom + 4 + tall > innerHeight - 8) more.style.top = `${String(Math.max(8, at.top - 4 - tall))}px`;
    more.querySelector<HTMLButtonElement>('button')?.focus();
  };
  const menuStep = (ev: KeyboardEvent) => {
    if (ev.key !== 'ArrowDown' && ev.key !== 'ArrowUp') return;
    ev.preventDefault();
    const all = [...(more?.querySelectorAll<HTMLButtonElement>('button') ?? [])];
    const at = all.indexOf(document.activeElement as HTMLButtonElement);
    all[(at + (ev.key === 'ArrowDown' ? 1 : -1) + all.length) % all.length]?.focus();
  };
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

{#snippet sorter()}
  <button class="sort" type="button" onclick={toggleSort} title={sortHint} aria-label={sortHint}>
    Sort: {sort === 'name' ? 'A–Z' : 'Added'}
  </button>
{/snippet}

{#snippet appRow(app: StackApp, extra?: AppGroup['apps'][number])}
  {@const on = onBoard.includes(app.id)}
  {@const runnable = !app.outside && app.cloned}
  {@const up = on ? live.up(app.id) : null}
  <div class="app" class:on role="listitem" data-id={app.id}>
    <span class="kind">{app.kindLabel}</span>
    <button
      class="main"
      type="button"
      title="{app.name}. {hintOf(app, on)}"
      draggable={runnable && !on}
      onkeydown={rowStep}
      ondragstart={ev => {
        ev.dataTransfer?.setData('text/app', app.id);
      }}
      onclick={() => {
        pick(app, on);
      }}
    >
      <span class="name">{app.name}</span>
      {#if extra?.outside}<span class="state">Outside your areas</span>{/if}
      {#if extra?.also.length}<span class="also">also {extra.also.join(' · ')}</span>{/if}
      {#if app.outside}<span class="state">Outside</span>{:else if !app.cloned}<span class="state">Not cloned</span
        >{/if}
    </button>
    <span class="light">
      {#if on}
        <span
          class="led"
          data-state={up === true ? 'running' : up === false ? 'failed' : undefined}
          role="img"
          aria-label={up === true ? 'Running' : up === false ? 'Not answering' : 'Not running'}
        ></span>
      {/if}
    </span>
    <span class="row-acts">
      {#if runnable}
        <button
          class="alone"
          type="button"
          aria-label="Run {app.name} alone"
          title="Run alone: just this app and its tunnels, on a board of its own"
          onclick={() => {
            runs.alone(app.id);
          }}><Icon of={Play} size={11} />Run alone</button
        >
        {#if on}
          <button
            type="button"
            aria-label="Remove {app.name} from the board"
            title="Remove from the board"
            onclick={() => void move(app.id, true)}><Icon of={X} size={12} /></button
          >
        {:else}
          <button
            type="button"
            aria-label="Add {app.name} to the board"
            title="Add to the board"
            onclick={() => void move(app.id, false)}><Icon of={Plus} size={12} /></button
          >
        {/if}
      {/if}
      <button
        type="button"
        aria-label="More for {app.name}"
        aria-haspopup="menu"
        aria-expanded={moreOpen && moreFor?.app.id === app.id}
        title="More"
        onclick={ev => {
          openMore(app, on, ev.currentTarget);
        }}><Icon of={Ellipsis} size={13} /></button
      >
    </span>
  </div>
{/snippet}

<svelte:window bind:innerWidth={inner} />
<aside id="side-apps" aria-label="Apps" class:protected={board.protected} style:width="{width}px">
  <section aria-labelledby="apps-title">
    <h2 id="apps-title">
      Apps
      {#if areaGroups}
        <span class="count">{listed} of {board.apps.length}</span>
      {:else if board.apps.length}
        <span class="count">{onBoard.length} of {board.apps.length} on the board</span>
      {/if}
      {#if hasAreas}<span class="filter"><AreaFilter /></span>{:else}{@render sorter()}{/if}
    </h2>
    <div class="find">
      <input
        class="search"
        type="search"
        bind:value={search}
        placeholder="Find or filter: a name, .net, lambda"
        aria-label="Find an app by name or kind"
        autocomplete="off"
        spellcheck="false"
      />
      {#if hasAreas}{@render sorter()}{/if}
    </div>
    {#if areaGroups}
      {#each areaGroups.groups as group (group.title)}
        <h3 class="group">{group.title}</h3>
        <div class="apps" role="list" aria-label={group.title}>
          {#each group.apps as one (one.id)}
            {@const app = board.apps.find(each => each.id === one.id)}
            {#if app}{@render appRow(app, one)}{/if}
          {/each}
        </div>
      {/each}
      {#if areaGroups.hidden}
        <p class="hidden-line">
          <span>{areaGroups.hidden} {areaGroups.hidden === 1 ? 'app' : 'apps'} in other areas</span>
          <button
            type="button"
            onclick={() => {
              areaChoice.set([]);
            }}>Show all</button
          >
        </p>
      {/if}
    {:else}
      {#each groups as group (group.title)}
        {#if group.apps.length}
          <h3 class="group">{group.title}</h3>
          <div class="apps" role="list" aria-label={group.title}>
            {#each group.apps as app (app.id)}
              {@render appRow(app)}
            {/each}
          </div>
        {/if}
      {/each}
    {/if}
    {#if !listed}
      <p class="empty">{board.apps.length ? 'No app matches.' : 'No apps in this stack yet.'}</p>
    {/if}
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
<!-- A focusable separator is a window splitter (WAI-ARIA), a widget the checker takes for static. -->
<!-- svelte-ignore a11y_no_noninteractive_tabindex, a11y_no_noninteractive_element_interactions -->
<div
  class="edge"
  class:dragging
  class:least={width <= MIN}
  class:most={width >= cap}
  role="separator"
  aria-orientation="vertical"
  aria-controls="side-apps"
  aria-label="Side panel width"
  aria-valuemin={MIN}
  aria-valuemax={cap}
  aria-valuenow={width}
  tabindex="0"
  onpointerdown={grab}
  onpointermove={drag}
  onpointerup={letGo}
  onpointercancel={letGo}
  ondblclick={() => {
    choose(WIDE);
  }}
  onkeydown={nudge}
  onfocus={ev => {
    edgeFocused = (ev.currentTarget as HTMLElement).matches(':focus-visible');
  }}
  onblur={() => {
    edgeFocused = false;
  }}
>
  {#if dragging || edgeFocused}<span class="size">{width} px</span>{/if}
</div>
<div
  bind:this={more}
  class="more-menu"
  popover
  role="menu"
  tabindex="-1"
  aria-label="More"
  onkeydown={menuStep}
  ontoggle={ev => {
    moreOpen = ev.newState === 'open';
  }}
>
  {#if moreFor}
    {@const app = moreFor.app}
    {#if !app.outside && app.cloned}
      <button
        type="button"
        role="menuitem"
        onclick={() => {
          more?.hidePopover();
          runs.alone(app.id);
        }}>Run alone</button
      >
      <button
        type="button"
        role="menuitem"
        onclick={() => {
          more?.hidePopover();
          void move(app.id, !!moreFor?.on);
        }}>{moreFor.on ? 'Remove from the board' : 'Add to the board'}</button
      >
    {/if}
    <button
      type="button"
      role="menuitem"
      onclick={() => {
        more?.hidePopover();
        void dialogs.settings?.open({ title: app.name, path: `apps.${app.id}` });
      }}>Open settings</button
    >
    <button
      type="button"
      role="menuitem"
      onclick={() => {
        more?.hidePopover();
        askDrop(app);
      }}>Remove from the stack…</button
    >
  {/if}
</div>

<style>
  aside {
    flex-shrink: 0;
    min-width: 0;
    display: flex;
    flex-direction: column;
    gap: 18px;
    overflow: hidden auto;
    scrollbar-width: thin;
    padding: 16px 8px 14px;
    border-right: 1px solid var(--line);
    background: var(--panel);
    color: var(--ink);
    font: 13px/1.4 var(--sans);
  }
  h2 {
    display: flex;
    align-items: baseline;
    gap: 6px;
    margin: 0 0 8px;
    padding: 0 8px;
    color: var(--ink);
    font: 600 13px var(--sans);
  }
  .count {
    color: var(--ink-muted);
    font: 400 12px var(--sans);
    font-variant-numeric: tabular-nums;
  }
  .sort {
    margin-left: auto;
    padding: 0;
    border: 0;
    background: none;
    color: var(--ink-muted);
    font: 400 12px var(--sans);
    text-decoration: underline;
    text-underline-offset: 3px;
    cursor: pointer;
  }
  .sort:hover {
    color: var(--ink);
  }
  .filter {
    margin-left: auto;
  }
  .find {
    display: flex;
    align-items: center;
    gap: 10px;
    margin: 0 8px 8px;
  }
  .find .search {
    flex: 1;
    width: auto;
    margin: 0;
  }
  .also {
    color: var(--ink-muted);
    font: 400 10.5px var(--mono);
  }
  /* What the areas hide: one dashed line, with the way back to all of them. */
  .hidden-line {
    display: flex;
    align-items: center;
    justify-content: space-between;
    gap: 8px;
    margin: 8px 0 0;
    padding: 8px;
    border-top: 1px dashed var(--line-strong);
    border-bottom: 1px dashed var(--line-strong);
    color: var(--ink-muted);
    font: 400 12px var(--sans);
  }
  .hidden-line button {
    padding: 0;
    border: 0;
    background: none;
    color: var(--ink);
    font: inherit;
    text-decoration: underline;
    text-underline-offset: 3px;
    cursor: pointer;
  }
  .search {
    width: calc(100% - 16px);
    height: 32px;
    margin: 0 8px 8px;
    padding: 0 10px;
    border: 1px solid var(--line);
    background: var(--paper);
    color: var(--ink);
    font: 13px var(--sans);
  }
  .search::placeholder {
    color: var(--muted);
  }
  .group {
    margin: 10px 0 4px;
    padding: 0 8px;
    color: var(--ink-muted);
    font: 600 11px var(--sans);
  }
  .apps {
    display: flex;
    flex-direction: column;
  }
  /* Kind | name | light, as the Design System's list draws it; the actions take no room until asked for. */
  .app {
    position: relative;
    display: grid;
    grid-template-columns: 48px minmax(0, 1fr) 10px;
    align-items: start;
    gap: 8px;
    padding: 6px 8px;
    color: var(--ink-muted);
    font-size: 13.5px;
  }
  .app:hover,
  .app:focus-within {
    background: color-mix(in oklab, var(--ink) 6%, var(--panel));
  }
  .app:has(.main:focus-visible) {
    outline: 2px solid var(--ink);
    outline-offset: -2px;
  }
  .app.on {
    color: var(--ink);
  }
  .kind {
    padding-top: 3px;
    overflow: hidden;
    color: var(--ink-muted);
    font: 500 9.5px var(--mono);
    letter-spacing: 0.04em;
    text-overflow: ellipsis;
    text-transform: uppercase;
    white-space: nowrap;
  }
  /* As wide as the name, so the actions shown over the row's end leave it to click. */
  .main {
    display: grid;
    justify-self: start;
    max-width: 100%;
    min-width: 0;
    padding: 0;
    border: 0;
    background: none;
    color: inherit;
    font: inherit;
    text-align: left;
    cursor: pointer;
  }
  .main:focus-visible {
    outline: none;
  }
  /* Two lines, then an ellipsis; a name with no spaces breaks anywhere. */
  .name {
    display: -webkit-box;
    overflow: hidden;
    -webkit-box-orient: vertical;
    -webkit-line-clamp: 2;
    line-clamp: 2;
    overflow-wrap: anywhere;
  }
  .state {
    color: var(--ink-muted);
    font: 400 11px var(--sans);
  }
  .light {
    display: grid;
    place-items: center;
    height: 19px;
  }
  .light .led {
    width: 10px;
    height: 10px;
  }
  /* Over the end of the name's first line, on the panel's colour, left of the light. */
  .row-acts {
    position: absolute;
    top: 3px;
    right: 34px;
    display: flex;
    align-items: center;
    gap: 2px;
    padding-left: 6px;
    border-left: 1px solid var(--line);
    background: color-mix(in oklab, var(--ink) 6%, var(--panel));
    visibility: hidden;
  }
  .app:hover .row-acts,
  .app:focus-within .row-acts {
    visibility: visible;
  }
  .row-acts button {
    display: inline-flex;
    align-items: center;
    gap: 5px;
    height: 24px;
    min-width: 24px;
    justify-content: center;
    padding: 0 6px;
    border: 0;
    background: none;
    color: var(--ink);
    font: 600 12px var(--sans);
    cursor: pointer;
  }
  .row-acts button:hover {
    background: color-mix(in oklab, var(--ink) 10%, transparent);
  }
  .row-acts button:focus-visible {
    outline: 2px solid var(--ink);
    outline-offset: -2px;
  }
  /* The panel's own hairline is the handle: an 8px hit area centred on it, brighter on hover, focus and drag. */
  .edge {
    position: relative;
    z-index: 6;
    flex: none;
    width: 8px;
    margin: 0 -4px;
    cursor: col-resize;
    outline: none;
  }
  .edge::after {
    content: '';
    position: absolute;
    top: 0;
    bottom: 0;
    left: 3px;
    width: 1px;
  }
  .edge:hover::after {
    background: var(--ink);
  }
  .edge:focus-visible::after {
    left: 2px;
    width: 4px;
    border: 1px solid var(--ink);
  }
  .edge.dragging::after {
    width: 2px;
    background: var(--ink);
  }
  .edge.least {
    cursor: e-resize;
  }
  .edge.most {
    cursor: w-resize;
  }
  .edge.least.most {
    cursor: default;
  }
  .size {
    position: absolute;
    top: 12px;
    left: 14px;
    padding: 2px 6px;
    border: 1px solid var(--line-strong);
    background: var(--panel);
    color: var(--ink);
    font: 11px var(--mono);
    white-space: nowrap;
  }
  .more-menu {
    position: fixed;
    inset: auto;
    width: 220px;
    margin: 0;
    padding: 4px;
    border: 1px solid var(--line-strong);
    background: var(--surface);
    box-shadow: var(--lift);
  }
  .more-menu button + button {
    border-top: 1px solid var(--line);
  }
  .more-menu button {
    display: block;
    width: 100%;
    padding: 7px 10px;
    border: 0;
    background: none;
    color: var(--ink);
    font: 400 13px var(--sans);
    text-align: left;
    cursor: pointer;
  }
  .more-menu button:hover,
  .more-menu button:focus-visible {
    background: color-mix(in oklab, var(--ink) 8%, transparent);
    outline: none;
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
    color: var(--ink);
    font: 400 13px var(--sans);
    text-align: left;
    text-decoration: underline;
    text-underline-offset: 3px;
    cursor: pointer;
  }
  .add-repos:hover {
    color: var(--local);
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
  .unsaved {
    margin: 0;
    padding: 0 8px;
    color: var(--warn);
    font-weight: 600;
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
    outline: 2px solid var(--ink);
    outline-offset: 2px;
  }
</style>
