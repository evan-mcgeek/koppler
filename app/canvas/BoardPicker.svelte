<script lang="ts">
  // The board on screen, by name: a menu of the team's boards and the user's own, to open another or start a new one.
  import type { StoredPreset } from '../src/core/presets.ts';
  import { board } from './board.svelte.ts';
  import { toasts } from './toast.svelte.ts';

  const id = $props.id();
  let picker = $state<HTMLButtonElement>();
  let list = $state<HTMLDivElement>();
  let open = $state(false);
  const mine = $derived(board.own.some(one => one.name === board.name));
  const shared = $derived(!mine && board.team.some(one => one.name === board.name));
  const options = () => [...(list?.querySelectorAll<HTMLButtonElement>('button') ?? [])];
  const place = () => {
    const at = picker?.getBoundingClientRect();
    if (!at || !list) return;
    list.style.top = `${String(at.bottom + 4)}px`;
    list.style.left = `${String(at.left)}px`;
    list.style.width = `${String(at.width)}px`;
    (list.querySelector<HTMLButtonElement>('[aria-current="true"]') ?? options()[0])?.focus();
  };
  const step = (ev: KeyboardEvent) => {
    if (ev.key !== 'ArrowDown' && ev.key !== 'ArrowUp') return;
    ev.preventDefault();
    const all = options();
    const at = all.indexOf(document.activeElement as HTMLButtonElement);
    all[(at + (ev.key === 'ArrowDown' ? 1 : -1) + all.length) % all.length]?.focus();
  };
  const choose = (preset: StoredPreset) => {
    list?.hidePopover();
    if (preset.name === board.name) return;
    const out = board.openBoard(preset);
    if (out.error !== undefined) toasts.show(`Cannot open ${preset.name}. ${out.error}`, 'warning');
    else if (out.notes.length) toasts.show(`Opened ${preset.name}, changed to fit: ${out.notes.join('; ')}`);
  };
  const size = (preset: StoredPreset) => {
    const apps = Object.keys(preset.nodes).length;
    return `${String(apps)} ${apps === 1 ? 'app' : 'apps'}`;
  };
</script>

<button
  bind:this={picker}
  class="picker"
  class:chosen={!!board.name}
  type="button"
  aria-label="Board: {board.name ?? 'New board'}"
  aria-haspopup="dialog"
  aria-expanded={open}
  title={mine
    ? 'Your board, saved on this Mac as you change it'
    : shared
      ? 'Team board, from the stack. Changing it makes a copy of your own.'
      : 'Saved as soon as it has an app'}
  popovertarget={id}
>
  <span class="name">{board.name ?? 'New board'}</span>
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
  ontoggle={ev => {
    open = ev.newState === 'open';
    if (open) place();
  }}
>
  {#each [['Team boards', board.team], ['Your boards', board.own]] as const as [title, group] (title)}
    {#if group.length}<p>{title}</p>{/if}
    {#each group as preset (preset.name)}
      <button
        type="button"
        aria-current={preset.name === board.name}
        onclick={() => {
          choose(preset);
        }}
      >
        <span class="name">{preset.name}</span><span class="meta">{size(preset)}</span>
      </button>
    {/each}
  {/each}
  {#if !board.team.length && !board.own.length}
    <p class="none">No boards yet. A board is kept as soon as it has an app.</p>
  {/if}
  <button
    class="new"
    type="button"
    onclick={() => {
      list?.hidePopover();
      board.newBoard();
    }}>New board</button
  >
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
  .menu .new {
    margin-top: 4px;
    border-top: 1px solid var(--line);
    border-radius: 0 0 7px 7px;
    color: var(--cable-ink);
  }
</style>
