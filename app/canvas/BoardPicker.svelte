<script lang="ts">
  import Icon from './Icon.svelte';
  import EyeOff from '@lucide/svelte/icons/eye-off';
  import Ellipsis from '@lucide/svelte/icons/ellipsis';
  // The board on screen, by name: a menu of the boards, the team's and the user's own in one list by area, to open,
  // rename, copy, share or delete one, start a new one, or open one from a file or a link.
  import type { StoredPreset } from '../src/core/presets.ts';
  import { bar } from './bar.svelte.ts';
  import { areaWhy, boardArea, boardGroups } from '../src/core/areas.ts';
  import AreaFilter from './AreaFilter.svelte';
  import { chosen as areaChoice } from './areas.svelte.ts';
  import { board } from './board.svelte.ts';
  import { ago, openBoard, openFile, openFlow, openLink } from './boards.ts';
  import { tick } from 'svelte';
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
  /** A board in the list: the team's or your own. */
  type Entry = { name: string; nodes: StoredPreset['nodes']; area?: unknown; mine: boolean; preset: StoredPreset };
  /** Each door lists its own boards: Discover the feature boards, Run the run boards. */
  const entries = $derived<Entry[]>(
    [
      ...board.team.map(preset => ({
        name: preset.name,
        nodes: preset.nodes,
        area: preset['area'],
        mine: false,
        preset,
      })),
      ...board.own.map(preset => ({
        name: preset.name,
        nodes: preset.nodes,
        area: preset['area'],
        mine: true,
        preset,
      })),
    ].filter(one => !!one.preset['feature'] === board.discovering),
  );
  /** Every board by area, those the chosen areas hide counted; a search looks through every board. */
  const listed = $derived(
    boardGroups(
      facts,
      entries.filter(one => shows(one.preset)),
      areaChoice.ids,
    ),
  );
  const shownEntries = $derived(new Set(listed.groups.flatMap(group => group.boards)));
  const hiddenMatches = $derived(entries.filter(one => shows(one.preset) && !shownEntries.has(one)));
  /** The board on screen, kept at the top while the chosen areas hide it. */
  const pinned = $derived(
    !query.trim() && board.name
      ? entries.find(one => one.name === board.name && one.mine === mine && !shownEntries.has(one))
      : undefined,
  );
  /** The board on screen's area, when the chosen areas leave it out. */
  const outside = $derived.by(() => {
    if (!hasAreas || !areaChoice.narrows) return undefined;
    const here = [...board.own, ...board.team].find(one => one.name === board.name);
    const id = here && areaOf(here).id;
    return id && !areaChoice.ids.includes(id) ? (board.areas[id]?.name ?? id) : undefined;
  });
  /** "Shipping, Notifications and Accounts". */
  const joined = (names: string[]) =>
    names.length > 1 ? `${names.slice(0, -1).join(', ')} and ${names.at(-1) ?? ''}` : (names[0] ?? '');
  /** What the chosen areas hide, the board on screen too: "4 boards in Payments and Accounts: 3 team, 1 yours". */
  const hiddenSaid = $derived.by(() => {
    const { count, team, yours, areas } = listed.hidden;
    const where = areas.length <= 3 ? ` in ${joined(areas)}` : '';
    if (team && yours) return `${String(count)} boards${where}: ${String(team)} team, ${String(yours)} yours`;
    if (team) return `${String(team)} team ${team === 1 ? 'board' : 'boards'}${where}`;
    return `${String(yours)} of your boards${where}`;
  });
  /** "(local)" after a board's name, a team board's copy: set apart, so a long name keeps it. */
  const SUFFIX = / \(local\)$/;
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
  /** Discover with no feature board open shows the whole stack. */
  const whole = $derived(board.discovering && !board.feature);
  const label = $derived(
    whole
      ? 'Whole stack'
      : (board.name ?? (board.scratch && board.nodes[0] ? `${board.nodes[0].data.name} alone` : 'New board')),
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
    setting = null;
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
  /** Why a board is in its area, for its tooltip: by hand, or how its apps settled a tie. */
  const whyOf = (preset: StoredPreset) => {
    const area = areaOf(preset);
    if (area.by === 'hand') return `Set by hand. From its apps: ${areaWhy(facts, preset)}`;
    return area.tie ? areaWhy(facts, preset) : undefined;
  };
  /** A board's area by name, said under it where the list is not by area. */
  const areaName = (entry: Entry) => {
    const id = areaOf(entry.preset).id;
    return id ? (board.areas[id]?.name ?? id) : 'No area';
  };
  const reloadable = (preset: StoredPreset) =>
    typeof preset['source'] === 'string' && /^(https?:|\/)/.test(preset['source']);
  /** The board whose row menu is open, and where. */
  let rowMenu = $state<HTMLDivElement>();
  let menuFor = $state<{ preset: StoredPreset; mine: boolean } | null>(null);
  /** What opened the row menu, to have the keyboard back when it closes. */
  let opener: HTMLElement | null = null;
  const openRowMenu = async (
    preset: StoredPreset,
    mine: boolean,
    at: { x: number; y: number },
    from: HTMLElement | null,
  ) => {
    menuFor = { preset, mine };
    opener = from;
    if (!rowMenu) return;
    rowMenu.style.top = `${String(Math.min(at.y, innerHeight - 160))}px`;
    rowMenu.style.left = `${String(Math.min(at.x, innerWidth - 200))}px`;
    rowMenu.showPopover();
    await tick();
    rowMenu.querySelector<HTMLButtonElement>('button')?.focus();
  };
  /** Up and down move through a menu's items; nothing else is done with them. */
  const arrows = (ev: KeyboardEvent, within: HTMLElement | undefined) => {
    ev.stopPropagation();
    if (ev.key !== 'ArrowDown' && ev.key !== 'ArrowUp') return;
    ev.preventDefault();
    const all = [...(within?.querySelectorAll<HTMLButtonElement>('[role^="menuitem"]') ?? [])];
    const at = all.indexOf(document.activeElement as HTMLButtonElement);
    all[(at + (ev.key === 'ArrowDown' ? 1 : -1) + all.length) % all.length]?.focus();
  };
  let areaMenu = $state<HTMLDivElement>();
  const startSetting = async (preset: StoredPreset, mine: boolean) => {
    rowMenu?.hidePopover();
    setting = { preset, mine };
    await tick();
    areaMenu?.querySelector<HTMLButtonElement>('[aria-checked="true"]')?.focus();
  };
  /** The board whose area is being set, in place of the lists. */
  let setting = $state<{ preset: StoredPreset; mine: boolean } | null>(null);
  // Yours is kept on this Mac as `koppler board edit --area` keeps it; a team board's is a fact of the stack.
  const setArea = async (preset: StoredPreset, mine: boolean, area: string | null) => {
    setting = null;
    if (mine) {
      board.edit(preset.name, { area });
      return;
    }
    const said = await post('board-area', { name: preset.name, area });
    // Read again either way: a refusal means the stack changed under the canvas.
    await board.reload();
    if ('error' in said) {
      toasts.show(`Could not set the area of ${preset.name}. ${said.error}`, 'warning');
      return;
    }
    if (board.name === preset.name) board.handArea = area;
  };
  const choose = (preset: StoredPreset) => {
    close();
    if (preset.name === board.name) return;
    // A feature board opens in Discover with what runs left as it is.
    if (board.discovering) openFlow(preset);
    else openBoard(preset);
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

<!-- eslint-disable @typescript-eslint/no-confusing-void-expression -- {@render} of a snippet returns nothing -->
{#snippet boardRow({ preset, mine }: Entry, elsewhere = false, under = '')}
  <!-- svelte-ignore a11y_no_static_element_interactions -->
  <div
    class="row"
    class:elsewhere
    oncontextmenu={ev => {
      ev.preventDefault();
      void openRowMenu(
        preset,
        mine,
        { x: ev.clientX, y: ev.clientY },
        ev.currentTarget.querySelector<HTMLElement>('button'),
      );
    }}
  >
    <button
      type="button"
      aria-current={preset.name === board.name}
      title={typeof preset['source'] === 'string'
        ? `Opened from ${preset['source']}`
        : elsewhere
          ? 'Hidden by your areas. Opening it leaves them as they are.'
          : hasAreas
            ? whyOf(preset)
            : undefined}
      onclick={() => {
        choose(preset);
      }}
    >
      <span class="here" aria-hidden="true"></span><span class="what"
        ><span class="line"
          ><span class="name">{preset.name.replace(SUFFIX, '')}</span>{#if SUFFIX.test(preset.name)}<span class="suffix"
              >{SUFFIX.exec(preset.name)?.[0]}</span
            >{/if}</span
        >{#if under || preset['flow']}<span class="under">{under || `from ${String(preset['flow'])}`}</span>{/if}</span
      >
      <!-- A fixed column, so names stay put whether the tag or the … shows. -->
      <span class="whose"
        >{#if !mine}<span class="team" title="A team board, from the stack">Team</span>{/if}</span
      >
    </button>
    <button
      class="act more-for"
      type="button"
      aria-label="More for {preset.name}"
      aria-haspopup="menu"
      title="More"
      onclick={ev => {
        const at = ev.currentTarget.getBoundingClientRect();
        void openRowMenu(preset, mine, { x: at.left, y: at.bottom + 2 }, ev.currentTarget);
      }}><Icon of={Ellipsis} size={14} /></button
    >
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
  title={whole
    ? 'Every app of the stack, and how they fit together'
    : mine
      ? 'Your board, saved on this Mac as you change it'
      : shared
        ? 'Team board, from the stack. Changing it makes a copy of your own.'
        : 'Saved as soon as it has an app'}
  popovertarget={id}
>
  <span class="name">{label.replace(SUFFIX, '')}</span>
  {#if SUFFIX.test(label)}<span class="suffix" title="Changed on this Mac">{SUFFIX.exec(label)?.[0]}</span>{/if}
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
  {#if setting}
    {@const { preset, mine: yours } = setting}
    {@const hand = typeof preset['area'] === 'string' && preset['area'] in board.areas ? preset['area'] : null}
    {@const heading = `${preset.name} · area`}
    <div class="set-area">
      <div class="set-head">
        <strong>{heading}</strong>
        <span>{yours ? 'Your board, on this Mac.' : 'Team board. Changing it changes it for the team.'}</span>
      </div>
      <div
        bind:this={areaMenu}
        class="radios"
        role="menu"
        aria-label={heading}
        tabindex="-1"
        onkeydown={ev => {
          arrows(ev, areaMenu);
        }}
      >
        <button
          type="button"
          role="menuitemradio"
          class="worked"
          aria-checked={!hand}
          aria-label="Worked out from its apps"
          aria-describedby="{id}-why"
          onclick={() => void setArea(preset, yours, null)}
          ><span class="dot" aria-hidden="true"></span><span class="words"
            >Worked out from its apps<small id="{id}-why">{areaWhy(facts, preset)}</small></span
          ></button
        >
        {#each Object.entries(board.areas) as [area, one] (area)}
          <button
            type="button"
            role="menuitemradio"
            aria-checked={hand === area}
            onclick={() => void setArea(preset, yours, area)}
            ><span class="dot" aria-hidden="true"></span>{one.name}</button
          >
        {/each}
      </div>
      <button class="back" type="button" onclick={() => (setting = null)}>Back to the boards</button>
    </div>
  {:else}
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
    {#if board.discovering && !query.trim()}
      <div class="row whole-row">
        <button
          type="button"
          aria-current={whole}
          onclick={() => {
            close();
            openFlow(null);
          }}
          ><span class="here" aria-hidden="true"></span><span class="what"
            ><span class="line"><span class="name">Whole stack</span></span></span
          ></button
        >
      </div>
    {/if}
    {#if pinned}
      <p class="sub">Current board</p>
      {@render boardRow(pinned, false, areaName(pinned))}
    {/if}
    {#each listed.groups as group (group.title)}
      {#if hasAreas}<p class="sub"><span>{group.title}</span><span class="count">{group.boards.length}</span></p>{/if}
      {#each group.boards as entry (`${String(entry.mine)}:${entry.name}`)}
        {@render boardRow(entry)}
      {/each}
    {/each}
    {#if query.trim() && hiddenMatches.length}
      <p class="sub"><span>Hidden by your areas</span><span class="count">{hiddenMatches.length}</span></p>
      {#each hiddenMatches as entry (`${String(entry.mine)}:${entry.name}`)}
        {@render boardRow(entry, true, areaName(entry))}
      {/each}
    {:else if !query.trim() && listed.hidden.count}
      <p class="hidden-line">
        <Icon of={EyeOff} size={13} /><span class="said">{hiddenSaid}</span>
        <button
          type="button"
          onclick={() => {
            areaChoice.set([]);
          }}>Show all</button
        >
      </p>
    {/if}
    {#if !entries.length}
      <p class="none">
        {board.discovering
          ? 'No feature boards yet: ask the agent for one.'
          : 'No boards yet. A board is kept as soon as it has an app.'}
      </p>
    {:else if query.trim() && !entries.some(one => shows(one.preset))}
      <p class="none">No board is called that.</p>
    {/if}
    <div class="strip">
      <div class="acts">
        {#if board.discovering}
          <button
            type="button"
            title="A feature board: describe it, and the agent proposes the apps and links it uses"
            onclick={() => {
              close();
              board.newFeature();
            }}>Ask the agent for a new one…</button
          >
        {:else}
          <button
            type="button"
            onclick={() => {
              close();
              board.newBoard();
            }}>New board</button
          >
        {/if}
        <button
          type="button"
          disabled={whole || !board.nodes.length}
          onclick={() => {
            close();
            board.duplicate();
          }}>Duplicate</button
        >
      </div>
      {#if mine && !whole}
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
  {/if}
  <div
    bind:this={rowMenu}
    class="row-menu"
    popover
    role="menu"
    tabindex="-1"
    aria-label={menuFor?.preset.name ?? 'Board'}
    onkeydown={ev => {
      arrows(ev, rowMenu);
    }}
    ontoggle={ev => {
      const here = document.activeElement;
      if (ev.newState === 'closed' && (here === document.body || rowMenu?.contains(here))) opener?.focus();
    }}
  >
    {#if menuFor}
      {@const { preset, mine: yours } = menuFor}
      <button
        type="button"
        role="menuitem"
        onclick={() => {
          rowMenu?.hidePopover();
          choose(preset);
        }}>Open</button
      >
      {#if hasAreas}
        <button type="button" role="menuitem" onclick={() => void startSetting(preset, yours)}>Set area…</button>
      {/if}
      {#if yours && reloadable(preset)}
        <button
          type="button"
          role="menuitem"
          onclick={() => {
            rowMenu?.hidePopover();
            close();
            void reload(String(preset['source']), preset.name);
          }}>Reload</button
        >
      {/if}
      {#if yours}
        <button
          type="button"
          role="menuitem"
          onclick={() => {
            rowMenu?.hidePopover();
            void share(preset);
          }}>Share with the team…</button
        >
        <button
          type="button"
          role="menuitem"
          onclick={() => {
            rowMenu?.hidePopover();
            askDelete(preset);
          }}>Delete…</button
        >
      {/if}
    {/if}
  </div>
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
  /* An area's heading: its name, and how many boards it holds in mono. */
  .menu p.sub {
    display: flex;
    align-items: baseline;
    gap: 8px;
    padding: 10px 8px 4px;
    font: 600 12px var(--sans);
  }
  .menu p.sub span:first-child {
    flex: 1;
  }
  .count {
    font: 400 11px var(--mono);
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
  .what {
    display: grid;
    flex: 1;
    min-width: 0;
  }
  .line {
    display: flex;
    align-items: baseline;
    gap: 6px;
    min-width: 0;
  }
  .under {
    color: var(--muted);
    font: 400 12px var(--sans);
  }
  .menu p.hidden-line .said {
    flex: 1;
  }
  /* Whose board: a word in a hairline box on the team's, nothing on yours. Not a state, so no colour. */
  .whose {
    display: flex;
    flex: none;
    justify-content: flex-end;
    width: 40px;
  }
  .team {
    padding: 1px 5px;
    border: 1px solid var(--line-strong);
    color: var(--muted);
    font: 600 11px/14px var(--sans);
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
    width: 7px;
    height: 7px;
  }
  [aria-current='true'] .here {
    background: var(--ink);
  }
  .menu .name {
    flex: 0 1 auto;
    overflow: hidden;
    font-weight: 500;
    font-size: 14px;
    white-space: nowrap;
    text-overflow: ellipsis;
  }
  .menu [aria-current='true'] .name {
    font-weight: 600;
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
    gap: 10px;
    min-width: 0;
  }
  /* The whole row lights up, its … too. */
  .menu .row:hover,
  .menu .row:focus-within {
    background: color-mix(in oklab, var(--ink) 7%, transparent);
  }
  .menu .row > button:first-child:hover,
  .menu .row > button:first-child:focus-visible {
    background: none;
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
  /* A board's own actions are there when you are at its row. */
  .menu .row .more-for {
    justify-content: center;
    width: 24px;
    height: 24px;
    margin-right: 4px;
    padding: 0;
    border: 1px solid var(--line-strong);
    color: var(--ink);
    opacity: 0;
  }
  .menu .row:hover .more-for,
  .menu .row:focus-within .more-for {
    opacity: 1;
  }
  .row-menu {
    position: fixed;
    inset: auto;
    width: 200px;
    margin: 0;
    padding: 0;
    border: 1px solid var(--line-strong);
    background: var(--surface);
    box-shadow: var(--lift);
  }
  .menu .row-menu button {
    padding: 8px 12px;
    border-bottom: 1px solid var(--line);
    font-weight: 400;
  }
  .menu .row-menu button:last-child {
    border-bottom: 0;
  }
  .set-area {
    display: grid;
    border: 1px solid var(--line-strong);
  }
  .set-head {
    display: grid;
    gap: 2px;
    padding: 12px 14px 10px;
    border-bottom: 1px solid var(--line);
  }
  .set-head strong {
    font: 600 14px var(--sans);
  }
  .set-head span {
    color: var(--ink-muted);
    font: 12px var(--sans);
  }
  .radios {
    display: grid;
  }
  .menu .radios button {
    gap: 12px;
    padding: 8px 14px;
    font: 400 13px var(--sans);
  }
  .menu .radios .worked {
    border-bottom: 1px solid var(--line);
  }
  .radios .words {
    display: grid;
  }
  .radios small {
    color: var(--ink-muted);
    font: 11px var(--sans);
  }
  /* A radio's mark: a ring, filled at its centre for the one in use. */
  .dot {
    flex: none;
    width: 14px;
    height: 14px;
    box-sizing: border-box;
    border: 1px solid var(--line-strong);
    border-radius: 50%;
  }
  [aria-checked='true'] > .dot {
    border-color: var(--ink);
    background: radial-gradient(circle, var(--ink) 0 3px, transparent 3.5px);
  }
  .menu .back {
    border-top: 1px solid var(--line);
    color: var(--ink-muted);
    font-weight: 400;
    font-size: 12px;
  }
  .gone .name {
    flex: 1;
  }
</style>
