<script lang="ts">
  // A command for the terminal: wherever the canvas shows one, it is this box with its Copy button.
  import { toasts } from './toast.svelte.ts';

  const { command, label }: { command: string; label?: string | undefined } = $props();
  let copied = $state(false);
  const copy = async () => {
    const done = await navigator.clipboard.writeText(command).then(
      () => true,
      () => false,
    );
    if (!done) {
      toasts.show('Copy is blocked here. Select the command and copy it.', 'warning');
      return;
    }
    copied = true;
    setTimeout(() => (copied = false), 1500);
  };
</script>

<span class="cmd nodrag nopan">
  <code>{command}</code>
  <button type="button" title="Copy this command" aria-label={label} onclick={copy}>{copied ? 'Copied' : 'Copy'}</button
  >
</span>

<style>
  .cmd {
    display: flex;
    align-items: start;
    gap: 8px;
    min-width: 0;
  }
  code {
    flex: 1;
    min-width: 0;
    padding: 5px 8px;
    max-height: 132px;
    overflow-y: auto;
    border: 1px solid var(--line);
    border-radius: 6px;
    background: var(--paper);
    color: var(--ink);
    font: 12px var(--mono);
    white-space: pre-wrap;
    overflow-wrap: anywhere;
    cursor: text;
  }
  button {
    flex: none;
    padding: 4px 10px;
    border: 1px solid var(--line);
    border-radius: 6px;
    background: none;
    color: var(--ink);
    font: 600 12px var(--sans);
    cursor: pointer;
  }
  button:hover {
    background: color-mix(in oklab, var(--ink) 7%, transparent);
  }
</style>
