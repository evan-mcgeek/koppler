<script lang="ts">
  // The stack in use, next to the name: a menu of every stack on this machine, to switch to another.
  import { board } from './board.svelte.ts';
  import { dialogs } from './dialogs.svelte.ts';
  import { live } from './live.svelte.ts';
  import { runs } from './run.svelte.ts';

  const id = $props.id();
  let picker = $state<HTMLButtonElement>();
  let list = $state<HTMLDivElement>();
  let open = $state(false);
  const stacks = $derived(live.status?.stacks ?? []);
  const linked = $derived(live.status?.linked);
  /** What else can be done with stacks, under the list. */
  const acts = $derived([
    ...(linked
      ? [{ icon: '↻', label: 'Check for updates from GitHub', count: 0, run: () => void runs.updateStack() }]
      : []),
    ...(linked?.changes.length
      ? [
          {
            icon: '●',
            label: 'Changes not shared yet',
            count: linked.changes.length,
            run: () => {
              runs.shareChanges();
            },
          },
        ]
      : []),
    ...(board.apps.length
      ? [{ icon: '⌕', label: 'Look through the repos again', count: 0, run: () => void dialogs.findings?.open() }]
      : []),
    {
      icon: '+',
      label: 'Add a stack: new, or from GitHub',
      count: 0,
      run: () => {
        runs.addStack(() => dialogs.setup?.open());
      },
    },
  ]);
  const options = () => [...(list?.querySelectorAll<HTMLButtonElement>('button:not(:disabled)') ?? [])];
  const place = () => {
    const at = picker?.getBoundingClientRect();
    if (!at || !list) return;
    list.style.top = `${String(at.bottom + 4)}px`;
    list.style.left = `${String(at.left)}px`;
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

<span class="slash" aria-hidden="true">/</span>
<button
  bind:this={picker}
  class="picker"
  type="button"
  aria-haspopup="menu"
  aria-expanded={open}
  title="{board.stack}: switch to another stack"
  popovertarget={id}
>
  <span class="name">{board.stack}</span>
</button>
<div
  bind:this={list}
  {id}
  class="menu"
  popover
  role="menu"
  tabindex="-1"
  aria-label="Stacks"
  onkeydown={step}
  ontoggle={ev => {
    open = ev.newState === 'open';
    if (open) place();
  }}
>
  {#each stacks as stack (stack.dir)}
    {@const current = stack.dir === board.dir}
    {@const apps = current ? board.apps.length : stack.apps}
    <button
      type="button"
      role="menuitemradio"
      aria-checked={current}
      disabled={current}
      title={stack.path}
      onclick={() => {
        list?.hidePopover();
        runs.useStack(stack);
      }}
    >
      <span class="check" aria-hidden="true"></span>
      <span class="name">{stack.name}</span>
      <span class="meta"
        >{stack.linked ? 'from GitHub' : stack.shared ? 'shared' : 'private'}, {apps}
        {apps === 1 ? 'app' : 'apps'}</span
      >
    </button>
  {/each}
  <div class="more">
    {#each acts as act (act.label)}
      <button
        type="button"
        role="menuitem"
        onclick={() => {
          list?.hidePopover();
          act.run();
        }}
      >
        <span class="ico" aria-hidden="true">{act.icon}</span>
        <span class="name">{act.label}</span>
        {#if act.count}<span class="meta">{act.count}</span>{/if}
      </button>
    {/each}
  </div>
</div>

<style>
  .picker {
    position: relative;
    display: flex;
    align-items: center;
    max-width: 220px;
    height: 32px;
    margin-left: -8px;
    padding: 0 26px 0 8px;
    border: 1px solid transparent;
    border-radius: 7px;
    background: none;
    color: var(--ink);
    font: 600 14px var(--sans);
    cursor: pointer;
  }
  .slash {
    color: var(--muted);
    font-size: 14px;
  }
  .picker::after {
    content: '';
    position: absolute;
    top: 50%;
    right: 10px;
    width: 5px;
    height: 5px;
    border-right: 1.5px solid var(--muted);
    border-bottom: 1.5px solid var(--muted);
    transform: translateY(-70%) rotate(45deg);
  }
  .picker:hover,
  .picker[aria-expanded='true'] {
    border-color: var(--line);
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
    width: max-content;
    min-width: 280px;
    max-width: 420px;
    margin: 0;
    padding: 4px;
    border: 1px solid var(--line);
    border-radius: 10px;
    background: var(--surface);
    box-shadow: var(--lift);
  }
  .menu button {
    display: grid;
    grid-template-columns: 14px minmax(0, 1fr) auto;
    align-items: center;
    gap: 8px;
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
  .menu button:hover:not(:disabled),
  .menu button:focus-visible {
    background: color-mix(in oklab, var(--ink) 7%, transparent);
    outline: none;
  }
  .menu button:disabled {
    cursor: default;
  }
  .check {
    width: 9px;
    height: 5px;
    margin-bottom: 3px;
  }
  [aria-checked='true'] .check {
    border-bottom: 2px solid var(--cable);
    border-left: 2px solid var(--cable);
    transform: rotate(-45deg);
  }
  .meta {
    color: var(--muted);
    font-weight: 400;
    font-size: 12px;
  }
  .more {
    margin-top: 4px;
    padding-top: 4px;
    border-top: 1px solid var(--line);
  }
  .more button {
    color: var(--cable-ink);
  }
  .ico {
    text-align: center;
  }
</style>
