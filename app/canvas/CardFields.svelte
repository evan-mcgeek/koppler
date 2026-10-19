<script lang="ts">
  // A card's choices: on the card itself, or in the side panel while the board is zoomed out.
  import BranchPicker from './BranchPicker.svelte';
  import { board, STARTED_BY } from './board.svelte.ts';

  const { id }: { id: string } = $props();
  const CHANGES = [
    ['set-aside', 'Set aside', 'Kept aside while it runs the other branch, back on Stop'],
    ['take-along', 'Take along', 'Carried to the other branch, and back on Stop'],
  ] as const;
  const data = $derived(board.nodes.find(node => node.id === id)?.data);
  const app = $derived(board.app(id));
  const current = $derived(app?.current || 'current branch');
  const uncommitted = $derived(`${String(app?.dirty ?? 0)} uncommitted ${app?.dirty === 1 ? 'change' : 'changes'}`);
  const starters = $derived(
    (app?.runIn ?? []).map(([value]) => value).filter(value => Object.hasOwn(STARTED_BY, value)),
  );
  const starts = $derived(starters.length > 1);
  /** A mock answers in the app's place: no branch, libraries, calls or note of its own. */
  const mock = $derived(data?.run === 'mock');
  const tunnels = $derived(board.tunnelsOf(id));
  const queues = $derived(board.queuesOf(id));
  const hiddenQueues = $derived(queues.filter(queue => board.hiddenQueues[queue]));
  const noQueues = $derived(queues.length > 0 && !data?.showQueues);
  const databases = $derived(board.databasesOf(id));
  let showing = $state<string | null>(null);
  const local = $derived(board.localLibraries(id));
  const useLocal = (name: string, on: boolean) => {
    board.set(id, { libraries: on ? [...local, name] : local.filter(one => one !== name) });
  };
  const mobile = $derived(!!app?.platforms.length && data?.run === 'cli');
  /** Worked out when the menu is opened. */
  let cables = $state<ReturnType<typeof board.cablesOf>>({ can: [], wired: [] });
  let noting = $state(false);
  const wire = (ev: Event) => {
    const menu = ev.currentTarget as HTMLSelectElement;
    const [what, to] = [menu.value[0], menu.value.slice(1)];
    if (what === '+') board.connect(id, to);
    else if (what === '-') board.cut(id, to);
    menu.value = '';
  };
  const fieldAt = (ev: Event) =>
    (ev.target as Element).closest<HTMLElement>('select, textarea, input:not([type="radio"], [type="checkbox"])');
  // The whole card drags, so a field is held back on a press and opened by the click that follows a press that did
  // not move. One that is being typed in takes the press itself, for the caret, and the card stays.
  const hold = (ev: MouseEvent) => {
    const field = fieldAt(ev);
    if (field === document.activeElement) ev.stopPropagation();
    else if (field) ev.preventDefault();
  };
  const release = (ev: MouseEvent) => {
    const field = fieldAt(ev);
    if (!field || field === document.activeElement) return;
    field.focus();
    if (field instanceof HTMLSelectElement) field.showPicker();
  };
  const grow = (box: HTMLTextAreaElement) => {
    box.style.height = 'auto';
    box.style.height = `${String(box.scrollHeight + 2)}px`;
  };
</script>

{#if data}
  <!-- svelte-ignore a11y_click_events_have_key_events, a11y_no_static_element_interactions -->
  <div class="body" onmousedowncapture={hold} onclick={release}>
    {#if !mock}<label class="field">
        Branch
        <BranchPicker
          value={data.branch}
          current={app?.current ?? ''}
          branches={app?.branches ?? []}
          title={app?.dirty && !board.switchesOver(id) ? `Runs with your ${uncommitted}` : undefined}
          onpick={(branch: string) => {
            board.set(id, { branch });
          }}
        />
      </label>{/if}
    {#if board.switchesOver(id)}
      <div
        class="field"
        role="radiogroup"
        aria-label="Your {uncommitted} on {current}"
        title="Your {uncommitted} on {current}: set aside while it runs the other branch, or taken along. Back on Stop either way."
      >
        {uncommitted}
        <span class="seg">
          {#each CHANGES as [value, label, tip] (value)}
            <label title={tip}>
              <input
                type="radio"
                name="changes-{id}"
                {value}
                checked={(data.changes ?? 'set-aside') === value}
                onchange={() => {
                  board.set(id, { changes: value });
                }}
              />{label}
            </label>
          {/each}
        </span>
      </div>
    {/if}
    {#if starts || tunnels.length || queues.length}
      <div class="row">
        {#if starts}
          <div
            class="field"
            role="group"
            aria-label="Who starts it"
            title="Koppler: the agent starts it. Me: you start it yourself (IDE, terminal, anything); the agent only prepares it.{starters.includes(
              'mock',
            )
              ? ' Mock: Koppler answers its mock responses from the stack in its place.'
              : ''}"
          >
            Started by
            <span class="seg" role="radiogroup" aria-label="Started by">
              {#each starters as value (value)}
                <label>
                  <input
                    type="radio"
                    name="run-{id}"
                    {value}
                    checked={data.run === value}
                    onchange={() => {
                      board.set(id, { run: value });
                    }}
                  />{STARTED_BY[value]}
                </label>
              {/each}
            </span>
          </div>
        {/if}
        {#if mobile}
          <label class="field">
            Platform
            <span class="combo">
              <select
                class="mono"
                value={data.platform}
                onchange={ev => {
                  board.set(id, { platform: ev.currentTarget.value });
                }}
              >
                {#each app?.platforms ?? [] as [value, label] (value)}<option {value}>{label}</option>{/each}
              </select>
            </span>
          </label>
        {/if}
        {#if tunnels.length}
          <div class="field">
            Tunnels
            <label
              class="toggle"
              title={data.hideTunnels
                ? 'Off: only the API runs; calls through its tunnels fail.'
                : 'On: Koppler opens its tunnels. Turn off when you only need the API.'}
            >
              <input
                type="checkbox"
                role="switch"
                aria-label="Open {data.name}'s tunnels"
                checked={!data.hideTunnels}
                onchange={ev => {
                  board.set(id, { hideTunnels: !ev.currentTarget.checked });
                }}
              /><span class="track" aria-hidden="true"></span>{data.hideTunnels ? 'Off' : 'On'}
            </label>
          </div>
        {/if}
        {#if queues.length}
          <div class="field">
            Queues
            <label
              class="toggle"
              title={noQueues
                ? 'Off: it is taken off its queues and keeps the deployed ones. A queue another app uses stays on the board for that app.'
                : 'On: its queues show on the board, where each can be switched to a local copy.'}
            >
              <input
                type="checkbox"
                role="switch"
                aria-label="Show {data.name}'s queues"
                checked={!noQueues}
                onchange={ev => {
                  board.set(id, { showQueues: ev.currentTarget.checked });
                }}
              /><span class="track" aria-hidden="true"></span>{noQueues ? 'Off' : 'On'}
            </label>
            {#if hiddenQueues.length && !noQueues}
              <button
                class="link"
                type="button"
                onclick={() => {
                  board.showQueues(queues, true);
                }}>Show {hiddenQueues.length} hidden</button
              >
            {/if}
          </div>
        {/if}
      </div>
    {/if}
    {#if databases.length}
      <div class="field databases">
        {databases.length > 1 ? 'Databases' : 'Database'}
        {#each databases as database (database)}
          {@const isLocal = !!board.databases[database]}
          {@const change = isLocal ? board.useOf(id, database)?.change : undefined}
          <span class="database">
            <span class="db-name">{board.databaseName(database)}{isLocal ? ' · Local' : ''}</span>
            {#if change}
              <button
                class="link"
                type="button"
                aria-expanded={showing === database}
                onclick={() => (showing = showing === database ? null : database)}
                >{showing === database ? 'Hide change' : 'Show change'}</button
              >
            {:else if !isLocal}
              <label
                class="toggle"
                title="Off draws its cable straight to the database; the tunnel keeps working, only the drawing changes."
              >
                <input
                  type="checkbox"
                  role="switch"
                  aria-label="Show the tunnel to {board.databaseName(database)}"
                  checked={board.tunnelShown(id, database)}
                  onchange={ev => {
                    board.showTunnel(id, database, ev.currentTarget.checked);
                  }}
                /><span class="track" aria-hidden="true"></span>Show tunnel
              </label>
            {/if}
          </span>
          {#if change && showing === database}
            <div class="change">
              <b>Koppler changes one line for the run</b>
              <span class="file">{change.file}</span>
              <code class="out">− {change.find}</code>
              <code class="in">+ {change.replace}</code>
              <span>Undone on Stop.</span>
            </div>
          {/if}
        {/each}
      </div>
    {/if}
    {#if app?.libraries.length && !mock}
      <div class="field">
        Libraries
        {#each app.libraries as library (library.name)}
          {@const on = local.includes(library.name)}
          <label
            class="toggle"
            title={on
              ? `On: ${data.name} uses your local copy in ${library.path.replace(/^\/Users\/[^/]+/, '~')}`
              : `Off: ${data.name} uses the published ${library.name}`}
          >
            <input
              type="checkbox"
              role="switch"
              aria-label="Use the local {library.name}"
              checked={on}
              onchange={ev => {
                useLocal(library.name, ev.currentTarget.checked);
              }}
            /><span class="track" aria-hidden="true"></span>{library.name}
          </label>
        {/each}
      </div>
    {/if}
    {#if !mock}
      <label class="field">
        Cables
        <span class="combo">
          <select
            aria-label="Add or remove a cable from {data.name}"
            onfocus={() => (cables = board.cablesOf(id))}
            onpointerdown={() => (cables = board.cablesOf(id))}
            onchange={wire}
          >
            <option value="">Add or remove…</option>
            {#if cables.can.length}
              <optgroup label="Call a local app">
                {#each cables.can as other (other.id)}<option value="+{other.id}">{other.name}</option>{/each}
              </optgroup>
            {/if}
            {#if cables.wired.length}
              <optgroup label="Remove the cable to">
                {#each cables.wired as other (other.id)}<option value="-{other.id}">{other.name}</option>{/each}
              </optgroup>
            {/if}
          </select>
        </span>
      </label>
      {#if data.note || noting}
        <label class="field">
          Note for the agent
          <textarea
            rows="2"
            placeholder="e.g. run with the new pricing flag on"
            value={data.note}
            {@attach grow}
            oninput={ev => {
              grow(ev.currentTarget);
              board.set(id, { note: ev.currentTarget.value });
            }}
            onblur={() => (noting = false)}
          ></textarea>
        </label>
      {:else}
        <button class="note-toggle" type="button" onclick={() => (noting = true)}>Add a note for the agent</button>
      {/if}
    {/if}
  </div>
{/if}

<style>
  .body {
    display: grid;
    gap: 8px;
    padding: 10px 14px 14px 16px;
    cursor: default;
  }
  .row {
    display: grid;
    grid-template-columns: 1fr 1fr;
    gap: 8px;
  }
  /* Its label printed on the panel: small mono capitals; what it labels keeps its own type. */
  .field {
    display: grid;
    gap: 5px;
    color: var(--ink-muted);
    font: 400 12px var(--sans);
  }
  .field > :global(*) {
    font: 400 12px var(--sans);
  }
  .database {
    display: flex;
    align-items: center;
    justify-content: space-between;
    gap: 8px;
  }
  .db-name {
    color: var(--ink);
    font-size: 13px;
  }
  .change {
    display: grid;
    gap: 4px;
    padding: 8px 10px;
    border: 1px solid var(--line);
    background: var(--desk);
  }
  .change b {
    color: var(--ink);
    font-weight: 600;
  }
  .change .file {
    font: 11px var(--mono);
  }
  .change code {
    overflow-wrap: anywhere;
    font: 11px var(--mono);
  }
  .change .out {
    color: var(--prod);
  }
  .change .in {
    color: var(--ok);
  }
  .combo {
    position: relative;
    display: block;
  }
  .combo::after {
    content: '';
    position: absolute;
    right: 11px;
    top: 50%;
    width: 6px;
    height: 6px;
    border-right: 1.5px solid var(--muted);
    border-bottom: 1.5px solid var(--muted);
    transform: translateY(-70%) rotate(45deg);
    pointer-events: none;
  }
  select {
    width: 100%;
    height: 30px;
    padding: 0 26px 0 8px;
    border: 1px solid var(--line);
    border-radius: 6px;
    background: var(--paper);
    color: var(--ink);
    font: 13px var(--sans);
    appearance: none;
    cursor: pointer;
    text-overflow: ellipsis;
  }
  select.mono {
    font: 12px var(--mono);
  }
  .seg {
    height: 30px;
  }
  .seg label {
    flex: 1;
    display: grid;
    place-items: center;
    padding: 0 10px;
    font-size: 12.5px;
  }
  .toggle {
    width: fit-content;
    min-height: 30px;
    color: var(--ink);
    font-size: 13px;
  }
  .link {
    justify-self: start;
    padding: 0;
    border: 0;
    background: none;
    color: var(--cable);
    font: 500 12px var(--sans);
    cursor: pointer;
  }
  .link:hover {
    text-decoration: underline;
  }
  .note-toggle {
    display: inline-flex;
    justify-self: start;
    align-items: center;
    gap: 5px;
    min-height: 24px;
    padding: 2px 0;
    border: 0;
    background: none;
    color: var(--muted);
    font: 500 12.5px var(--sans);
    cursor: pointer;
  }
  .note-toggle::before {
    content: '+';
    font-size: 16px;
    line-height: 1;
  }
  .note-toggle:hover {
    color: var(--cable);
  }
  textarea {
    width: 100%;
    min-height: 52px;
    padding: 6px 8px;
    resize: none;
    overflow: hidden;
    border: 1px solid var(--line);
    border-radius: 6px;
    background: var(--paper);
    color: var(--ink);
    font: 13px/1.4 var(--sans);
  }
  textarea::placeholder {
    color: var(--muted);
  }
  :is(select, textarea, .note-toggle):focus-visible {
    outline: 2px solid var(--ink);
    outline-offset: 1px;
  }
</style>
