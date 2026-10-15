<script lang="ts">
  import Icon from './Icon.svelte';
  import ChevronDown from '@lucide/svelte/icons/chevron-down';
  // The small menu behind the arrow next to a main button: more ways to do the same thing.
  export interface Item {
    label: string;
    about: string;
    run: () => void;
    off?: boolean;
    danger?: boolean;
  }
  const { label, items, tone }: { label: string; items: Item[]; tone: 'run' | 'stop' } = $props();
  const id = $props.id();
  let more = $state<HTMLButtonElement>();
  let list = $state<HTMLDivElement>();
  let open = $state(false);
  const options = () => [...(list?.querySelectorAll<HTMLButtonElement>('button:not(:disabled)') ?? [])];
  // Under the arrow, its right edge on the arrow's.
  const place = () => {
    const at = more?.getBoundingClientRect();
    if (!at || !list) return;
    list.style.top = `${String(at.bottom + 6)}px`;
    list.style.right = `${String(innerWidth - at.right)}px`;
    options()[0]?.focus();
  };
  const step = (ev: KeyboardEvent) => {
    if (ev.key !== 'ArrowDown' && ev.key !== 'ArrowUp') return;
    ev.preventDefault();
    const all = options();
    const at = all.indexOf(document.activeElement as HTMLButtonElement);
    all[(at + (ev.key === 'ArrowDown' ? 1 : -1) + all.length) % all.length]?.focus();
  };
</script>

<button
  bind:this={more}
  class="more {tone}"
  type="button"
  aria-label={label}
  aria-haspopup="menu"
  aria-expanded={open}
  popovertarget={id}
>
  <Icon of={ChevronDown} size={12} />
</button>
<div
  bind:this={list}
  {id}
  class="menu"
  popover
  role="menu"
  tabindex="-1"
  aria-label={label}
  onkeydown={step}
  ontoggle={ev => {
    open = ev.newState === 'open';
    if (open) place();
  }}
>
  {#each items as item (item.label)}
    <button
      type="button"
      role="menuitem"
      class:danger={item.danger}
      disabled={item.off}
      onclick={() => {
        list?.hidePopover();
        item.run();
      }}
    >
      {item.label}<span>{item.about}</span>
    </button>
  {/each}
</div>

<style>
  .more {
    display: inline-grid;
    place-items: center;
    width: 28px;
    margin-left: -1px;
    padding: 0;
    border: 1px solid transparent;
    border-radius: 0 8px 8px 0;
    cursor: pointer;
  }
  .more.stop {
    border-color: color-mix(in oklab, var(--prod) 45%, transparent);
    background: none;
    color: var(--prod);
  }
  .more.stop:hover,
  .more.stop[aria-expanded='true'] {
    background: color-mix(in oklab, var(--prod) 12%, transparent);
  }
  .more.run {
    border-left-color: color-mix(in oklab, var(--on-accent) 35%, transparent);
    background: var(--cable);
    color: var(--on-accent);
  }
  .more.run:hover,
  .more.run[aria-expanded='true'] {
    background: color-mix(in oklab, var(--cable) 85%, var(--ink));
  }
  :global(.protected) .more.run {
    background: var(--prod);
  }
  .menu {
    position: fixed;
    inset: auto;
    width: 300px;
    margin: 0;
    padding: 4px;
    border: 1px solid var(--line);
    border-radius: 10px;
    background: var(--surface);
    box-shadow: var(--lift);
  }
  .menu button {
    display: grid;
    gap: 2px;
    width: 100%;
    padding: 8px 10px;
    border: 0;
    border-radius: 7px;
    background: none;
    color: var(--ink);
    font: 600 13px var(--sans);
    text-align: left;
    cursor: pointer;
  }
  .menu button span {
    color: var(--muted);
    font-weight: 400;
    font-size: 12px;
  }
  .menu button:hover:not(:disabled),
  .menu button:focus-visible {
    background: color-mix(in oklab, var(--ink) 7%, transparent);
    outline: none;
  }
  .menu button:disabled {
    opacity: 0.5;
    cursor: not-allowed;
  }
  .menu button.danger {
    color: var(--bad);
  }
  .menu button + button.danger {
    margin-top: 4px;
    border-top: 1px solid var(--line);
    border-radius: 0 0 7px 7px;
  }
</style>
