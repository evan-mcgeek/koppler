<script lang="ts">
  // The board on screen, by name: a menu of the team's boards and the user's own, to open, rename, copy, share or
  // delete one, start a new one, or open one from a file or a link.
  import type { StoredPreset } from '../src/core/presets.ts';
  import { board } from './board.svelte.ts';
  import { ago, openBoard, openFile, openLink } from './boards.ts';
  import { post } from './data.ts';
  import { live } from './live.svelte.ts';
  import { runs } from './run.svelte.ts';
  import { toasts } from './toast.svelte.ts';

  const OPEN_HINT = 'Or drop a board .json file anywhere on the page.';
  const id = $props.id();
  let picker = $state<HTMLButtonElement>();
  let list = $state<HTMLDivElement>();
  let file = $state<HTMLInputElement>();
  let open = $state(false);
  let named = $state('');
  let link = $state('');
  let hint = $state({ text: OPEN_HINT, warn: false });
  let busy = $state(false);
  const mine = $derived(board.own.some(one => one.name === board.name));
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
    list.style.left = `${String(at.left)}px`;
    list.style.width = `${String(Math.max(at.width, Math.min(400, innerWidth - at.left - 12)))}px`;
    (list.querySelector<HTMLButtonElement>('[aria-current="true"]') ?? options()[0])?.focus();
  };
  // Before it shows, not after: what is typed next must not be wiped by a late reset.
  const fresh = (ev: ToggleEvent) => {
    if (ev.newState !== 'open') return;
    named = board.name ?? '';
    link = '';
    hint = { text: OPEN_HINT, warn: false };
  };
  const step = (ev: KeyboardEvent) => {
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
  // Shared with the team: kept among the stack's team boards through the same checked edit as any other change.
  const share = async (preset: StoredPreset) => {
    const at = board.team.findIndex(one => one.name === preset.name);
    const index = at < 0 ? board.team.length : at;
    const value = board.forTeam(preset);
    const said = await post('stack-edit', { path: `presets[${String(index)}]`, value });
    if ('error' in said) {
      toasts.show(`Could not share ${preset.name}: ${said.error}`, 'warning');
      return;
    }
    board.keptForTeam(index, value);
    const reach = live.status?.linked
      ? 'Open a pull request from the stack menu, so your team gets it.'
      : "Commit the stack's repo, so your team gets it.";
    toasts.show(`${preset.name} is a team board now. ${reach}`);
  };
  const copy = async (preset: StoredPreset) => {
    const copied = await navigator.clipboard.writeText(board.asShared(preset)).then(
      () => true,
      () => false,
    );
    if (copied) toasts.show('Copied. It opens on another canvas from the board menu, as a file or a link.');
    else toasts.show('Copy is blocked here', 'warning');
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
  <span class="name">{label}</span>
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
  {#each [['Team boards', board.team], ['Your boards', board.own]] as const as [title, group] (title)}
    {#if group.length}<p>{title}</p>{/if}
    {#each group as preset (preset.name)}
      <div class="row">
        <button
          type="button"
          aria-current={preset.name === board.name}
          title={typeof preset['source'] === 'string' ? `Opened from ${preset['source']}` : undefined}
          onclick={() => {
            choose(preset);
          }}
        >
          <span class="name">{preset.name}</span><span class="meta">{size(preset)}</span>
        </button>
        {#if group === board.own}
          <button
            class="act"
            type="button"
            aria-label="Share {preset.name} with the team"
            title="Make it a team board of the stack, for everyone who uses it"
            onclick={() => void share(preset)}>Share</button
          >
          <button
            class="act"
            type="button"
            aria-label="Copy {preset.name} as JSON"
            title="Copy as JSON, to send to someone: it opens from the board menu"
            onclick={() => void copy(preset)}>Copy</button
          >
          <button
            class="act"
            type="button"
            aria-label="Delete {preset.name}"
            title="Delete"
            onclick={() => {
              askDelete(preset);
            }}>×</button
          >
        {/if}
      </div>
    {/each}
  {/each}
  {#if !board.team.length && !board.own.length}
    <p class="none">No boards yet. A board is kept as soon as it has an app.</p>
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
    width: 100%;
    height: 32px;
    padding: 0 30px 0 10px;
    border: 1px solid var(--line);
    border-radius: 7px;
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
  .menu {
    position: fixed;
    inset: auto;
    max-height: min(480px, calc(100vh - 120px));
    margin: 0;
    padding: 4px;
    overflow-y: auto;
    border: 1px solid var(--line);
    border-radius: 10px;
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
    border-radius: 7px;
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
  .menu [aria-current='true'] {
    background: color-mix(in oklab, var(--cable) 12%, transparent);
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
    border-radius: 6px;
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
    border-radius: 6px;
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
