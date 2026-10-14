<script lang="ts">
  import Icon from './Icon.svelte';
  import Monitor from '@lucide/svelte/icons/monitor';
  import Moon from '@lucide/svelte/icons/moon';
  import Sun from '@lucide/svelte/icons/sun';
  import Settings from '@lucide/svelte/icons/settings';
  import { debug } from './debug.svelte.ts';
  import { theme } from './theme.svelte.ts';
  import { toasts } from './toast.svelte.ts';

  const copyLog = async () => {
    const text = await debug.read();
    if (!text) {
      toasts.show('The debug log is empty. Turn it on, then do what went wrong.');
      return;
    }
    const copied = await navigator.clipboard.writeText(text).then(
      () => true,
      () => false,
    );
    if (copied) toasts.show('Last 300 entries copied');
    else toasts.show("Copy is blocked here: the log is debug.jsonl in Koppler's run folder", 'warning');
  };

  const THEMES = [
    ['system', 'Like your system', Monitor],
    ['light', 'Light', Sun],
    ['dark', 'Dark', Moon],
  ] as const;
</script>

<button class="open" type="button" popovertarget="settings" aria-label="Settings" title="Settings">
  <Icon of={Settings} size={16} />
</button>
<div class="pop" id="settings" popover aria-label="Settings">
  <div class="row log">
    <label
      class="switch"
      title={debug.forced
        ? 'Always on while Koppler runs from its source folder, so every problem can be traced.'
        : 'Keeps every click, change and message on this canvas, so a problem can be traced. Nothing you type is kept.'}
    >
      <input type="checkbox" role="switch" bind:checked={debug.on} disabled={debug.forced} /><span
        class="track"
        aria-hidden="true"
      ></span>Debug log
    </label>
    {#if debug.on}
      <button class="text" type="button" onclick={copyLog}>Copy</button>
      <button
        class="text"
        type="button"
        onclick={() => {
          debug.clear();
          toasts.show('Debug log cleared');
        }}>Clear</button
      >
    {/if}
  </div>
  <div class="row" role="radiogroup" aria-label="Theme">
    <span>Theme</span>
    {#each THEMES as [name, title, icon] (name)}
      <button
        type="button"
        role="radio"
        aria-checked={theme.now === name}
        aria-label={title}
        {title}
        onclick={() => {
          theme.pick(name);
        }}
      >
        <Icon of={icon} size={14} />
      </button>
    {/each}
  </div>
</div>

<style>
  .open {
    display: grid;
    place-items: center;
    width: 32px;
    height: 32px;
    padding: 0;
    border: 0;
    border-radius: 8px;
    background: none;
    color: var(--muted);
    cursor: pointer;
    anchor-name: --settings;
  }
  .open:hover {
    background: color-mix(in oklab, var(--ink) 7%, transparent);
  }
  .pop {
    inset: auto auto 56px 12px;
    margin: 0;
    padding: 10px 12px;
    border: 1px solid var(--line);
    border-radius: 10px;
    background: var(--surface);
    color: var(--ink);
    box-shadow: var(--lift);
    font: 13px var(--sans);
  }
  .row {
    display: flex;
    align-items: center;
    gap: 4px;
  }
  .log {
    margin-bottom: 8px;
    padding-bottom: 8px;
    border-bottom: 1px solid var(--line);
  }
  .switch {
    position: relative;
    display: flex;
    flex: 1;
    align-items: center;
    gap: 8px;
    min-height: 28px;
    margin-right: 8px;
    font-weight: 600;
    cursor: pointer;
  }
  .switch input {
    position: absolute;
    z-index: 1;
    inset: 0;
    width: 100%;
    height: 100%;
    margin: 0;
    opacity: 0;
    cursor: pointer;
  }
  .switch input:disabled {
    cursor: not-allowed;
  }
  .track {
    position: relative;
    flex: none;
    width: 28px;
    height: 16px;
    border-radius: 999px;
    background: color-mix(in oklab, var(--ink) 22%, transparent);
    transition: background 0.15s;
  }
  .track::after {
    content: '';
    position: absolute;
    top: 2px;
    left: 2px;
    width: 12px;
    height: 12px;
    border-radius: 50%;
    background: var(--surface);
    box-shadow: 0 1px 2px rgb(0 0 0 / 0.3);
    transition: translate 0.15s;
  }
  .switch input:checked + .track {
    background: var(--cable);
  }
  .switch input:checked + .track::after {
    translate: 12px;
  }
  .switch input:focus-visible + .track {
    outline: 2px solid var(--cable);
    outline-offset: 2px;
  }
  @media (prefers-reduced-motion: reduce) {
    .track,
    .track::after {
      transition: none;
    }
  }
  .row button.text {
    width: auto;
    padding: 0 10px;
    border-color: var(--line);
    color: var(--ink);
    font: 600 12px var(--sans);
  }
  .row span {
    margin-right: 8px;
    color: var(--muted);
  }
  .row button {
    display: grid;
    place-items: center;
    width: 30px;
    height: 28px;
    padding: 0;
    border: 1px solid transparent;
    border-radius: 6px;
    background: none;
    color: var(--muted);
    cursor: pointer;
  }
  .row button:hover {
    background: color-mix(in oklab, var(--ink) 7%, transparent);
  }
  .row button[aria-checked='true'] {
    border-color: var(--line);
    background: var(--paper);
    color: var(--ink);
  }
</style>
