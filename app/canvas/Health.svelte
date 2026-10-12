<script lang="ts">
  // The board's one light in the top bar, and the Flow check it opens: every connection tested, failures in full.
  import { board } from './board.svelte.ts';
  import { health, type FlowJob, type Kind } from './health.svelte.ts';
  import { live } from './live.svelte.ts';

  const GROUPS: [Kind, string][] = [
    ['app', 'Apps'],
    ['cable', 'Cables between local apps'],
    ['tunnel', 'Databases and caches'],
  ];
  const id = $props.id();
  let opener = $state<HTMLButtonElement>();
  let pop = $state<HTMLDivElement>();
  let open = $state(false);
  const chip = $derived(health.chip);
  const rows = $derived((health.flow ?? []).map(job => ({ job, result: health.result(job) })));
  const failed = $derived(rows.filter(row => row.result.state === 'bad'));
  const done = $derived(rows.filter(row => row.result.state !== 'busy').length);
  const unsure = $derived(rows.filter(row => row.result.state === 'warn').length);
  const summary = $derived(
    health.busy
      ? `Checking, ${String(done)} of ${String(rows.length)} done`
      : failed.length
        ? `${String(failed.length)} of ${String(rows.length)} connections ${failed.length === 1 ? 'fails' : 'fail'}`
        : unsure
          ? `Nothing fails, ${String(unsure)} not checked`
          : `All ${String(rows.length)} connections work`,
  );
  const tally = (kind: Kind) => {
    const all = rows.filter(row => row.job.kind === kind);
    const bad = all.filter(row => row.result.state === 'bad').length;
    const works = all.filter(row => row.result.state === 'ok').length;
    const total = String(all.length);
    if (all.some(row => row.result.state === 'busy')) return { text: 'checking', level: '' };
    if (bad) return { text: `${String(bad)} of ${total} ${bad === 1 ? 'fails' : 'fail'}`, level: 'bad' };
    if (works < all.length)
      return { text: `${String(works)} of ${total} work, ${String(all.length - works)} not checked`, level: 'warn' };
    return { text: `${total} of ${total} work`, level: '' };
  };
  const show = (job: FlowJob) => {
    pop?.hidePopover();
    board.show(job.id);
  };
  const place = () => {
    const at = opener?.getBoundingClientRect();
    if (!at || !pop) return;
    pop.style.top = `${String(at.bottom + 6)}px`;
    pop.style.left = `${String(Math.max(12, Math.min(at.left, innerWidth - 492)))}px`;
  };
</script>

{#if live.status}
  <button
    bind:this={opener}
    class="chip"
    type="button"
    data-state={chip.state}
    title={chip.title}
    aria-haspopup="dialog"
    aria-expanded={open}
    popovertarget={id}
  >
    <span class="dot" aria-hidden="true"></span>{chip.label}
  </button>
  <p class="sr" aria-live="polite">Board: {chip.label}</p>
  <div
    bind:this={pop}
    {id}
    class="pop"
    popover
    role="dialog"
    tabindex="-1"
    aria-label="Flow check"
    ontoggle={ev => {
      open = ev.newState === 'open';
      if (!open) return;
      place();
      // Opening shows the last check, or runs the first one; with nothing started it only says so.
      if (!health.flow && health.sent.length) void health.check();
    }}
  >
    {#if !health.sent.length && !health.flow}
      <p class="sum">Nothing is running</p>
      <p class="idle">
        Press Run to start the apps on your board. Flow check then tests every connection between them: apps, cables,
        databases and caches.
      </p>
    {:else}
      <header>
        <p class="sum">{summary}</p>
        <button type="button" disabled={health.busy} onclick={() => void health.check()}>Check again</button>
      </header>
      {#if health.busy}
        <progress max={rows.length} value={done} aria-label="Connections checked"></progress>
      {/if}
      {#each failed as { job, result } (job.key)}
        <button
          class="fail"
          type="button"
          title="Show it on the board"
          onclick={() => {
            show(job);
          }}
        >
          <span class="route">{job.from}{job.to ? ` → ${job.to}` : ''}</span>
          <span class="verdict">{result.text}</span>
          <span class="why">{result.detail}</span>
        </button>
      {/each}
      {#each GROUPS as [kind, title] (kind)}
        {@const rest = rows.filter(row => row.job.kind === kind && row.result.state !== 'bad')}
        {@const sum = tally(kind)}
        {#if rows.some(row => row.job.kind === kind)}
          <details open={sum.level === 'warn'}>
            <summary>{title}<span class="tally" data-level={sum.level}>{sum.text}</span></summary>
            {#each rest as { job, result } (job.key)}
              <button
                class="row"
                type="button"
                data-level={result.state}
                title={result.detail}
                onclick={() => {
                  show(job);
                }}
              >
                <span class="route">{job.from}{job.to ? ` → ${job.to}` : ''}</span>
                <span class="verdict">{(result.text ?? '').replace(/^Answers, /, '')}</span>
              </button>
            {/each}
          </details>
        {/if}
      {/each}
      {#if failed.length && !health.busy}
        <div class="fix">
          <p>
            The agent can find the cause of each failure and tell you what it would change. It asks before it starts,
            stops or restarts anything.
          </p>
          <button class="go" type="button" disabled={health.asked} onclick={() => void health.askToFix()}>
            {health.asked
              ? 'Sent to the agent'
              : failed.length === 1
                ? 'Ask the agent to fix it'
                : 'Ask the agent to fix these'}
          </button>
        </div>
      {/if}
    {/if}
  </div>
{/if}

<style>
  .chip {
    display: inline-flex;
    align-items: center;
    gap: 7px;
    height: 32px;
    padding: 0 10px;
    border: 1px solid transparent;
    border-radius: 8px;
    background: none;
    color: var(--muted);
    font: 500 12.5px var(--sans);
    white-space: nowrap;
    cursor: pointer;
  }
  .chip:hover,
  .chip[aria-expanded='true'] {
    border-color: var(--line);
    color: var(--ink);
  }
  .dot {
    width: 8px;
    height: 8px;
    border: 1.5px solid var(--muted);
    border-radius: 50%;
  }
  [data-state='ok'] .dot {
    border-color: var(--ok);
    background: var(--ok);
  }
  [data-state='bad'] .dot {
    border-color: var(--bad);
    background: var(--bad);
  }
  [data-state='warn'] .dot {
    border-color: var(--warn);
    background: var(--warn);
  }
  [data-state='busy'] .dot {
    border-color: var(--line);
    border-top-color: var(--cable);
    animation: turning 0.7s linear infinite;
  }
  .chip[data-state='bad'] {
    color: var(--ink);
    font-weight: 600;
  }
  @keyframes turning {
    to {
      rotate: 360deg;
    }
  }
  @media (prefers-reduced-motion: reduce) {
    [data-state='busy'] .dot {
      animation: none;
    }
  }
  .sr {
    position: absolute;
    width: 1px;
    height: 1px;
    overflow: hidden;
    clip-path: inset(50%);
    white-space: nowrap;
  }
  .pop {
    position: fixed;
    inset: auto;
    width: min(480px, calc(100vw - 24px));
    max-height: min(620px, calc(100vh - 100px));
    margin: 0;
    padding: 12px;
    overflow-y: auto;
    border: 1px solid var(--line);
    border-radius: 12px;
    background: var(--surface);
    color: var(--ink);
    box-shadow: var(--lift);
    font: 13px/1.45 var(--sans);
  }
  header {
    display: flex;
    align-items: center;
    gap: 8px;
    margin-bottom: 8px;
  }
  .sum {
    flex: 1;
    margin: 0;
    font-weight: 600;
    font-size: 14px;
  }
  .idle {
    margin: 6px 0 0;
    color: var(--muted);
  }
  header button,
  .fix button {
    padding: 5px 10px;
    border: 1px solid var(--line);
    border-radius: 6px;
    background: none;
    color: var(--ink);
    font: 600 12px var(--sans);
    cursor: pointer;
  }
  button:disabled {
    opacity: 0.55;
    cursor: default;
  }
  progress {
    display: block;
    width: 100%;
    height: 4px;
    margin-bottom: 8px;
    accent-color: var(--cable);
  }
  .fail,
  .row {
    display: grid;
    width: 100%;
    border: 0;
    background: none;
    color: var(--ink);
    font: inherit;
    text-align: left;
    cursor: pointer;
  }
  .fail {
    gap: 2px;
    margin-bottom: 8px;
    padding: 8px 10px;
    border: 1px solid color-mix(in oklab, var(--bad) 45%, transparent);
    border-radius: 8px;
    background: color-mix(in oklab, var(--bad) 8%, transparent);
  }
  .fail .route {
    font-weight: 600;
  }
  .fail .verdict {
    color: var(--bad);
    font-weight: 600;
  }
  .why {
    color: var(--muted);
    font-size: 12px;
  }
  details {
    border-top: 1px solid var(--line);
  }
  summary {
    display: flex;
    gap: 8px;
    padding: 8px 2px;
    font-weight: 600;
    cursor: pointer;
  }
  .tally {
    margin-left: auto;
    color: var(--muted);
    font-weight: 400;
    font-size: 12px;
  }
  .tally[data-level='bad'] {
    color: var(--bad);
  }
  .tally[data-level='warn'] {
    color: var(--warn);
  }
  .row {
    grid-template-columns: minmax(0, 1fr) auto;
    gap: 8px;
    padding: 5px 2px 5px 14px;
    border-radius: 6px;
  }
  .row:hover {
    background: color-mix(in oklab, var(--ink) 6%, transparent);
  }
  .row .verdict {
    color: var(--muted);
    font-size: 12px;
  }
  .row[data-level='warn'] .verdict {
    color: var(--warn);
  }
  .fix {
    display: grid;
    gap: 8px;
    margin-top: 8px;
    padding-top: 10px;
    border-top: 1px solid var(--line);
  }
  .fix p {
    margin: 0;
    color: var(--muted);
    font-size: 12px;
  }
  .fix .go {
    justify-self: start;
    border-color: transparent;
    background: var(--cable);
    color: var(--on-accent);
  }
</style>
