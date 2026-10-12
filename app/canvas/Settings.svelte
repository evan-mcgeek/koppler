<script lang="ts">
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
    [
      'system',
      'Like your system',
      [
        'M3.5 3h9a1.5 1.5 0 0 1 1.5 1.5v5.5a1.5 1.5 0 0 1-1.5 1.5h-9A1.5 1.5 0 0 1 2 10V4.5A1.5 1.5 0 0 1 3.5 3z',
        'M6 14h4M8 11.5V14',
      ],
    ],
    [
      'light',
      'Light',
      [
        'M11 8a3 3 0 1 1-6 0 3 3 0 0 1 6 0z',
        'M8 1.5v1.5M8 13v1.5M1.5 8H3M13 8h1.5M3.4 3.4l1 1M11.6 11.6l1 1M3.4 12.6l1-1M11.6 4.4l1-1',
      ],
    ],
    ['dark', 'Dark', ['M13.2 9.6A5.5 5.5 0 0 1 6.4 2.8a5.5 5.5 0 1 0 6.8 6.8z']],
  ] as const;
</script>

<button class="open" type="button" popovertarget="settings" aria-label="Settings" title="Settings">
  <svg viewBox="0 0 24 24" width="16" height="16" aria-hidden="true"
    ><path
      d="M12.22 2h-.44a2 2 0 0 0-2 2v.18a2 2 0 0 1-1 1.73l-.43.25a2 2 0 0 1-2 0l-.15-.08a2 2 0 0 0-2.73.73l-.22.38a2 2 0 0 0 .73 2.73l.15.1a2 2 0 0 1 1 1.72v.51a2 2 0 0 1-1 1.74l-.15.09a2 2 0 0 0-.73 2.73l.22.38a2 2 0 0 0 2.73.73l.15-.08a2 2 0 0 1 2 0l.43.25a2 2 0 0 1 1 1.73V20a2 2 0 0 0 2 2h.44a2 2 0 0 0 2-2v-.18a2 2 0 0 1 1-1.73l.43-.25a2 2 0 0 1 2 0l.15.08a2 2 0 0 0 2.73-.73l.22-.39a2 2 0 0 0-.73-2.73l-.15-.08a2 2 0 0 1-1-1.74v-.5a2 2 0 0 1 1-1.74l.15-.09a2 2 0 0 0 .73-2.73l-.22-.38a2 2 0 0 0-2.73-.73l-.15.08a2 2 0 0 1-2 0l-.43-.25a2 2 0 0 1-1-1.73V4a2 2 0 0 0-2-2z"
    /><circle cx="12" cy="12" r="3" /></svg
  >
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
    {#each THEMES as [name, title, paths] (name)}
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
        <svg viewBox="0 0 16 16" width="14" height="14" aria-hidden="true">
          {#each paths as d (d)}<path {d} />{/each}
        </svg>
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
  svg {
    fill: none;
    stroke: currentColor;
    stroke-width: 1.4;
    stroke-linecap: round;
    stroke-linejoin: round;
  }
  .open svg {
    stroke-width: 2;
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
