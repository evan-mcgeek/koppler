<script lang="ts">
  import Icon from './Icon.svelte';
  import X from '@lucide/svelte/icons/x';
  // The board on screen, by name: a menu of the team's boards and the user's own, to open, rename, copy, share or
  // delete one, start a new one, or open one from a file or a link.
  import type { StoredPreset } from '../src/core/presets.ts';
  import { bar } from './bar.svelte.ts';
  import { boardArea, boardGroups } from '../src/core/areas.ts';
  import AreaFilter from './AreaFilter.svelte';
  import { chosen as areaChoice } from './areas.svelte.ts';
  import { board } from './board.svelte.ts';
  import { ago, openBoard, openFile, openLink } from './boards.ts';
  import { post } from './data.ts';
  import { runs } from './run.svelte.ts';
  import { toasts } from './toast.svelte.ts';

  const OPEN_HINT = 'Or drop a board .json file anywhere on the page.';
  const WIDTH = 340;
  const id = $props.id();
  let picker = $state<HTMLButtonElement>();
  let list = $state<HTMLDivElement>();
  let file = $state<HTMLInputElement>();
  let find = $state<HTMLInputElement>();
  let query = $state('');
  /** The bar too narrow for the stack's name: it is the menu's first row instead. */
  const stackRow = $derived(bar.stackOut);
  const shows = (preset: StoredPreset) => preset.name.toLowerCase().includes(query.trim().toLowerCase());
  const hasAreas = $derived(Object.keys(board.areas).length > 0);
  const facts = $derived({
    areas: board.areas,
    apps: Object.fromEntries(board.apps.map(app => [app.id, { areas: app.areas }])),
  });
  const areaOf = (preset: StoredPreset) =>
    boardArea(facts, { nodes: preset.nodes, ...(typeof preset['area'] === 'string' && { area: preset['area'] }) });
  /** Team boards by area, those the chosen areas hide counted; a search looks through every board. */
  const teams = $derived(boardGroups(facts, board.team.filter(shows), areaChoice.ids));
  const shownTeams = $derived(new Set(teams.groups.flatMap(group => group.boards.map(one => one.name))));
  const hiddenMatches = $derived(board.team.filter(one => shows(one) && !shownTeams.has(one.name)));
  /** The board on screen, kept at the top while the chosen areas hide it. */
  const pinned = $derived(
    !query.trim() && board.name && !shownTeams.has(board.name)
      ? board.team.find(one => one.name === board.name)
      : undefined,
  );
  /** The board on screen's area, when the chosen areas leave it out. */
  const outside = $derived.by(() => {
    if (!hasAreas || !areaChoice.narrows) return undefined;
    const here = [...board.own, ...board.team].find(one => one.name === board.name);
    const id = here && areaOf(here).id;
    return id && !areaChoice.ids.includes(id) ? (board.areas[id]?.name ?? id) : undefined;
  });
  const joined = (names: string[]) => new Intl.ListFormat('en', { type: 'conjunction' }).format(names);
  /** "(local)" or "(mine)" after a board's name: set apart, so a long name keeps it. */
  const SUFFIX = / \((local|mine)\)$/;
  let open = $state(false);
  let named = $state('');
  let link = $state('');
  let hint = $state({ text: OPEN_HINT, warn: false });
  let busy = $state(false);
  const mine = $derived(board.own.some(one => one.name === board.name));
  /** A board opened from a link or a file, read again from there: it replaces the one kept, and opens. */
  const reload = async (from: string, name: string) => {
    const why = await openLink(from);
    toasts.show(why ? `Cannot reload ${name}. ${why}` : `Reloaded ${name} from ${from}.`, why ? 'warning' : 'message');
  };
  const shared = $derived(!mine && board.team.some(one => one.name === board.name));
  const label = $derived(
    board.name ?? (board.scratch && board.nodes[0] ? `${board.nodes[0].data.name} alone` : 'New board'),
  );
  const options = () => [...(list?.querySelectorAll<HTMLButtonElement>('.row > button:first-child') ?? [])];
  const close = () => list?.hidePopover();
  const place = () => {
    const at = picker?.getBoundingClientRect();
    if (!at || !list) return;
    list.style.top = `${String(at.bottom + 4)}px`;
    // Its left edge on the board's name, shifted left when that would run past the window.
    list.style.left = `${String(Math.max(8, Math.min(at.left, innerWidth - WIDTH - 8)))}px`;
    find?.focus();
  };
  // Before it shows, not after: what is typed next must not be wiped by a late reset.
  const fresh = (ev: ToggleEvent) => {
    if (ev.newState !== 'open') return;
    query = '';
    named = board.name ?? '';
    link = '';
    hint = { text: OPEN_HINT, warn: false };
  };
  const step = (ev: KeyboardEvent) => {
    if (ev.key === 'ArrowDown' && ev.target === find) {
      ev.preventDefault();
      options()[0]?.focus();
      return;
    }
    if (ev.key === 'ArrowUp' && ev.target === options()[0]) {
      ev.preventDefault();
      find?.focus();
      return;
    }
    if ((ev.key !== 'ArrowDown' && ev.key !== 'ArrowUp') || (ev.target as Element).matches('input')) return;
    ev.preventDefault();
    const all = options();
    const at = all.indexOf(document.activeElement as HTMLButtonElement);
    all[(at + (ev.key === 'ArrowDown' ? 1 : -1) + all.length) % all.length]?.focus();
  };
  const choose = (preset: StoredPreset) => {
    close();
    if (preset.name !== board.name) openBoard(preset);
  };
  const size = (preset: StoredPreset) => {
    const apps = Object.keys(preset.nodes).length;
    return `${String(apps)} ${apps === 1 ? 'app' : 'apps'}`;
  };
  const rename = (ev: SubmitEvent) => {
    ev.preventDefault();
    const why = board.rename(named);
    if (why) hint = { text: why, warn: true };
    else close();
  };
  // Shared with the team: a pull request on the stack's repo on GitHub, after a review that says where it goes. A
  // stack that is not on GitHub keeps it in its file here, to commit.
  const share = async (preset: StoredPreset) => {
    close();
    const value = board.forTeam(preset);
    const where = await post<{ repo?: string; local?: true }>('board-share', { preset: value, check: true });
    if ('error' in where) {
      toasts.show(`Could not share ${preset.name}: ${where.error}`, 'warning');
      return;
    }
    const replaces = board.team.some(one => one.name === preset.name);
    runs.review = {
      title: `Share ${preset.name} with the team`,
      sub: where.repo
        ? `Opens a pull request on ${where.repo} that ${replaces ? 'updates this team board' : 'adds this board to the team boards'}. Your team gets it once the pull request is merged; nothing on this Mac changes.`
        : `This stack is not on GitHub, so the board is ${replaces ? 'updated' : 'added'} among the team boards in its file here. Commit the stack so your team gets it.`,
      notices: [],
      groups: [{ verb: 'keeps', label: replaces ? 'Updates' : 'Adds', items: [{ name: preset.name, notes: [] }] }],
      ok: where.repo ? 'Open pull request' : 'Add to team boards',
      prod: false,
      blocked: false,
      confirm: () => {
        if (where.repo) toasts.show('Opening the pull request…');
        void post<{ url?: string; local?: true }>('board-share', { preset: value }).then(said => {
          if ('error' in said) toasts.show(`Could not share ${preset.name}: ${said.error}`, 'warning');
          else if (said.url)
            toasts.show(`Pull request opened for ${preset.name}`, 'message', {
              label: 'View',
              run: () => window.open(said.url, '_blank', 'noopener'),
            });
          else {
            const at = board.team.findIndex(one => one.name === preset.name);
            board.keptForTeam(at < 0 ? board.team.length : at, value);
            toasts.show(`${preset.name} is a team board now. Commit the stack's repo, so your team gets it.`);
          }
        });
      },
    };
  };
  // Deleting asks first and names what goes; the board then waits in Recently deleted.
  const askDelete = (preset: StoredPreset) => {
    close();
    const cables = preset.edges.length;
    const onScreen = board.name === preset.name;
    runs.review = {
      title: `Delete board "${preset.name}"?`,
      sub: `${size(preset)} and ${String(cables)} ${cables === 1 ? 'cable' : 'cables'}, with their branches and notes.${onScreen ? ' It is the board on screen, so the screen empties.' : ''}`,
      notices: [{ text: 'It moves to Recently deleted at the bottom of the board menu, where you can restore it.' }],
      groups: [],
      ok: 'Delete board',
      prod: true,
      blocked: false,
      confirm: () => {
        board.deleteBoard(preset.name);
        toasts.show(`Deleted ${preset.name}`);
      },
    };
  };
  const fromLink = async (ev: SubmitEvent) => {
    ev.preventDefault();
    if (!link.trim() || busy) return;
    busy = true;
    hint = { text: 'Opening…', warn: false };
    const why = await openLink(link.trim());
    busy = false;
    if (why) hint = { text: why, warn: true };
    else close();
  };
</script>

{#snippet boardRow(preset: StoredPreset, mine: boolean, elsewhere = false)}
  {@const area = hasAreas ? areaOf(preset) : undefined}
  <div class="row" class:elsewhere>
    <button
      type="button"
      aria-current={preset.name === board.name}
      title={typeof preset['source'] === 'string'
        ? `Opened from ${preset['source']}`
        : elsewhere
          ? 'Hidden by your areas. Opening it leaves them as they are.'
          : undefined}
      onclick={() => {
        choose(preset);
      }}
    >
      <span class="here" aria-hidden="true"></span><span class="name">{preset.name.replace(SUFFIX, '')}</span
      >{#if SUFFIX.test(preset.name)}<span class="suffix">{SUFFIX.exec(preset.name)?.[0]}</span>{/if}
      {#if area?.by === 'hand' && !mine}<span class="meta">set by hand</span>{/if}
      {#if hasAreas && (mine || elsewhere) && area?.id}<span class="area">{board.areas[area.id]?.name}</span
        >{:else if !hasAreas}<span class="meta">{size(preset)}</span>{/if}
    </button>
    {#if mine && typeof preset['source'] === 'string' && /^(https?:|\/)/.test(preset['source'])}
      {@const from = preset['source']}
      <button
        class="act"
        type="button"
        aria-label="Reload {preset.name}"
        title="Read it again from {from}"
        onclick={() => void reload(from, preset.name)}>Reload</button
      >
    {/if}
    {#if mine}
      <button
        class="act"
        type="button"
        aria-label="Share {preset.name} with the team"
        title="Propose it as a team board of the stack: a pull request on the stack's repo"
        onclick={() => void share(preset)}>Share with team</button
      >
      <button
        class="act"
        type="button"
        aria-label="Delete {preset.name}"
        title="Delete"
        onclick={() => {
          askDelete(preset);
        }}><Icon of={X} size={14} /></button
      >
    {/if}
  </div>
{/snippet}

<button
  bind:this={picker}
  class="picker"
  class:chosen={!!board.name}
  type="button"
  aria-label="Board: {label}"
  aria-haspopup="dialog"
  aria-expanded={open}
  title={mine
    ? 'Your board, saved on this Mac as you change it'
    : shared
      ? 'Team board, from the stack. Changing it makes a copy of your own.'
      : 'Saved as soon as it has an app'}
  popovertarget={id}
>
  <span class="name">{label.replace(SUFFIX, '')}</span>
  {#if SUFFIX.test(label)}<span class="suffix" title="Changed on this Mac">{SUFFIX.exec(label)?.[0]}</span>{/if}
  {#if board.feature}<span class="kind">Feature board</span>{/if}
  {#if outside}<span class="out-area" title="Outside the areas you chose; nothing on it is hidden">{outside}</span>{/if}
</button>
<div
  bind:this={list}
  {id}
  class="menu"
  popover
  role="dialog"
  tabindex="-1"
  aria-label="Boards"
  onkeydown={step}
  onbeforetoggle={fresh}
  ontoggle={ev => {
    open = ev.newState === 'open';
    if (open) place();
  }}
>
  {#if stackRow}
    <div class="stack-row">
      <span class="label">Stack</span><span class="name">{board.stack}</span>
      <button
        type="button"
        onclick={() => {
          close();
          document.querySelector<HTMLElement>('[popover][aria-label="Stacks"]')?.showPopover();
        }}>Switch stack</button
      >
    </div>
  {/if}
  <input
    bind:this={find}
    bind:value={query}
    class="find"
    type="search"
    aria-label="Find a board"
    placeholder="Find a board"
    autocomplete="off"
    spellcheck="false"
  />
  {#if hasAreas}
    <div class="area-row">
      <AreaFilter />
      {#if areaChoice.narrows}<button
          class="show-all"
          type="button"
          onclick={() => {
            areaChoice.set([]);
          }}>Show all</button
        >{/if}
    </div>
  {/if}
  {#if pinned}
    <p>Current board</p>
    {@render boardRow(pinned, false)}
  {/if}
  {#if teams.groups.length}<p>Team boards</p>{/if}
  {#each teams.groups as group (group.title)}
    {#if hasAreas}<p class="sub">{group.title}</p>{/if}
    {#each group.boards.filter(one => one !== pinned) as preset (preset.name)}
      {@render boardRow(preset, false)}
    {/each}
  {/each}
  {#if query.trim() && hiddenMatches.length}
    <p>In other areas</p>
    {#each hiddenMatches as preset (preset.name)}
      {@render boardRow(preset, false, true)}
    {/each}
  {:else if !query.trim() && teams.hidden.count}
    <p class="hidden-line">
      <span
        >{teams.hidden.count}
        {teams.hidden.count === 1 ? 'team board' : 'team boards'}{teams.hidden.areas.length <= 3
          ? ` in ${joined(teams.hidden.areas)}`
          : ''}</span
      >
      <button
        type="button"
        onclick={() => {
          areaChoice.set([]);
        }}>Show all</button
      >
    </p>
  {/if}
  {#if board.own.some(shows)}<p>Your boards</p>{/if}
  {#each board.own.filter(shows) as preset (preset.name)}
    {@render boardRow(preset, true)}
  {/each}
  {#if !board.team.length && !board.own.length}
    <p class="none">No boards yet. A board is kept as soon as it has an app.</p>
  {:else if query.trim() && !board.team.some(shows) && !board.own.some(shows)}
    <p class="none">No board is called that.</p>
  {/if}
  <div class="strip">
    <div class="acts">
      <button
        type="button"
        onclick={() => {
          close();
          board.newBoard();
        }}>New board</button
      >
      <button
        type="button"
        title="A board for one feature: its request, and the steps it takes through the stack, read in Discover"
        onclick={() => {
          close();
          board.newFeature();
        }}>New feature board</button
      >
      <button
        type="button"
        disabled={!board.nodes.length}
        onclick={() => {
          close();
          board.duplicate();
        }}>Duplicate</button
      >
    </div>
    {#if mine}
      <form onsubmit={rename}>
        <input type="text" aria-label="Name of this board" maxlength="80" bind:value={named} />
        <button type="submit" disabled={named.trim() === board.name}>Rename</button>
      </form>
    {/if}
    <form onsubmit={fromLink}>
      <input
        type="text"
        aria-label="Open a board from a link"
        placeholder="Paste a GitHub link to a board file"
        bind:value={link}
      />
      {#if link.trim()}
        <button type="submit" disabled={busy}>Open</button>
      {:else}
        <button type="button" onclick={() => file?.click()}>Open a file…</button>
      {/if}
    </form>
    <input
      bind:this={file}
      type="file"
      accept=".json,application/json"
      hidden
      onchange={() => {
        close();
        void openFile(file?.files?.[0]);
        if (file) file.value = '';
      }}
    />
    <p class="hint" class:warn={hint.warn} role="status">{hint.text}</p>
  </div>
  {#if board.trash.length}
    <details>
      <summary>Recently deleted ({board.trash.length})</summary>
      {#each board.trash as gone (gone.name + gone.deleted)}
        <div class="row gone">
          <span class="name" title={gone.name}>{gone.name}</span><span class="meta">{ago(gone.deleted)}</span>
          <button
            class="act"
            type="button"
            aria-label="Restore {gone.name}"
            onclick={() => {
              board.restore(gone);
            }}>Restore</button
          >
        </div>
      {/each}
    </details>
  {/if}
</div>

<style>
  .picker {
    position: relative;
    display: flex;
    align-items: center;
    gap: 8px;
    width: 100%;
    height: 32px;
    padding: 0 30px 0 10px;
    border: 1px solid var(--line);
    border-radius: 0;
    background: var(--paper);
    color: var(--muted);
    font: 600 13px var(--sans);
    text-align: left;
    cursor: pointer;
  }
  .picker.chosen {
    color: var(--ink);
  }
  .picker::after {
    content: '';
    position: absolute;
    top: 50%;
    right: 12px;
    width: 6px;
    height: 6px;
    border-right: 1.5px solid var(--muted);
    border-bottom: 1.5px solid var(--muted);
    transform: translateY(-70%) rotate(45deg);
  }
  .picker:hover,
  .picker[aria-expanded='true'] {
    border-color: color-mix(in oklab, var(--cable) 55%, var(--line));
  }
  .name {
    min-width: 0;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }
  .kind {
    flex: none;
    color: var(--ink-muted);
    font: 400 12px var(--sans);
  }
  .suffix {
    flex: none;
    color: var(--ink-muted);
    font: 400 13px var(--sans);
  }
  .menu {
    position: fixed;
    inset: auto;
    width: 340px;
    max-height: min(480px, calc(100vh - 120px));
    margin: 0;
    padding: 4px;
    overflow-y: auto;
    border: 1px solid var(--line);
    border-radius: 0;
    background: var(--surface);
    box-shadow: var(--lift);
  }
  .menu p {
    margin: 0;
    padding: 8px 10px 4px;
    color: var(--muted);
    font: 600 11px var(--sans);
  }
  .menu p.none {
    padding-bottom: 8px;
    font-weight: 400;
    font-size: 13px;
  }
  .menu button {
    display: flex;
    align-items: center;
    gap: 8px;
    width: 100%;
    padding: 7px 10px;
    border: 0;
    border-radius: 0;
    background: none;
    color: var(--ink);
    font: 600 13px var(--sans);
    text-align: left;
    cursor: pointer;
  }
  .menu button:hover,
  .menu button:focus-visible {
    background: color-mix(in oklab, var(--ink) 7%, transparent);
    outline: none;
  }
  .stack-row {
    display: flex;
    align-items: center;
    gap: 8px;
    margin: 0 0 4px;
    padding: 4px 4px 8px 10px;
    border-bottom: 1px solid var(--line);
  }
  .stack-row .label {
    color: var(--muted);
    font: 600 11px var(--sans);
  }
  .stack-row .name {
    flex: 1;
    font: 600 13px var(--sans);
  }
  .menu .stack-row button {
    width: auto;
    font-weight: 500;
    font-size: 12px;
  }
  /* Dashed: the system's mark for what is not in your view. */
  .out-area {
    flex: none;
    padding: 1px 6px;
    border: 1px dashed var(--line-strong);
    color: var(--ink-muted);
    font: 400 11px var(--mono);
  }
  .area-row {
    display: flex;
    align-items: center;
    justify-content: space-between;
    gap: 8px;
    margin: 0 0 4px;
    padding: 2px 2px 6px;
  }
  .show-all,
  .hidden-line button {
    width: auto !important;
    padding: 0 !important;
    color: var(--ink) !important;
    font: 400 12px var(--sans) !important;
    text-decoration: underline;
    text-underline-offset: 3px;
  }
  .menu p.sub {
    padding-top: 4px;
    color: var(--ink-muted);
    font-weight: 500;
  }
  .menu p.hidden-line {
    display: flex;
    align-items: center;
    justify-content: space-between;
    gap: 8px;
    margin: 4px 0;
    padding: 8px 10px;
    border-top: 1px dashed var(--line-strong);
    border-bottom: 1px dashed var(--line-strong);
    font-weight: 400;
    font-size: 12px;
  }
  .area {
    flex: none;
    color: var(--ink-muted);
    font: 400 11px var(--mono);
  }
  .elsewhere .name {
    color: var(--ink-muted);
  }
  .find {
    width: 100%;
    height: 30px;
    margin: 0 0 4px;
    padding: 0 10px;
    border: 1px solid var(--line);
    background: var(--paper);
    color: var(--ink);
    font: 13px var(--sans);
  }
  .find::placeholder {
    color: var(--muted);
  }
  /* The board on screen: a filled square before its name. */
  .here {
    flex: none;
    width: 8px;
    height: 8px;
  }
  [aria-current='true'] .here {
    background: var(--ink);
  }
  .menu .name {
    flex: 1;
  }
  .meta {
    flex: none;
    color: var(--muted);
    font-weight: 400;
    font-size: 12px;
  }
  .row {
    display: flex;
    align-items: center;
    gap: 2px;
  }
  .menu .row > button:first-child {
    flex: 1;
    min-width: 0;
  }
  .menu .row .act {
    flex: none;
    width: auto;
    padding: 5px 8px;
    color: var(--muted);
    font-weight: 500;
    font-size: 12px;
  }
  .menu .row .act:hover {
    color: var(--ink);
  }
  .strip {
    display: grid;
    gap: 6px;
    margin-top: 4px;
    padding: 8px 6px 4px;
    border-top: 1px solid var(--line);
  }
  .acts,
  .strip form {
    display: flex;
    gap: 6px;
  }
  .menu .strip button {
    flex: none;
    width: auto;
    height: 28px;
    padding: 0 10px;
    border: 1px solid var(--line);
    border-radius: 0;
    font-size: 12px;
  }
  .menu .strip button:disabled {
    opacity: 0.5;
    cursor: not-allowed;
  }
  .strip input[type='text'] {
    flex: 1;
    min-width: 0;
    height: 28px;
    padding: 0 8px;
    border: 1px solid var(--line);
    border-radius: 0;
    background: var(--paper);
    color: var(--ink);
    font: 13px var(--sans);
  }
  .menu p.hint {
    padding: 0 2px;
    font-weight: 400;
    font-size: 12px;
  }
  .menu p.hint.warn {
    color: var(--bad);
  }
  details {
    margin-top: 4px;
    padding: 4px 6px;
    border-top: 1px solid var(--line);
    font-size: 12px;
  }
  summary {
    padding: 4px;
    color: var(--muted);
    cursor: pointer;
  }
  .gone {
    padding: 2px 4px;
    font-size: 13px;
  }
  .gone .name {
    flex: 1;
  }
</style>
