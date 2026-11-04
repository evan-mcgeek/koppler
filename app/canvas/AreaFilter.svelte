<script lang="ts">
  // The areas to see: a button saying the choice, and a checklist of the stack's areas behind it.
  import ChevronDown from '@lucide/svelte/icons/chevron-down';
  import Icon from './Icon.svelte';
  import { chosen } from './areas.svelte.ts';
  import { board } from './board.svelte.ts';

  const own = $props.id();
  /** `id`: the checklist's, for another button to open it by. */
  const { id = own }: { id?: string } = $props();
  let button = $state<HTMLButtonElement>();
  let list = $state<HTMLDivElement>();
  let open = $state(false);
  const all = $derived(Object.entries(board.areas));
  const on = (area: string) => !chosen.narrows || chosen.ids.includes(area);
  const count = (area: string) => board.apps.filter(app => app.areas.includes(area)).length;
  const apps = (n: number) => `${String(n)} ${n === 1 ? 'app' : 'apps'}`;
  const toggle = (area: string) => {
    const now = all.map(([one]) => one).filter(on);
    chosen.set(now.includes(area) ? now.filter(one => one !== area) : [...now, area]);
  };
  const place = () => {
    const at = button?.getBoundingClientRect();
    if (!at || !list) return;
    // Below the button, or above it where the window has no room.
    const below = at.bottom + 4 + list.offsetHeight <= innerHeight;
    list.style.top = `${String(below ? at.bottom + 4 : Math.max(8, at.top - 4 - list.offsetHeight))}px`;
    list.style.left = `${String(Math.max(8, Math.min(at.left, innerWidth - 268)))}px`;
    list.querySelector<HTMLInputElement>('input')?.focus();
  };
  const keys = (ev: KeyboardEvent) => {
    const row = (ev.target as Element).closest<HTMLElement>('[data-area]');
    if (ev.key.toLowerCase() === 'o' && row?.dataset['area']) {
      ev.preventDefault();
      chosen.set([row.dataset['area']]);
    } else if (ev.key === 'ArrowDown' || ev.key === 'ArrowUp') {
      // The checklist keeps its arrows: the board menu around it has its own.
      ev.preventDefault();
      ev.stopPropagation();
      const boxes = [...(list?.querySelectorAll<HTMLInputElement>('input') ?? [])];
      const from = (ev.target as Element).closest('.row')?.querySelector('input') ?? null;
      const at = boxes.indexOf(from as HTMLInputElement);
      boxes[(at + (ev.key === 'ArrowDown' ? 1 : -1) + boxes.length) % boxes.length]?.focus();
    }
  };
</script>

<button
  bind:this={button}
  class="areas"
  class:narrows={chosen.narrows}
  type="button"
  aria-haspopup="dialog"
  aria-expanded={open}
  aria-label="Areas: {chosen.label}"
  popovertarget={id}
>
  <span class="word">Areas</span><span class="choice">{chosen.label}</span><Icon of={ChevronDown} size={12} />
</button>
<div
  bind:this={list}
  {id}
  class="list"
  popover
  role="dialog"
  aria-label="Areas to see"
  tabindex="-1"
  onkeydown={keys}
  ontoggle={ev => {
    open = ev.newState === 'open';
    if (open) place();
  }}
>
  <label class="row all">
    <input
      type="checkbox"
      checked={!chosen.narrows}
      onchange={() => {
        chosen.set(chosen.narrows ? all.map(([one]) => one) : []);
      }}
    />
    <span class="name">All areas</span><span class="count">{apps(board.apps.length)}</span>
  </label>
  {#each all as [area, { name }] (area)}
    <div class="row" data-area={area}>
      <label>
        <input
          type="checkbox"
          checked={on(area)}
          onchange={() => {
            toggle(area);
          }}
        />
        <span class="name">{name}</span>
      </label>
      <button
        class="only"
        type="button"
        title="Show only {name}"
        onclick={() => {
          chosen.set([area]);
        }}>Only</button
      >
      <span class="count">{apps(count(area))}</span>
    </div>
  {/each}
  <p class="note">Kept on this Mac. Apps with no area always show.</p>
</div>

<style>
  .areas {
    display: inline-flex;
    align-items: center;
    gap: 6px;
    height: 28px;
    padding: 0 8px;
    border: 1px solid var(--line);
    background: none;
    color: var(--ink);
    font: 600 12.5px var(--sans);
    white-space: nowrap;
    cursor: pointer;
  }
  .areas.narrows,
  .areas:hover,
  .areas[aria-expanded='true'] {
    border-color: var(--ink);
  }
  .areas:focus-visible {
    outline: 2px solid var(--ink);
    outline-offset: 2px;
  }
  .word {
    color: var(--ink-muted);
    font-weight: 400;
    font-size: 11.5px;
  }
  .list {
    position: fixed;
    inset: auto;
    width: 260px;
    margin: 0;
    padding: 4px;
    border: 1px solid var(--line-strong);
    background: var(--surface);
    box-shadow: var(--lift);
  }
  .row {
    display: flex;
    align-items: center;
    gap: 8px;
    min-height: 32px;
    padding: 0 8px;
    color: var(--ink);
    font: 400 13px var(--sans);
  }
  .row label {
    display: flex;
    flex: 1;
    align-items: center;
    gap: 8px;
    min-width: 0;
    cursor: pointer;
  }
  .row.all {
    cursor: pointer;
    font-weight: 600;
  }
  .row:hover,
  .row:focus-within {
    background: color-mix(in oklab, var(--ink) 7%, transparent);
  }
  .name {
    flex: 1;
    min-width: 0;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }
  input {
    accent-color: var(--ink);
  }
  .count {
    color: var(--ink-muted);
    font: 400 11px var(--mono);
  }
  .only {
    padding: 0;
    border: 0;
    background: none;
    color: var(--ink);
    font: 400 11.5px var(--sans);
    text-decoration: underline;
    text-underline-offset: 3px;
    visibility: hidden;
    cursor: pointer;
  }
  .row:hover .only,
  .row:focus-within .only {
    visibility: visible;
  }
  .note {
    margin: 4px 0 0;
    padding: 8px 8px 4px;
    border-top: 1px solid var(--line);
    color: var(--ink-muted);
    font: 400 11.5px/1.4 var(--sans);
  }
</style>
