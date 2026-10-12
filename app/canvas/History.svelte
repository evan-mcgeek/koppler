<script lang="ts">
  // Every run and Stop, and how it ended; what stopped outside a run is told among them. Newest first, this session's
  // on top and older ones folded under "Earlier".
  import { VERSION } from '../src/core/presets.ts';
  import { openBoard } from './boards.ts';
  import HistoryRow from './HistoryRow.svelte';
  import { live, type Run } from './live.svelte.ts';

  const id = $props.id();
  let opener = $state<HTMLButtonElement>();
  let pop = $state<HTMLDivElement>();
  let open = $state(false);
  let shown = $state<string | null>(null);
  const waiting = $derived(!!live.status?.runs?.some(run => run.state === 'waiting'));
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

<button
  bind:this={opener}
  class="open"
  class:waiting
  type="button"
  aria-label="History"
  aria-haspopup="dialog"
  aria-expanded={open}
  title={waiting ? 'A run is waiting for the agent' : 'Every run and Stop, and how it ended'}
  popovertarget={id}
>
  <svg viewBox="0 0 16 16" width="16" height="16" aria-hidden="true">
    <circle cx="8" cy="8" r="5.6" /><path d="M8 4.8V8l2.2 1.6" />
  </svg>
</button>
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
  .open {
    position: relative;
    display: grid;
    place-items: center;
    width: 32px;
    height: 32px;
    padding: 0;
    border: 1px solid transparent;
    border-radius: 8px;
    background: none;
    color: var(--muted);
    cursor: pointer;
  }
  .open:hover,
  .open[aria-expanded='true'] {
    border-color: var(--line);
    color: var(--ink);
  }
  .open.waiting::after {
    content: '';
    position: absolute;
    top: 5px;
    right: 5px;
    width: 7px;
    height: 7px;
    border-radius: 50%;
    background: var(--warn);
  }
  .open svg {
    fill: none;
    stroke: currentColor;
    stroke-width: 1.4;
    stroke-linecap: round;
    stroke-linejoin: round;
  }
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
