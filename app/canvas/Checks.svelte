<script lang="ts">
  // Several of what the stack has (its environments, its queues), each ticked or not.
  import type { Option } from './settings.ts';

  const {
    options,
    picked,
    label,
    disabled = false,
    none,
    ontoggle,
  }: {
    options: Option[];
    picked: string[];
    label: string;
    disabled?: boolean;
    /** What to say when the stack has none to tick. */
    none: string;
    ontoggle: (value: string, on: boolean) => void;
  } = $props();
  // One it holds that the stack no longer has stays, so it can be unticked.
  const shown = $derived([
    ...options,
    ...picked.filter(one => !options.some(other => other.value === one)).map(one => ({ value: one, label: one })),
  ]);
</script>

{#if shown.length}
  <div class="checks" role="group" aria-label={label}>
    {#each shown as one (one.value)}
      <label>
        <input
          type="checkbox"
          {disabled}
          checked={picked.includes(one.value)}
          onchange={ev => {
            ontoggle(one.value, ev.currentTarget.checked);
          }}
        />
        <span>{one.label}</span>
      </label>
    {/each}
  </div>
{:else}
  <span class="none">{none}</span>
{/if}

<style>
  .checks {
    display: flex;
    flex-wrap: wrap;
    gap: 4px 14px;
    min-width: 0;
    padding: 4px 0;
  }
  label {
    display: flex;
    align-items: center;
    gap: 6px;
    min-width: 0;
    cursor: pointer;
  }
  span {
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }
  input {
    flex: none;
    width: 15px;
    height: 15px;
    margin: 0;
    accent-color: var(--cable);
  }
  .none {
    overflow: visible;
    white-space: normal;
    padding: 4px 0;
    color: var(--muted);
  }
</style>
