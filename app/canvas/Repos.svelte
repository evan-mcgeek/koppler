<script lang="ts">
  // The repo picker: which of the clones found on this machine belong to the stack. Only the ticked ones are added,
  // as apps that are not set up yet.
  import { SvelteMap } from 'svelte/reactivity';
  import { KINDS, of as kindOf } from '../src/core/kinds.ts';
  import { board } from './board.svelte.ts';
  import { post, repos, type Candidate } from './data.ts';
  import { dialogs } from './dialogs.svelte.ts';

  let dialog = $state<HTMLDialogElement>();
  let found = $state.raw<{ roots: string[]; repos: Candidate[] } | null>(null);
  let query = $state('');
  let error = $state('');
  let adding = $state(false);
  /** What is ticked, by repo: the name it gets in the stack and its kind. */
  const picks = new SvelteMap<string, { name: string; kind: string }>();
  const all = $derived((found?.repos ?? []).filter(repo => !repo.inStack));
  const shown = $derived(
    all.filter(repo => `${repo.name} ${repo.slug} ${repo.folder}`.toLowerCase().includes(query.trim().toLowerCase())),
  );
  const folders = $derived([...new Set(shown.map(repo => repo.folder))]);
  const count = (n: number, one: string) => `${String(n)} ${one}${n === 1 ? '' : 's'}`;

  export async function open(): Promise<void> {
    picks.clear();
    query = '';
    error = '';
    found = await repos();
    dialog?.showModal();
  }
  const pick = (repo: Candidate, on: boolean, change: Partial<{ name: string; kind: string }> = {}) => {
    error = '';
    if (!on) picks.delete(repo.slug);
    else picks.set(repo.slug, { name: repo.name, kind: repo.kind ?? '', ...picks.get(repo.slug), ...change });
  };
  const pickFolder = (folder: string) => {
    const rows = all.filter(repo => repo.folder === folder);
    const every = rows.every(repo => picks.has(repo.slug));
    for (const repo of rows) pick(repo, !every);
  };
  const add = async () => {
    const unsure = all.find(repo => picks.has(repo.slug) && !picks.get(repo.slug)?.kind);
    if (unsure) {
      error = `Choose what kind of app ${unsure.name} is.`;
      return;
    }
    adding = true;
    const apps = [...picks].map(([slug, { name, kind }]) => ({ slug, name: name.trim() || slug, kind }));
    const said = await post('apps', { apps });
    adding = false;
    if ('error' in said) {
      error = said.error;
      return;
    }
    // The stack changed: what the new repos say is shown next, and then the page opens again with it.
    dialog?.close();
    if (dialogs.findings) void dialogs.findings.open({ afterAdding: true });
    else location.reload();
  };
</script>

<dialog
  bind:this={dialog}
  aria-labelledby="repos-title"
  oncancel={ev => {
    // Once repos are ticked, a stray Escape does not lose them.
    if (picks.size) ev.preventDefault();
  }}
>
  <button class="x" type="button" aria-label="Close" onclick={() => dialog?.close()}>×</button>
  <h2 id="repos-title">{board.apps.length ? 'Add repos to' : 'Add your repos to'} {board.stack}</h2>
  <p class="sub">
    {#if found}
      Tick every repo you might want to run in {board.stack}: this is the full list you will choose from. Which ones run
      together is decided later on the board. Koppler found {all.length} on this Mac, under {found.roots.join(', ')}.
    {:else}
      No scan of your repos yet. Run koppler init.
    {/if}
  </p>
  <input type="search" placeholder="Find a repo" aria-label="Find a repo" autocomplete="off" bind:value={query} />
  <div class="list">
    {#each folders as folder (folder)}
      {@const rows = shown.filter(repo => repo.folder === folder)}
      {@const picked = rows.filter(repo => picks.has(repo.slug)).length}
      <details open>
        <summary>
          <span class="folder">{folder}</span>
          <span class="n">{count(rows.length, 'repo')}{picked ? `, ${String(picked)} picked` : ''}</span>
          <button
            class="link"
            type="button"
            onclick={() => {
              pickFolder(folder);
            }}>{picked === rows.length ? 'Clear these' : `Pick all ${String(rows.length)}`}</button
          >
        </summary>
        {#each rows as repo (repo.slug)}
          {@const mine = picks.get(repo.slug)}
          <div class="pick" class:on={!!mine}>
            <input
              type="checkbox"
              aria-label="Add {repo.name}"
              checked={!!mine}
              onchange={ev => {
                pick(repo, ev.currentTarget.checked);
              }}
            />
            <span class="who">
              <input
                class="name"
                aria-label="Name of {repo.slug} in the stack"
                maxlength="80"
                spellcheck="false"
                value={mine?.name ?? repo.name}
                oninput={ev => {
                  if (mine) pick(repo, true, { name: ev.currentTarget.value });
                }}
              />
              <span class="slug" title={repo.path}>{repo.slug}</span>
            </span>
            {#if repo.kind}
              <span class="kind kind-{repo.kind}">{kindOf({ kind: repo.kind }).label}</span>
            {:else}
              <select
                aria-label="Kind of app for {repo.name}"
                value={mine?.kind ?? ''}
                onchange={ev => {
                  pick(repo, true, { kind: ev.currentTarget.value });
                }}
              >
                <option value="">Kind?</option>
                {#each Object.entries(KINDS) as [kind, { label }] (kind)}<option value={kind}>{label}</option>{/each}
              </select>
            {/if}
          </div>
        {/each}
      </details>
    {:else}
      <p class="none">{all.length ? 'No repo matches.' : 'Every clone found is already in the stack.'}</p>
    {/each}
  </div>
  <p class="error" role="alert">{error}</p>
  <div class="acts">
    <span class="count">{picks.size ? `${String(picks.size)} picked` : 'Nothing picked yet'}</span>
    <button type="button" onclick={() => dialog?.close()}>Cancel</button>
    <button class="go" type="button" disabled={!picks.size || adding} onclick={add}>
      {adding ? 'Adding…' : picks.size ? `Add ${count(picks.size, 'app')}` : 'Add apps'}
    </button>
  </div>
</dialog>

<style>
  dialog {
    display: none;
    flex-direction: column;
    gap: 10px;
    width: min(620px, calc(100vw - 32px));
    max-height: min(720px, calc(100vh - 48px));
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
    margin: 0 28px 0 0;
    font-size: 17px;
  }
  .sub {
    margin: 0;
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
  input[type='search'] {
    height: 30px;
    padding: 0 8px;
    border: 1px solid var(--line);
    border-radius: 6px;
    background: var(--paper);
    color: var(--ink);
    font: 13px var(--sans);
  }
  .list {
    flex: 1;
    min-height: 120px;
    overflow-y: auto;
    border: 1px solid var(--line);
    border-radius: 10px;
  }
  details + details {
    border-top: 1px solid var(--line);
  }
  summary {
    position: sticky;
    top: 0;
    z-index: 1;
    display: flex;
    align-items: center;
    gap: 8px;
    padding: 8px 12px;
    background: var(--panel);
    cursor: pointer;
  }
  .folder {
    font: 600 12px var(--mono);
  }
  .n {
    flex: 1;
    color: var(--muted);
    font-size: 12px;
  }
  .link {
    padding: 0;
    border: 0;
    background: none;
    color: var(--cable-ink);
    font: 600 12px var(--sans);
    cursor: pointer;
  }
  /* A row reads as a line of text: its name turns into a field only when it is pointed at or typed in. */
  .pick {
    display: grid;
    grid-template-columns: 18px minmax(0, 1fr) 96px;
    align-items: center;
    column-gap: 10px;
    padding: 5px 12px;
  }
  .pick:hover {
    background: color-mix(in oklab, var(--ink) 5%, transparent);
  }
  .pick.on {
    background: color-mix(in oklab, var(--cable) 8%, transparent);
  }
  .pick input[type='checkbox'] {
    width: 16px;
    height: 16px;
    margin: 0;
    accent-color: var(--cable);
  }
  .who {
    display: grid;
    min-width: 0;
  }
  .name {
    width: 100%;
    margin-left: -6px;
    padding: 2px 6px;
    border: 1px solid transparent;
    border-radius: 5px;
    background: none;
    color: var(--muted);
    font: 500 13.5px var(--sans);
    text-overflow: ellipsis;
  }
  .pick.on .name {
    color: var(--ink);
  }
  .name:hover,
  .name:focus {
    border-color: var(--line);
    background: var(--paper);
    color: var(--ink);
    outline: 0;
  }
  .name:focus {
    border-color: var(--cable);
  }
  .slug {
    overflow: hidden;
    color: var(--muted);
    font: 12px var(--mono);
    text-overflow: ellipsis;
    white-space: nowrap;
  }
  /* The kind sits in one column, whether it was told from the repo or has to be chosen. */
  .kind {
    justify-self: start;
    padding: 1px 7px;
    border-radius: 999px;
    background: color-mix(in oklab, var(--kind) 14%, transparent);
    color: var(--kind);
    font: 600 12px/1.5 var(--sans);
    white-space: nowrap;
  }
  select {
    width: 100%;
    height: 24px;
    padding: 0 4px;
    border: 1px solid var(--warn);
    border-radius: 5px;
    background: var(--paper);
    color: var(--ink);
    font: 12px var(--sans);
  }
  .none {
    margin: 16px 12px;
    color: var(--muted);
  }
  .error {
    min-height: 1.45em;
    margin: 0;
    color: var(--bad);
  }
  .acts {
    display: flex;
    align-items: center;
    gap: 8px;
  }
  .count {
    flex: 1;
    color: var(--muted);
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
