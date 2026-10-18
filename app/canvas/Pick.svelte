<script lang="ts">
  // A value picked from what Koppler knows; one that is not listed can be typed where that makes sense.
  import type { Option } from './settings.ts';

  const {
    id,
    value,
    options,
    other = false,
    required = false,
    disabled = false,
    label,
    placeholder = '',
    onpick,
  }: {
    id?: string;
    value: string;
    options: Option[];
    other?: boolean;
    required?: boolean;
    disabled?: boolean;
    label?: string;
    placeholder?: string;
    onpick: (value: string | undefined) => void;
  } = $props();
  const LONG = 30;
  const OTHER = '\u0000other';
  let typing = $state(false);
  const listId = $props.id();
  // What it holds stays in the list, even when Koppler does not know it.
  const shown = $derived(
    value && !options.some(one => one.value === value) ? [...options, { value, label: value }] : options,
  );
</script>

{#if options.length > LONG || (typing && other)}
  <input
    {id}
    {disabled}
    aria-label={label}
    list={options.length ? listId : undefined}
    placeholder={placeholder || (options.length ? 'Type to find one' : '')}
    {value}
    onchange={ev => {
      const next = ev.currentTarget.value.trim();
      if (!next && options.length <= LONG) typing = false;
      onpick(next || undefined);
    }}
  />
  {#if options.length}
    <datalist id={listId}>
      {#each options as one (one.value)}<option value={one.value}>{one.label === one.value ? '' : one.label}</option
        >{/each}
    </datalist>
  {/if}
{:else if !options.length && other}
  <input
    {id}
    {disabled}
    aria-label={label}
    {placeholder}
    {value}
    onchange={ev => {
      onpick(ev.currentTarget.value.trim() || undefined);
    }}
  />
{:else}
  <select
    {id}
    {disabled}
    aria-label={label}
    {value}
    onchange={ev => {
      const next = ev.currentTarget.value;
      if (next === OTHER) {
        typing = true;
        return;
      }
      onpick(next || undefined);
    }}
  >
    {#if !required || !value}<option value="">{required ? 'Choose…' : 'Not set'}</option>{/if}
    {#each shown as one (one.value)}<option value={one.value}>{one.label}</option>{/each}
    {#if other}<option value={OTHER}>Other…</option>{/if}
  </select>
{/if}

<style>
  input,
  select {
    width: 100%;
    min-width: 0;
    height: 32px;
    box-sizing: border-box;
    padding: 7px 10px;
    border: 1px solid var(--line);
    background: var(--desk);
    color: var(--ink);
    font: 12px var(--mono);
  }
  select {
    padding-right: 26px;
    appearance: none;
    background-image: var(--chevron);
    background-repeat: no-repeat;
    background-position: right 9px center;
  }
  input::placeholder {
    color: color-mix(in oklab, var(--ink-muted) 65%, transparent);
    font: 13px var(--sans);
  }
  :disabled {
    opacity: 0.7;
    cursor: not-allowed;
  }
</style>
