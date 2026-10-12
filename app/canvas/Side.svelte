<script lang="ts">
  import KindIcon from './KindIcon.svelte';
  import Settings from './Settings.svelte';
  import { board, type StackApp } from './board.svelte.ts';
  import { live } from './live.svelte.ts';

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
  const onBoard = $derived(board.nodes.map(node => node.id));
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
    <div class="seg" role="radiogroup" aria-label="Environment">
      {#each board.envs as env (env)}
        <label><input type="radio" name="env" value={env} bind:group={board.env} />{env.toUpperCase()}</label>
      {/each}
    </div>
  </div>
  <section aria-labelledby="apps-title">
    <h2 id="apps-title">
      Apps
      {#if board.apps.length}
        <span class="count">{onBoard.length} of {board.apps.length} on the board</span>
      {/if}
      <button class="sort" type="button" onclick={toggleSort} title={sortHint} aria-label={sortHint}>
        <svg viewBox="0 0 12 12" width="11" height="11" aria-hidden="true"><path d="M6 2v8M3 7l3 3 3-3" /></svg>
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
                board.show(app.id);
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
                board.remove(app.id);
              }}
            >
              <svg viewBox="0 0 16 16" width="11" height="11" aria-hidden="true"><path d="M4 4l8 8M12 4l-8 8" /></svg>
            </button>
          {:else if app.outside}
            <span class="main" title="Does not run on this Mac: {app.outside}"
              ><span class="name">{app.name}</span></span
            >
            <span class="state">outside</span>
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
              class="act add"
              type="button"
              aria-label="Add {app.name} to the board"
              title="Add to the board"
              onclick={() => {
                board.add(app.id);
              }}
            >
              <svg viewBox="0 0 16 16" width="12" height="12" aria-hidden="true"><path d="M8 3v10M3 8h10" /></svg>
            </button>
          {/if}
        </div>
      {:else}
        <p class="empty">{board.apps.length ? 'No app matches.' : 'No apps in this stack yet.'}</p>
      {/each}
    </div>
    <p class="note" role="status">{copied}</p>
  </section>
  <footer>
    {#if board.unsaved}
      <p class="unsaved" role="alert">Not saved: the canvas server is not answering. Changes stay on this page.</p>
    {/if}
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
    overflow-y: auto;
    scrollbar-width: thin;
    padding: 0 12px 14px;
    border-right: 1px solid var(--line);
    background: var(--panel);
    color: var(--ink);
    font: 13px/1.4 var(--sans);
  }
  .head {
    position: sticky;
    top: 0;
    z-index: 2;
    margin: 0 -12px;
    padding: 12px;
    border-bottom: 1px solid var(--line);
    background: var(--panel);
  }
  .seg {
    display: flex;
    gap: 2px;
    padding: 2px;
    border: 1px solid var(--line);
    border-radius: 8px;
    background: color-mix(in oklab, var(--ink) 5%, transparent);
  }
  .seg label {
    position: relative;
    flex: 1;
    padding: 3px 12px;
    border-radius: 6px;
    color: var(--muted);
    font-weight: 600;
    text-align: center;
    white-space: nowrap;
  }
  .seg input {
    position: absolute;
    inset: 0;
    margin: 0;
    opacity: 0;
    cursor: pointer;
  }
  .seg label:has(input:checked) {
    background: var(--surface);
    color: var(--ink);
    box-shadow:
      0 0 0 1px var(--line),
      0 1px 2px rgb(0 0 0 / 0.12);
  }
  .seg label:has(input:focus-visible) {
    outline: 2px solid var(--cable);
    outline-offset: -2px;
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
  svg path {
    fill: none;
    stroke: currentColor;
    stroke-width: 1.6;
    stroke-linecap: round;
    stroke-linejoin: round;
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
  .act.remove:hover {
    color: var(--bad);
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
