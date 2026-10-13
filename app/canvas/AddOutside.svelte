<script lang="ts">
  // An outside system: something that never runs here (a SaaS API, a managed service). It joins the stack with the apps
  // that call it and the apps it calls (a webhook), and shows as a dashed card next to them.
  import { board } from './board.svelte.ts';
  import { post } from './data.ts';

  let dialog = $state<HTMLDialogElement>();
  let name = $state('');
  let url = $state('');
  let why = $state('');
  let callers = $state<Record<string, boolean>>({});
  let called = $state<Record<string, boolean>>({});
  let error = $state('');
  let adding = $state(false);
  const apps = $derived(board.apps.filter(app => !app.outside));
  const ids = (on: Record<string, boolean>) => apps.filter(app => on[app.id]).map(app => app.id);

  export function open(): void {
    name = '';
    url = '';
    why = '';
    callers = {};
    called = {};
    error = '';
    dialog?.showModal();
  }
  const add = async (ev: SubmitEvent) => {
    ev.preventDefault();
    const calledBy = ids(callers);
    const sendsTo = ids(called);
    if (!calledBy.length && !sendsTo.length) {
      error = `Pick the apps that call ${name.trim() || 'it'}, or that it calls: its card shows next to them.`;
      return;
    }
    adding = true;
    const said = await post('apps-outside', { name, url, why, calledBy, sendsTo });
    adding = false;
    if ('error' in said) {
      error = said.error;
      return;
    }
    dialog?.close();
    location.reload();
  };
</script>

<dialog bind:this={dialog} aria-labelledby="outside-title">
  <button class="x" type="button" aria-label="Close" onclick={() => dialog?.close()}>×</button>
  <h2 id="outside-title">Add an outside system</h2>
  <p class="sub">
    A service that never runs on this Mac, such as a payment provider or a SaaS API: your apps call it, or it calls them
    (a webhook).
  </p>
  <form onsubmit={add}>
    <label>
      Name
      <input bind:value={name} required maxlength="80" placeholder="Stripe" />
    </label>
    <label>
      <span>Address <span class="opt">optional</span></span>
      <input bind:value={url} type="url" placeholder="https://api.stripe.com" />
    </label>
    <label>
      <span>What it is <span class="opt">optional</span></span>
      <input bind:value={why} maxlength="200" placeholder="Payment provider" />
    </label>
    <fieldset>
      <legend>Your apps</legend>
      <div class="callers">
        <span class="head" aria-hidden="true"><span></span><span>Calls it</span><span>Gets its calls</span></span>
        {#each apps as app (app.id)}
          <span class="row">
            <span class="who">{app.name}</span>
            <input
              type="checkbox"
              aria-label="{app.name} calls it"
              checked={!!callers[app.id]}
              onchange={ev => {
                callers[app.id] = ev.currentTarget.checked;
                error = '';
              }}
            />
            <input
              type="checkbox"
              aria-label="{app.name} gets its calls"
              checked={!!called[app.id]}
              onchange={ev => {
                called[app.id] = ev.currentTarget.checked;
                error = '';
              }}
            />
          </span>
        {/each}
      </div>
    </fieldset>
    <p class="error" role="alert">{error}</p>
    <div class="acts">
      <button type="button" onclick={() => dialog?.close()}>Cancel</button>
      <button class="go" type="submit" disabled={adding}>{adding ? 'Adding…' : 'Add'}</button>
    </div>
  </form>
</dialog>

<style>
  dialog {
    width: min(480px, calc(100vw - 32px));
    max-height: min(720px, calc(100vh - 48px));
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
    margin: 0 28px 4px 0;
    font-size: 17px;
  }
  .sub {
    margin: 0 0 14px;
    color: var(--muted);
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
    font-size: 18px;
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
  input:not([type='checkbox']) {
    height: 32px;
    padding: 0 8px;
    border: 1px solid var(--line);
    border-radius: 6px;
    background: var(--paper);
    color: var(--ink);
    font: 13px var(--sans);
  }
  fieldset {
    margin: 0;
    padding: 0;
    border: 0;
  }
  legend {
    margin-bottom: 4px;
    padding: 0;
    font-weight: 600;
  }
  .callers {
    display: grid;
    align-content: start;
    max-height: 200px;
    overflow-y: auto;
    padding: 4px 0;
    border: 1px solid var(--line);
    border-radius: 10px;
  }
  .head,
  .row {
    display: grid;
    grid-template-columns: minmax(0, 1fr) 72px 104px;
    align-items: center;
    padding: 5px 12px;
  }
  .head {
    color: var(--muted);
    font-size: 12px;
  }
  .head span,
  .row input {
    justify-self: center;
  }
  .row:hover {
    background: color-mix(in oklab, var(--ink) 5%, transparent);
  }
  .who {
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }
  .row input {
    width: 16px;
    height: 16px;
    margin: 0;
    accent-color: var(--cable);
    cursor: pointer;
  }
  .error {
    min-height: 1.45em;
    margin: 0;
    color: var(--bad);
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
  .acts button:disabled {
    opacity: 0.5;
    cursor: not-allowed;
  }
</style>
