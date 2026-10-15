<script lang="ts">
  // A card's choices, inside the review: what an app starts with can be changed without leaving it.
  import BranchPicker from './BranchPicker.svelte';
  import { board, STARTED_BY } from './board.svelte.ts';
  import { runs } from './run.svelte.ts';

  const { id }: { id: string } = $props();
  const app = $derived(board.app(id));
  const data = $derived(board.cards.find(node => node.id === id)?.data);
  // The apps it could call, and those that could call it, when it is cabled to none of them.
  const calls = $derived(board.uncabled(id) ? board.cablesOf(id).can : []);
  const callers = $derived(
    board.uncabled(id)
      ? board.cards.flatMap(node =>
          node.id !== id && board.cablesOf(node.id).can.some(one => one.id === id)
            ? board.apps.filter(one => one.id === node.id)
            : [],
        )
      : [],
  );
  const wire = (from: string, to: string) => {
    board.connect(from, to);
    runs.again();
  };
  const set = (change: Parameters<typeof board.set>[1]) => {
    board.set(id, change);
    runs.again();
  };
</script>

{#if app && data}
  {#if (calls.length || callers.length) && !runs.onItsOwn[id]}
    <!-- An app no cable reaches is usually one left out by mistake: the cables it can have are one press away. -->
    <span class="alone" role="group" aria-label="{app.name} is not cabled">
      <span>Not cabled to any app here, so nothing local calls it and it calls only deployed apps.</span>
      <span class="picks">
        {#each callers.slice(0, 3) as other (other.id)}
          <button
            type="button"
            class="cable"
            onclick={() => {
              wire(other.id, id);
            }}>{other.name} calls it</button
          >
        {/each}
        {#each calls.slice(0, 3) as other (other.id)}
          <button
            type="button"
            class="cable"
            onclick={() => {
              wire(id, other.id);
            }}>It calls {other.name}</button
          >
        {/each}
        <button
          type="button"
          onclick={() => {
            runs.onItsOwn[id] = true;
          }}>Run it on its own</button
        >
        <button
          type="button"
          title="Leave it out of this run; its card stays on the board"
          onclick={() => {
            runs.leftOut[id] = true;
            runs.again();
          }}>Don't run it</button
        >
      </span>
    </span>
  {/if}
  <span class="controls">
    {#if app.branches.length && data.run !== 'mock'}
      <label class="branch">
        Branch
        <BranchPicker
          value={data.branch}
          current={app.current}
          branches={app.branches}
          onpick={(branch: string) => {
            set({ branch });
          }}
        />
      </label>
    {/if}
    {#if board.switchesOver(id)}
      <label>
        {app.dirty} uncommitted on {app.current}
        <select
          value={data.changes ?? 'set-aside'}
          onchange={ev => {
            set({ changes: ev.currentTarget.value === 'take-along' ? 'take-along' : 'set-aside' });
          }}
        >
          <option value="set-aside">Set aside until Stop</option>
          <option value="take-along">Take along</option>
        </select>
      </label>
    {/if}
    {#if app.runIn.length > 1}
      <label>
        Started by
        <select
          value={data.run}
          onchange={ev => {
            set({ run: ev.currentTarget.value });
          }}
        >
          {#each app.runIn as [value] (value)}<option {value}>{STARTED_BY[value] ?? value}</option>{/each}
        </select>
      </label>
    {/if}
    {#if board.tunnelsOf(id).length}
      <label class="check">
        <input
          type="checkbox"
          role="switch"
          checked={!data.hideTunnels}
          onchange={ev => {
            set({ hideTunnels: !ev.currentTarget.checked });
          }}
        />
        Tunnels
      </label>
    {/if}
  </span>
{/if}

<style>
  .alone {
    display: grid;
    gap: 8px;
    margin: 6px 0 2px;
    padding: 10px 12px;
    border: 1px solid color-mix(in oklab, var(--warn) 45%, transparent);
    border-radius: 8px;
    background: color-mix(in oklab, var(--warn) 10%, transparent);
    color: var(--warn);
    font: 600 12px/1.4 var(--sans);
  }
  .picks {
    display: flex;
    flex-wrap: wrap;
    gap: 6px;
  }
  .picks button {
    padding: 3px 10px;
    border: 1px solid var(--line);
    border-radius: 6px;
    background: var(--paper);
    color: var(--ink);
    font: 600 12px var(--sans);
    cursor: pointer;
  }
  .picks .cable {
    border-color: var(--cable);
    color: var(--cable);
  }
  .picks button:hover {
    background: color-mix(in oklab, var(--ink) 7%, var(--paper));
  }
  .controls {
    display: flex;
    flex-wrap: wrap;
    gap: 6px 14px;
    margin-top: 4px;
  }
  label {
    display: flex;
    align-items: center;
    gap: 6px;
    color: var(--muted);
    font: 12px var(--sans);
  }
  .branch {
    width: 260px;
  }
  select {
    max-width: 180px;
    padding: 2px 24px 2px 8px;
    appearance: none;
    background-image: var(--chevron);
    background-repeat: no-repeat;
    background-position: right 8px center;
    border: 1px solid var(--line);
    border-radius: 6px;
    background-color: var(--paper);
    color: var(--ink);
    font: 12px var(--sans);
  }
  .check input {
    margin: 0;
    accent-color: var(--cable);
  }
</style>
