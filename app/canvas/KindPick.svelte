<script lang="ts">
  // What an app is built with, picked from the kinds Koppler knows and the stack's own, each by its icon.
  import KindIcon from './KindIcon.svelte';
  import type { Option } from './settings.ts';

  const {
    id,
    value,
    options,
    disabled = false,
    onpick,
  }: { id?: string; value: string; options: Option[]; disabled?: boolean; onpick: (value: string) => void } = $props();
  let open = $state(false);
  let root = $state<HTMLElement>();
  const shown = $derived(
    value && !options.some(one => one.value === value) ? [...options, { value, label: value }] : options,
  );
  const now = $derived(shown.find(one => one.value === value));
  const move = (by: number) => {
    const all = [...(root?.querySelectorAll<HTMLElement>('[role="option"]') ?? [])];
    const at = all.indexOf(document.activeElement as HTMLElement);
    all[Math.max(0, Math.min(all.length - 1, at + by))]?.focus();
  };
  const show = async () => {
    open = true;
    await Promise.resolve();
    requestAnimationFrame(() => {
      (
        root?.querySelector<HTMLElement>('[aria-selected="true"]') ??
        root?.querySelector<HTMLElement>('[role="option"]')
      )?.focus();
    });
  };
  const shut = (focus = true) => {
    open = false;
    if (focus) root?.querySelector<HTMLElement>('.now')?.focus();
  };
</script>

<svelte:window
  onpointerdown={(ev: PointerEvent) => {
    if (open && !root?.contains(ev.target as Node)) shut(false);
  }}
/>
<div
  class="pick"
  bind:this={root}
  onkeydown={ev => {
    if (!open) return;
    if (ev.key === 'Escape') {
      // Only the list closes: the panel it is in stays.
      ev.preventDefault();
      ev.stopPropagation();
      shut();
    } else if (ev.key === 'ArrowDown' || ev.key === 'ArrowUp') {
      ev.preventDefault();
      move(ev.key === 'ArrowDown' ? 1 : -1);
    }
  }}
  role="presentation"
>
  <button
    {id}
    class="now"
    type="button"
    {disabled}
    aria-haspopup="listbox"
    aria-expanded={open}
    onclick={() => {
      if (open) shut();
      else void show();
    }}
  >
    {#if now}
      <KindIcon kind={now.value} label="" />
      <span class="label">{now.label}</span>
    {:else}
      <span class="label unset">Choose a kind…</span>
    {/if}
    <svg class="chev" viewBox="0 0 16 16" width="10" height="10" aria-hidden="true"><path d="M4 6l4 4 4-4" /></svg>
  </button>
  {#if open}
    <div class="list" role="listbox" aria-label="Kind">
      {#each shown as one (one.value)}
        <button
          type="button"
          role="option"
          aria-selected={one.value === value}
          onclick={() => {
            onpick(one.value);
            shut();
          }}
        >
          <KindIcon kind={one.value} label="" />
          <span class="label">{one.label}</span>
        </button>
      {/each}
    </div>
  {/if}
</div>

<style>
  .pick {
    position: relative;
    min-width: 0;
  }
  .now,
  [role='option'] {
    display: flex;
    align-items: center;
    gap: 8px;
    width: 100%;
    min-width: 0;
    box-sizing: border-box;
    color: var(--ink);
    font: 13px var(--sans);
    text-align: left;
    cursor: pointer;
  }
  .now {
    height: 28px;
    padding: 4px 8px;
    border: 1px solid var(--line);
    border-radius: 6px;
    background: var(--paper);
  }
  .now:disabled {
    opacity: 0.7;
    cursor: not-allowed;
  }
  .label {
    flex: 1;
    min-width: 0;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }
  .unset {
    color: var(--muted);
  }
  .chev {
    flex: none;
    fill: none;
    stroke: var(--muted);
    stroke-width: 1.8;
    stroke-linecap: round;
    stroke-linejoin: round;
  }
  .list {
    position: absolute;
    z-index: 5;
    top: calc(100% + 4px);
    left: 0;
    display: grid;
    grid-template-columns: repeat(2, minmax(0, 1fr));
    gap: 2px;
    width: max(100%, 300px);
    box-sizing: border-box;
    padding: 4px;
    border: 1px solid var(--line);
    border-radius: 8px;
    background: var(--surface);
    box-shadow: var(--lift-high);
  }
  [role='option'] {
    padding: 6px 8px;
    border: 0;
    border-radius: 5px;
    background: none;
  }
  [role='option']:hover,
  [role='option']:focus-visible {
    background: color-mix(in oklab, var(--ink) 8%, transparent);
  }
  [role='option'][aria-selected='true'] {
    background: color-mix(in oklab, var(--cable) 16%, transparent);
    font-weight: 600;
  }
</style>
