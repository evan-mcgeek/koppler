<script lang="ts">
  // The branch field: it filters the clone's branches (newest first) as it is typed in; a name they do not list is kept too.
  const MAX_SHOWN = 80;
  const {
    value,
    current,
    branches,
    label = 'Branch',
    title,
    onpick,
  }: {
    value: string;
    /** The branch the clone is on: what an empty field means. */
    current: string;
    branches: string[];
    /** Its name for a screen reader and the debug log: the list is not part of it. */
    label?: string;
    title?: string | undefined;
    onpick: (branch: string) => void;
  } = $props();
  const id = $props.id();
  let input = $state<HTMLInputElement>();
  let list = $state<HTMLUListElement>();
  let open = $state(false);
  let query = $state('');
  let active = $state(0);
  let before = '';
  const matches = $derived(
    query ? branches.filter(branch => branch.toLowerCase().includes(query.toLowerCase())) : branches,
  );
  const shown = $derived(matches.slice(0, MAX_SHOWN));
  // Under the field and as wide as the longest name needs, within the window; above it when there is no room below.
  const place = (index: number, count: number) => {
    const at = input?.getBoundingClientRect();
    if (!at || !list) return;
    list.style.left = `${String(at.left)}px`;
    list.style.minWidth = `${String(Math.max(at.width, 280))}px`;
    list.style.maxWidth = `${String(Math.max(280, Math.min(560, innerWidth - at.left - 12)))}px`;
    const below = at.bottom + 4;
    list.style.top = `${String(below + list.offsetHeight > innerHeight - 8 ? Math.max(8, at.top - 4 - list.offsetHeight) : below)}px`;
    if (count) list.children[index]?.scrollIntoView({ block: 'nearest' });
  };
  $effect(() => {
    if (open) place(active, shown.length);
  });
  const show = () => {
    if (open || !input) return;
    before = input.value;
    query = '';
    active = Math.max(0, shown.indexOf(value || current));
    open = true;
    input.select();
    list?.showPopover();
  };
  const hide = () => {
    if (!open) return;
    open = false;
    list?.hidePopover();
  };
  const keep = (name: string) => {
    if (name.trim() !== value) onpick(name.trim());
  };
  const pick = (name: string) => {
    if (input) input.value = name;
    keep(name);
    hide();
    input?.blur();
  };
  const key = (ev: KeyboardEvent) => {
    if (!open) {
      if (ev.key === 'ArrowDown') show();
      return;
    }
    if ((ev.key === 'ArrowDown' || ev.key === 'ArrowUp') && shown.length) {
      ev.preventDefault();
      active = (active + (ev.key === 'ArrowDown' ? 1 : -1) + shown.length) % shown.length;
    } else if (ev.key === 'Enter') {
      ev.preventDefault();
      const chosen = shown[active];
      if (chosen) pick(chosen);
      else input?.blur();
    } else if (ev.key === 'Escape') {
      // Only the list closes: the dialog or the card it is in stays as it is.
      ev.preventDefault();
      ev.stopPropagation();
      if (input) input.value = before;
      hide();
      input?.blur();
    }
  };
</script>

<!-- Opened by a press or by typing, not by focus alone: a dialog that puts the focus here stays closed. -->
<input
  bind:this={input}
  class="mono"
  role="combobox"
  aria-label={label}
  aria-expanded={open}
  aria-controls="{id}-list"
  aria-autocomplete="list"
  aria-activedescendant={open && shown.length ? `${id}-${String(active)}` : undefined}
  autocomplete="off"
  spellcheck="false"
  placeholder={current}
  {title}
  {value}
  onclick={show}
  onblur={ev => {
    keep(ev.currentTarget.value);
    hide();
  }}
  oninput={ev => {
    show();
    query = ev.currentTarget.value.trim();
    active = 0;
  }}
  onkeydown={key}
/>
<!-- The press stays off the field's focus, so the list does not close before the pick lands. -->
<ul
  bind:this={list}
  id="{id}-list"
  class="nodrag nopan nowheel"
  role="listbox"
  popover="manual"
  onpointerdown={ev => {
    ev.preventDefault();
  }}
>
  {#each shown as branch, at (branch)}
    <!-- The keys are the field's: arrows move through the list and Enter picks. -->
    <!-- svelte-ignore a11y_click_events_have_key_events -->
    <li
      id="{id}-{at}"
      role="option"
      aria-selected={at === active}
      title={branch}
      onpointerenter={() => (active = at)}
      onclick={ev => {
        // The list sits in the field's label: a click passed on to the field would open it again.
        ev.preventDefault();
        pick(branch);
      }}
    >
      <span class="name">{branch}</span>
      {#if branch === current}<span class="tag">current</span>{:else if branch === value}<span class="tag">picked</span
        >{/if}
    </li>
  {/each}
  {#if matches.length > shown.length}
    <li class="note" role="presentation">{matches.length - shown.length} more, keep typing</li>
  {:else if !matches.length}
    <li class="note" role="presentation">
      {branches.length ? `No branch matches. Enter keeps "${query}".` : 'No branches found. Run koppler sync.'}
    </li>
  {/if}
</ul>

<style>
  input {
    width: 100%;
    height: 30px;
    padding: 0 8px;
    border: 1px solid var(--line);
    border-radius: 6px;
    background: var(--paper);
    color: var(--ink);
    font: 12px var(--mono);
    text-overflow: ellipsis;
  }
  input::placeholder {
    color: var(--muted);
  }
  ul {
    position: fixed;
    inset: auto;
    width: max-content;
    max-height: 280px;
    margin: 0;
    padding: 4px;
    overflow-y: auto;
    list-style: none;
    background: var(--surface);
    border: 1px solid var(--line);
    border-radius: 8px;
    box-shadow: var(--lift);
  }
  li {
    display: flex;
    align-items: center;
    gap: 12px;
    padding: 6px 8px;
    border-radius: 5px;
    font: 12px/1.35 var(--mono);
    color: var(--ink);
    cursor: pointer;
    white-space: nowrap;
  }
  .name {
    min-width: 0;
    overflow: hidden;
    text-overflow: ellipsis;
  }
  li[aria-selected='true'] {
    background: color-mix(in oklab, var(--cable) 18%, transparent);
  }
  .tag {
    flex: none;
    margin-left: auto;
    font: 600 10.5px var(--sans);
    color: var(--muted);
  }
  .note {
    font-family: var(--sans);
    color: var(--muted);
    cursor: default;
  }
</style>
