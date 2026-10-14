<script lang="ts">
  // What the repos say about the stack's apps: where each runs locally, its deployed addresses, who calls whom.
  // Shown for review; only what stays ticked is written to the stack.
  import { SvelteSet } from 'svelte/reactivity';
  import { board } from './board.svelte.ts';
  import { post } from './data.ts';
  import { toasts } from './toast.svelte.ts';

  interface Finding {
    id: string;
    kind: 'alias' | 'call' | 'address' | 'url';
    app?: string;
    to?: string;
    env?: string;
    value?: string;
    why?: string;
    /** The environment name it follows from: it goes with it. */
    needs?: string;
  }
  const GROUPS = [
    ['alias', 'Environment names', 'The repos name an environment differently from this stack.'],
    ['call', 'Who calls whom', "Found by another app's address in the code. Becomes a cable you can plug."],
    [
      'address',
      'Deployed addresses',
      "From each app's Terraform. Used to find the calls above, and what an app calls when the other one is not running here.",
    ],
    ['url', 'Where each app runs on this Mac', 'From launch settings and config. The port Koppler starts it on.'],
  ] as const;
  let dialog = $state<HTMLDialogElement>();
  let findings = $state.raw<Finding[]>([]);
  let after = $state(false);
  let busy = $state(false);
  const kept = new SvelteSet<string>();
  const name = (id = '') => board.nameOf(id);
  const usable = (one: Finding) => !one.needs || kept.has(one.needs);
  const count = $derived(findings.filter(one => kept.has(one.id) && usable(one)).length);

  /** Looks through the repos and shows what is new. After adding repos, having nothing to show just opens the stack. */
  export async function open({ afterAdding = false } = {}): Promise<void> {
    after = afterAdding;
    toasts.show('Looking through the repos…');
    const said = await post<{ findings: Finding[] }>('discover');
    if ('error' in said) {
      toasts.show(said.error, 'warning');
      if (afterAdding)
        setTimeout(() => {
          location.reload();
        }, 1500);
      return;
    }
    if (!said.findings.length) {
      if (afterAdding) location.reload();
      else toasts.show('Nothing new found in the repos.');
      return;
    }
    findings = said.findings;
    kept.clear();
    for (const one of findings) kept.add(one.id);
    toasts.hide();
    dialog?.showModal();
  }
  /** Closing it after repos were added opens the page again with them. */
  const done = () => dialog?.close();
  const apply = async () => {
    const ids = findings.filter(one => kept.has(one.id) && usable(one)).map(one => one.id);
    if (!ids.length) {
      done();
      return;
    }
    busy = true;
    const said = await post('discover-apply', { ids });
    busy = false;
    if ('error' in said) toasts.show(said.error, 'warning');
    else location.reload();
  };
</script>

<dialog
  bind:this={dialog}
  aria-labelledby="findings-title"
  onclose={() => {
    if (after) location.reload();
  }}
>
  <h2 id="findings-title">{after ? 'Here is what Koppler found' : 'What the repos say'}</h2>
  <p class="sub">
    Keep what looks right. It goes into the stack, so the canvas can show calls and Koppler can start and connect the
    apps. Nothing else changes.
  </p>
  <div class="list">
    {#each GROUPS as [kind, title, hint] (kind)}
      {@const group = findings.filter(one => one.kind === kind)}
      {#if group.length}
        <section>
          <h3>{title} <span>{group.length}</span></h3>
          <p>{hint}</p>
          {#each group as one (one.id)}
            <label>
              <input
                type="checkbox"
                checked={kept.has(one.id) && usable(one)}
                disabled={!usable(one)}
                onchange={ev => {
                  if (ev.currentTarget.checked) kept.add(one.id);
                  else kept.delete(one.id);
                }}
              />
              <span>
                {#if kind === 'alias'}
                  "<strong>{one.value}</strong>" in the repos means <strong>{(one.env ?? '').toUpperCase()}</strong>
                {:else if kind === 'call'}
                  <strong>{name(one.app)}</strong> calls <strong>{name(one.to)}</strong>
                {:else if kind === 'address'}
                  <strong>{name(one.app)}</strong> on {(one.env ?? '').toUpperCase()}: <code>{one.value}</code>
                {:else}
                  <strong>{name(one.app)}</strong> <code>{one.value}</code>
                {/if}
                <small title={one.why}>{kind === 'alias' || kind === 'call' ? one.why : `from ${one.why ?? ''}`}</small>
              </span>
            </label>
          {/each}
        </section>
      {/if}
    {/each}
  </div>
  <div class="acts">
    <button type="button" onclick={done}>{after ? 'Skip' : 'Cancel'}</button>
    <button class="go" type="button" disabled={busy} onclick={apply}>
      {count ? `Add ${String(count)} to the stack` : 'Add nothing'}
    </button>
  </div>
</dialog>

<style>
  dialog {
    display: none;
    flex-direction: column;
    gap: 10px;
    width: min(640px, calc(100vw - 32px));
    max-height: min(760px, calc(100vh - 48px));
    padding: 20px;
    border: 1px solid var(--line);
    border-radius: 14px;
    background: var(--surface);
    color: var(--ink);
    box-shadow: var(--lift-high);
    font: 13px/1.45 var(--sans);
  }
  dialog[open] {
    display: flex;
  }
  dialog::backdrop {
    background: color-mix(in oklab, var(--desk) 60%, transparent);
  }
  h2 {
    margin: 0;
    font-size: 17px;
  }
  .sub,
  section p {
    margin: 0;
    color: var(--muted);
  }
  .list {
    display: grid;
    gap: 14px;
    overflow-y: auto;
  }
  section {
    display: grid;
    gap: 6px;
  }
  h3 {
    margin: 0;
    font-size: 13px;
  }
  h3 span {
    color: var(--muted);
    font-weight: 400;
  }
  section p {
    font-size: 12px;
  }
  label {
    display: grid;
    grid-template-columns: auto minmax(0, 1fr);
    align-items: start;
    gap: 8px;
    padding: 4px 0;
    cursor: pointer;
  }
  label small {
    display: block;
    overflow: hidden;
    color: var(--muted);
    font-size: 12px;
    text-overflow: ellipsis;
    white-space: nowrap;
  }
  code {
    font: 12px var(--mono);
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
    opacity: 0.55;
    cursor: not-allowed;
  }
</style>
