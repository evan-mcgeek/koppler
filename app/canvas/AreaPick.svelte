<script lang="ts">
  import Icon from './Icon.svelte';
  import X from '@lucide/svelte/icons/x';
  // An app's areas: each a value to take out, and the stack's areas as a checklist to add from. None is every area.
  const {
    value,
    areas,
    label,
    disabled = false,
    onchange,
  }: {
    value: string[];
    /** The stack's areas, by id, in its order. */
    areas: Record<string, { name?: string }>;
    label: string;
    disabled?: boolean;
    onchange: (next: string[]) => void;
  } = $props();
  let open = $state(false);
  let box = $state<HTMLDivElement>();
  const nameOf = (id: string) => areas[id]?.name ?? id;
  // Kept in the stack's order, whatever order they were ticked in.
  const toggle = (id: string, on: boolean) => {
    onchange(Object.keys(areas).filter(one => (one === id ? on : value.includes(one))));
  };
</script>

<svelte:window
  onpointerdown={(ev: PointerEvent) => {
    if (open && !box?.contains(ev.target as Node)) open = false;
  }}
  onkeydown={(ev: KeyboardEvent) => {
    // Escape closes the checklist, not the settings around it.
    if (ev.key === 'Escape' && open && box?.contains(document.activeElement)) {
      ev.preventDefault();
      open = false;
    }
  }}
/>
<div bind:this={box} class="area-pick" role="group" aria-label={label}>
  <!-- svelte-ignore a11y_click_events_have_key_events, a11y_no_static_element_interactions -->
  <div
    class="vals"
    class:open
    onclick={ev => {
      if (!disabled && !(ev.target as Element).closest('button')) open = !open;
    }}
  >
    {#if value.length}
      <ul>
        {#each value as id (id)}
          <li>
            {nameOf(id)}{#if !disabled}<button
                type="button"
                aria-label="Remove {nameOf(id)}"
                title="Remove"
                onclick={() => {
                  onchange(value.filter(one => one !== id));
                }}><Icon of={X} size={10} /></button
              >{/if}
          </li>
        {/each}
      </ul>
    {:else if !open}
      <span class="none">No area: shows in every area</span>
    {/if}
    {#if !disabled}
      <button class="add" type="button" aria-label="Add an area" aria-expanded={open} onclick={() => (open = !open)}
        >Add</button
      >
    {/if}
  </div>
  {#if open}
    <div class="picklist" role="group" aria-label="The stack's areas">
      {#each Object.keys(areas) as id (id)}
        <label>
          <input
            type="checkbox"
            checked={value.includes(id)}
            onchange={ev => {
              toggle(id, ev.currentTarget.checked);
            }}
          />{nameOf(id)}
        </label>
      {/each}
      <span class="foot">New areas are added in stack settings, Areas</span>
    </div>
  {/if}
</div>

<style>
  .area-pick {
    display: grid;
    min-width: 0;
  }
  .vals {
    display: flex;
    flex-wrap: wrap;
    align-items: center;
    gap: 6px;
    min-height: 32px;
    box-sizing: border-box;
    padding: 3px 4px;
    border: 1px solid var(--line);
    background: var(--desk);
    cursor: pointer;
  }
  .vals.open {
    border-color: var(--ink);
  }
  ul {
    display: contents;
  }
  li {
    display: flex;
    align-items: center;
    gap: 4px;
    height: 24px;
    padding: 0 4px 0 8px;
    border: 1px solid var(--line-strong);
    color: var(--ink);
    font: 12px var(--mono);
    list-style: none;
  }
  li button {
    display: grid;
    place-items: center;
    width: 16px;
    height: 16px;
    padding: 0;
    border: 0;
    background: none;
    color: var(--ink-muted);
    cursor: pointer;
  }
  li button:hover {
    color: var(--ink);
  }
  .none {
    padding: 0 6px;
    color: var(--ink-muted);
    font: 13px var(--sans);
  }
  .add {
    padding: 0 6px;
    border: 0;
    background: none;
    color: var(--ink-muted);
    font: 13px var(--sans);
    cursor: pointer;
  }
  .add:hover {
    color: var(--ink);
  }
  .vals:has(.none) .add {
    margin-left: auto;
  }
  .picklist {
    display: grid;
    margin-top: 4px;
    border: 1px solid var(--ink);
    background: var(--panel);
  }
  label {
    display: flex;
    align-items: center;
    gap: 10px;
    padding: 7px 10px;
    color: var(--ink);
    font: 13px var(--sans);
    cursor: pointer;
  }
  label:hover {
    background: color-mix(in oklab, var(--ink) 6%, transparent);
  }
  input {
    width: 14px;
    height: 14px;
    margin: 0;
    accent-color: var(--ink);
  }
  .foot {
    padding: 7px 10px;
    border-top: 1px solid var(--line);
    color: var(--ink-muted);
    font: 11px var(--sans);
  }
</style>
