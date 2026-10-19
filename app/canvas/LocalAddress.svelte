<script lang="ts">
  // Where a database runs on this Mac, in its settings: kept here only, never in the stack.
  import { addressText, localDatabases } from './local-databases.svelte.ts';

  const { database }: { database: string } = $props();
  void localDatabases.load();
  const at = $derived(localDatabases.addresses[database]);
  let editing = $state(false);
  let host = $state('');
  let port = $state('');
  let name = $state('');
  let problem = $state('');
  const edit = () => {
    host = at?.host ?? 'localhost';
    port = at ? String(at.port) : '';
    name = at?.database ?? '';
    problem = '';
    editing = true;
  };
  const keep = async () => {
    const refused = await localDatabases.keep(database, {
      host: host.trim(),
      port: Number(port),
      ...(name.trim() && { database: name.trim() }),
    });
    if (refused) problem = refused;
    else editing = false;
  };
</script>

<section class="local" aria-label="Local, this Mac">
  <span class="label">Local, this Mac</span>
  {#if editing}
    <form
      onsubmit={ev => {
        ev.preventDefault();
        void keep();
      }}
    >
      <label>Host<input class="mono" bind:value={host} autocomplete="off" spellcheck="false" /></label>
      <label>Port<input class="mono" bind:value={port} inputmode="numeric" autocomplete="off" /></label>
      <label class="wide"
        >Database name<input class="mono" bind:value={name} autocomplete="off" spellcheck="false" /></label
      >
      {#if problem}<p class="bad">{problem}</p>{/if}
      <span class="acts">
        <button class="text" type="button" onclick={() => (editing = false)}>Cancel</button>
        <button class="text" type="submit">Keep</button>
      </span>
    </form>
  {:else}
    <span class="at">
      {#if at}<span class="mono">{addressText(at)}</span>{:else}<span class="none"
          >Not set. Asked the first time you switch to Local.</span
        >{/if}
      <button class="link" type="button" onclick={edit}>{at ? 'Change' : 'Set'}</button>
      {#if at}<button class="link" type="button" onclick={() => void localDatabases.forget(database)}>Forget</button
        >{/if}
    </span>
  {/if}
  <small>Kept on this Mac only, never in the stack.</small>
</section>

<style>
  .local {
    display: grid;
    gap: 6px;
    padding: 12px 0 16px;
    border-bottom: 1px solid var(--line);
  }
  .label {
    color: var(--ink-muted);
    font: 12px var(--sans);
  }
  .at {
    display: flex;
    align-items: center;
    gap: 12px;
  }
  .mono {
    font: 12px var(--mono);
  }
  .none,
  small {
    color: var(--ink-muted);
    font: 12px var(--sans);
  }
  form {
    display: grid;
    grid-template-columns: minmax(0, 1fr) 90px;
    gap: 10px;
  }
  form label {
    display: grid;
    gap: 4px;
    color: var(--ink-muted);
    font: 12px var(--sans);
  }
  form .wide,
  form .bad,
  form .acts {
    grid-column: 1 / -1;
  }
  form input {
    box-sizing: border-box;
    width: 100%;
    min-width: 0;
    padding: 7px 9px;
    border: 1px solid var(--line-strong);
    background: var(--desk);
    color: var(--ink);
  }
  .bad {
    margin: 0;
    color: var(--warn);
    font-size: 12px;
  }
  .acts {
    display: flex;
    justify-content: flex-end;
    gap: 8px;
  }
  .text {
    padding: 6px 14px;
    border: 1px solid var(--line-strong);
    background: none;
    color: var(--ink);
    font: 600 13px var(--sans);
    cursor: pointer;
  }
</style>
