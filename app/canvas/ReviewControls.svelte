<script lang="ts">
  // A card's choices, inside the review: what an app starts with can be changed without leaving it.
  import BranchPicker from './BranchPicker.svelte';
  import { board } from './board.svelte.ts';
  import { runs } from './run.svelte.ts';

  const { id }: { id: string } = $props();
  const app = $derived(board.apps.find(one => one.id === id));
  const data = $derived(board.nodes.find(node => node.id === id)?.data);
  // The apps it could call, and those that could call it, when it is cabled to none of them.
  const calls = $derived(board.uncabled(id) ? board.cablesOf(id).can : []);
  const callers = $derived(
    board.uncabled(id)
      ? board.nodes.flatMap(node =>
          node.id !== id && board.cablesOf(node.id).can.some(one => one.id === id)
            ? board.apps.filter(one => one.id === node.id)
            : [],
        )
      : [],
  );
  const set = (change: Parameters<typeof board.set>[1]) => {
    board.set(id, change);
    runs.again();
  };
</script>

{#if app && data}
  <span class="controls">
    {#if app.branches.length}
      <label class="branch">
        Branch
        <BranchPicker
          value={data.branch}
          current={app.current || 'current branch'}
          branches={app.branches}
          onpick={(branch: string) => {
            set({ branch: branch === app.current ? '' : branch });
          }}
        />
      </label>
    {/if}
    {#if calls.length || callers.length}
      <label>
        Connect
        <select
          value=""
          onchange={ev => {
            const [what, other] = [ev.currentTarget.value[0], ev.currentTarget.value.slice(1)];
            if (what === '>') board.connect(id, other);
            else if (what === '<') board.connect(other, id);
            runs.again();
          }}
        >
          <option value="">Run it on its own</option>
          {#if calls.length}
            <optgroup label="Call a local app">
              {#each calls as other (other.id)}<option value=">{other.id}">{other.name}</option>{/each}
            </optgroup>
          {/if}
          {#if callers.length}
            <optgroup label="Called by">
              {#each callers as other (other.id)}<option value="<{other.id}">{other.name}</option>{/each}
            </optgroup>
          {/if}
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
  .branch {
    width: 260px;
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
