<script lang="ts">
  // A card's choices, inside the review: what an app starts with can be changed without leaving it.
  import { board } from './board.svelte.ts';
  import { runs } from './run.svelte.ts';

  const { id }: { id: string } = $props();
  const app = $derived(board.apps.find(one => one.id === id));
  const data = $derived(board.nodes.find(node => node.id === id)?.data);
  const branches = $derived([...new Set([app?.current ?? '', ...(app?.branches ?? [])].filter(Boolean))]);
  const set = (change: Parameters<typeof board.set>[1]) => {
    board.set(id, change);
    runs.again();
  };
</script>

{#if app && data}
  <span class="controls">
    {#if branches.length > 1}
      <label>
        Branch
        <select
          value={data.branch || app.current}
          onchange={ev => {
            set({ branch: ev.currentTarget.value === app.current ? '' : ev.currentTarget.value });
          }}
        >
          {#each branches as branch (branch)}
            <option value={branch}>{branch}{branch === app.current ? ' (current)' : ''}</option>
          {/each}
        </select>
      </label>
    {/if}
    {#if board.switchesOver(id)}
      <label>
        {app.dirty} uncommitted
        <select
          value={data.changes ?? 'set-aside'}
          onchange={ev => {
            set({ changes: ev.currentTarget.value === 'take-along' ? 'take-along' : 'set-aside' });
          }}
        >
          <option value="set-aside">Set aside</option>
          <option value="take-along">Take along</option>
        </select>
      </label>
    {/if}
    {#if app.runIn.some(([value]) => value === 'ide')}
      <label>
        Started by
        <select
          value={data.run}
          onchange={ev => {
            set({ run: ev.currentTarget.value === 'ide' ? 'ide' : 'cli' });
          }}
        >
          <option value="cli">Koppler</option>
          <option value="ide">Me</option>
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
  select {
    max-width: 180px;
    padding: 2px 6px;
    border: 1px solid var(--line);
    border-radius: 6px;
    background: var(--paper);
    color: var(--ink);
    font: 12px var(--sans);
  }
  .check input {
    margin: 0;
    accent-color: var(--cable);
  }
</style>
