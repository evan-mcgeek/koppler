<script lang="ts">
  import Icon from './Icon.svelte';
  import ChevronLeft from '@lucide/svelte/icons/chevron-left';
  import X from '@lucide/svelte/icons/x';
  // A list of short names (environments, settings, paths): each is a chip that can be taken out, and one is typed in to
  // add it. Where their order means something, a chip moves towards the front.
  const {
    value,
    label,
    ordered = false,
    disabled = false,
    placeholder = 'Add one',
    first = '',
    onchange,
  }: {
    value: string[];
    label: string;
    ordered?: boolean;
    disabled?: boolean;
    placeholder?: string;
    /** What the first one is, in a word, where order matters. */
    first?: string;
    onchange: (next: string[]) => void;
  } = $props();
  let adding = $state('');
  const add = () => {
    const next = adding.trim();
    adding = '';
    if (next && !value.includes(next)) onchange([...value, next]);
  };
  const sooner = (at: number) => {
    const next = [...value];
    [next[at - 1], next[at]] = [next[at] ?? '', next[at - 1] ?? ''];
    onchange(next);
  };
</script>

<ul class="chips" aria-label={label}>
  {#each value as one, at (one)}
    <li class:first={ordered && at === 0}>
      {#if ordered && at > 0 && !disabled}
        <button
          type="button"
          aria-label="Move {one} earlier"
          title="Move earlier"
          onclick={() => {
            sooner(at);
          }}
        >
          <Icon of={ChevronLeft} size={10} />
        </button>
      {/if}
      <span class="word">{one}</span>
      {#if ordered && at === 0 && first}<span class="tag">{first}</span>{/if}
      {#if !disabled}
        <button
          type="button"
          aria-label="Remove {one}"
          title="Remove"
          onclick={() => {
            onchange(value.filter(other => other !== one));
          }}
        >
          <Icon of={X} size={10} />
        </button>
      {/if}
    </li>
  {/each}
  {#if !disabled}
    <li class="new">
      <input
        aria-label="Add to {label}"
        {placeholder}
        size={Math.max(placeholder.length, adding.length) + 1}
        bind:value={adding}
        onkeydown={ev => {
          if (ev.key === 'Enter' || ev.key === ',') {
            ev.preventDefault();
            add();
          }
        }}
        onblur={add}
      />
    </li>
  {/if}
</ul>

<style>
  .chips {
    display: flex;
    flex-wrap: wrap;
    gap: 4px;
    min-width: 0;
    margin: 0;
    padding: 0;
    list-style: none;
  }
  li {
    display: flex;
    align-items: center;
    gap: 2px;
    min-width: 0;
    height: 26px;
    box-sizing: border-box;
    padding: 0 3px 0 9px;
    border: 1px solid var(--line);
    border-radius: 999px;
    background: var(--paper);
  }
  li:has(> button:first-child) {
    padding-left: 3px;
  }
  .word {
    overflow: hidden;
    font-weight: 500;
    text-overflow: ellipsis;
    white-space: nowrap;
  }
  .tag {
    margin-left: 4px;
    color: var(--muted);
    font-size: 11px;
    white-space: nowrap;
  }
  button {
    display: grid;
    place-items: center;
    width: 18px;
    height: 18px;
    padding: 0;
    border: 0;
    border-radius: 999px;
    background: none;
    color: var(--muted);
    cursor: pointer;
  }
  button:hover {
    background: color-mix(in oklab, var(--ink) 10%, transparent);
    color: var(--ink);
  }
  .new {
    padding: 0;
    border-style: dashed;
    background: none;
  }
  .new input {
    min-width: 64px;
    height: 24px;
    padding: 0 9px;
    border: 0;
    border-radius: 999px;
    background: none;
    color: var(--ink);
    font: 13px var(--sans);
  }
  .new input::placeholder {
    color: color-mix(in oklab, var(--muted) 80%, transparent);
  }
</style>
