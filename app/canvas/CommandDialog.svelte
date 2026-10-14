<script lang="ts">
  import Icon from './Icon.svelte';
  import X from '@lucide/svelte/icons/x';
  // Before one of an app's commands runs: the values it asks for, and its question when it changes data.
  import { runCommand, type AppCommandAsk } from './commands.ts';

  let dialog = $state<HTMLDialogElement>();
  let ask = $state.raw<AppCommandAsk | null>(null);
  let values = $state<Record<string, string>>({});
  let error = $state('');
  let running = $state(false);

  export function open(what: AppCommandAsk): void {
    ask = what;
    values = Object.fromEntries((what.command.args ?? []).map(one => [one.name, one.choices?.[0] ?? '']));
    error = '';
    dialog?.showModal();
  }
  const go = async (ev: SubmitEvent) => {
    ev.preventDefault();
    if (!ask) return;
    running = true;
    error = (await runCommand(ask, values)) ?? '';
    running = false;
    if (!error) dialog?.close();
  };
</script>

<dialog bind:this={dialog} aria-labelledby="command-title">
  {#if ask}
    {@const { command, appName } = ask}
    <button class="x" type="button" aria-label="Close" onclick={() => dialog?.close()}><Icon of={X} size={14} /></button
    >
    <h2 id="command-title">{command.label} on {appName}</h2>
    {#if command.confirm}<p class="ask">{command.confirm}</p>{/if}
    <form onsubmit={go}>
      {#each command.args ?? [] as one (one.name)}
        <label>
          <span
            >{one.label ?? one.name}{#if !one.required}<span class="opt"> optional</span>{/if}</span
          >
          {#if one.type === 'choice'}
            <select bind:value={values[one.name]}>
              {#each one.choices ?? [] as choice (choice)}<option value={choice}>{choice}</option>{/each}
            </select>
          {:else}
            <input
              bind:value={values[one.name]}
              required={!!one.required}
              inputmode={one.type === 'number' ? 'decimal' : undefined}
              pattern={one.type === 'number' ? '-?\\d+(\\.\\d+)?' : undefined}
            />
          {/if}
        </label>
      {/each}
      <p class="error" role="alert">{error}</p>
      <div class="acts">
        <button type="button" onclick={() => dialog?.close()}>Cancel</button>
        <button class="go" class:danger={!!command.confirm} type="submit" disabled={running}>{command.label}</button>
      </div>
    </form>
  {/if}
</dialog>

<style>
  dialog {
    width: min(420px, calc(100vw - 32px));
    padding: 20px;
    border: 1px solid var(--line);
    border-radius: 14px;
    background: var(--surface);
    color: var(--ink);
    box-shadow: var(--lift-high);
    font: 13px/1.45 var(--sans);
  }
  dialog::backdrop {
    background: color-mix(in oklab, var(--desk) 60%, transparent);
  }
  h2 {
    margin: 0 28px 10px 0;
    font-size: 17px;
  }
  .ask {
    margin: 0 0 12px;
  }
  .x {
    position: absolute;
    top: 12px;
    right: 12px;
    width: 28px;
    height: 28px;
    border: 0;
    border-radius: 7px;
    background: none;
    color: var(--muted);
    cursor: pointer;
  }
  form {
    display: grid;
    gap: 12px;
  }
  label {
    display: grid;
    gap: 4px;
    font-weight: 600;
  }
  .opt {
    color: var(--muted);
    font-weight: 400;
  }
  input,
  select {
    height: 32px;
    padding: 0 8px;
    border: 1px solid var(--line);
    border-radius: 6px;
    background: var(--paper);
    color: var(--ink);
    font: 13px var(--sans);
  }
  .error {
    min-height: 1.45em;
    margin: 0;
    color: var(--bad);
  }
  .error:empty {
    display: none;
  }
  .acts {
    display: flex;
    justify-content: flex-end;
    gap: 8px;
  }
  .acts button {
    padding: 6px 12px;
    border: 1px solid var(--line);
    border-radius: 8px;
    background: none;
    color: var(--ink);
    font: 600 13px var(--sans);
    cursor: pointer;
  }
  .acts .go {
    border-color: transparent;
    background: var(--cable);
    color: var(--on-accent);
  }
  .acts .go.danger {
    background: var(--bad);
  }
  .acts button:disabled {
    opacity: 0.5;
    cursor: not-allowed;
  }
</style>
