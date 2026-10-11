<script lang="ts">
  import { toasts } from './toast.svelte.ts';

  let copied = $state(false);
  const copy = async (text: string) => {
    await navigator.clipboard.writeText(text).catch(() => undefined);
    copied = true;
    setTimeout(() => (copied = false), 1500);
  };
</script>

{#if toasts.now}
  {@const { text, warning, action } = toasts.now}
  <div class="toast" class:warning role={warning ? 'alert' : 'status'}>
    <span class="text">{text}</span>
    {#if action}
      <button
        class="action"
        type="button"
        onclick={() => {
          action.run();
          toasts.hide();
        }}>{action.label}</button
      >
    {/if}
    {#if warning}
      <button class="action" type="button" onclick={() => copy(text)}>{copied ? 'Copied' : 'Copy'}</button>
    {/if}
    <button
      class="close"
      type="button"
      aria-label="Dismiss"
      onclick={() => {
        toasts.hide();
      }}>×</button
    >
  </div>
{/if}

<style>
  .toast {
    position: absolute;
    left: 50%;
    top: 12px;
    z-index: 10;
    translate: -50% 0;
    display: flex;
    align-items: center;
    gap: 10px;
    max-width: min(460px, calc(100% - 32px));
    padding: 9px 12px 9px 14px;
    border: 1px solid var(--line);
    border-radius: 9px;
    background: var(--surface);
    color: var(--ink);
    box-shadow: var(--lift);
    font: 500 13px/1.4 var(--sans);
  }
  .toast.warning {
    border-color: color-mix(in oklab, var(--bad) 60%, var(--line));
  }
  .text {
    flex: 1;
    min-width: 0;
    overflow-wrap: anywhere;
    user-select: text;
  }
  .warning .text::before {
    content: '!';
    display: inline-grid;
    place-items: center;
    width: 16px;
    height: 16px;
    margin-right: 8px;
    border-radius: 50%;
    background: var(--bad);
    color: var(--on-accent);
    font-size: 12px;
    font-weight: 700;
    vertical-align: -2px;
  }
  .action {
    flex: none;
    padding: 2px 8px;
    border: 1px solid var(--line);
    border-radius: 5px;
    background: none;
    color: var(--ink);
    font: 600 13px var(--sans);
    cursor: pointer;
  }
  .action:hover {
    border-color: var(--cable);
    color: var(--cable);
  }
  .close {
    flex: none;
    width: 24px;
    height: 24px;
    margin: -2px -4px -2px 0;
    padding: 0;
    border: 0;
    border-radius: 5px;
    background: none;
    color: var(--muted);
    font-size: 16px;
    line-height: 1;
    cursor: pointer;
  }
  .close:hover {
    background: color-mix(in oklab, var(--ink) 10%, transparent);
    color: var(--ink);
  }
</style>
