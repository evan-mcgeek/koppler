<script lang="ts">
  import { opens } from './bar.svelte.ts';
  // Every run and Stop, and how it ended; what stopped outside a run is told among them. Newest first, this session's
  // on top and older ones folded under "Earlier".
  import { VERSION } from '../src/core/presets.ts';
  import { openBoard } from './boards.ts';
  import HistoryRow from './HistoryRow.svelte';
  import { live, type Run } from './live.svelte.ts';

  const id = $props.id();
  let opener = $state<HTMLElement>();
  let pop = $state<HTMLDivElement>();
  let open = $state(false);
  let shown = $state<string | null>(null);
  const all = $derived(
    [...(live.status?.runs ?? []), ...(live.status?.notes ?? [])].sort((a, b) =>
      (b.at ?? '').localeCompare(a.at ?? ''),
    ),
  );
  const current = (one: Run) =>
    !live.status?.startedAt ||
    (one.at ?? '') >= live.status.startedAt ||
    one.state === 'waiting' ||
    one.state === 'applying';
  const now = $derived(all.filter(current));
  const earlier = $derived(all.filter(one => !current(one)));
  const time = (at = '') => {
    const date = new Date(at);
    const today = date.toDateString() === new Date().toDateString();
    return date.toLocaleString(
      [],
      today
        ? { hour: '2-digit', minute: '2-digit' }
        : { month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' },
    );
  };
  opens.history = from => {
    opener = from;
    pop?.showPopover();
  };
  const place = () => {
    const at = opener?.getBoundingClientRect();
    if (!at || !pop) return;
    pop.style.top = `${String(at.bottom + 6)}px`;
    pop.style.right = `${String(Math.max(12, innerWidth - at.right))}px`;
  };
  const putBack = (run: Run) => {
    pop?.hidePopover();
    openBoard({ name: `Run from ${time(run.at)}`, version: VERSION, nodes: run.nodes ?? {}, edges: run.edges ?? [] });
  };
</script>

<div
  bind:this={pop}
  {id}
  class="pop"
  popover
  role="dialog"
  tabindex="-1"
  aria-label="History"
  ontoggle={ev => {
    open = ev.newState === 'open';
    if (open) place();
  }}
>
  {#if !all.length}
    <p class="none">No runs yet. Each run and Stop shows up here with how it ended.</p>
  {:else}
    {#each now as run (run.id ?? run.at)}
      <HistoryRow
        {run}
        open={shown === run.id}
        toggle={() => (shown = shown === run.id ? null : (run.id ?? null))}
        back={() => {
          putBack(run);
        }}
      />
    {:else}
      <p class="none">No runs since the canvas started.</p>
    {/each}
    {#if earlier.length}
      <details>
        <summary>Earlier ({earlier.length})</summary>
        {#each earlier as run (run.id ?? run.at)}
          <HistoryRow
            {run}
            open={shown === run.id}
            toggle={() => (shown = shown === run.id ? null : (run.id ?? null))}
            back={() => {
              putBack(run);
            }}
          />
        {/each}
      </details>
    {/if}
  {/if}
</div>

<style>
  .pop {
    position: fixed;
    inset: auto;
    width: min(420px, calc(100vw - 24px));
    max-height: min(600px, calc(100vh - 100px));
    margin: 0;
    padding: 6px;
    overflow-y: auto;
    border: 1px solid var(--line);
    border-radius: 12px;
    background: var(--surface);
    color: var(--ink);
    box-shadow: var(--lift);
    font: 13px/1.45 var(--sans);
  }
  .none {
    margin: 0;
    padding: 12px;
    color: var(--muted);
  }
  details {
    border-top: 1px solid var(--line);
  }
  summary {
    padding: 9px 10px;
    color: var(--muted);
    font-size: 12.5px;
    cursor: pointer;
  }
</style>
