<script lang="ts">
  // One line of the history: a run or a Stop with how it ended, opened for its plan and code changes; or a note of
  // something that stopped outside a run.
  import { board } from './board.svelte.ts';
  import type { Run } from './live.svelte.ts';

  const { run, open, toggle, back }: { run: Run; open: boolean; toggle: () => void; back: () => void } = $props();
  const VERBS = [
    ['starts', 'Starts'],
    ['restarts', 'Restarts'],
    ['stops', 'Stops and reverts'],
    ['keeps', 'Keeps running'],
  ] as const;
  const STATES: Record<string, string> = {
    waiting: 'Waiting for the agent',
    applying: 'Being applied',
    done: 'Done',
    failed: 'Failed',
    replaced: 'Replaced by a newer run',
  };
  const NOTES: Record<string, string> = {
    'stop-apps': 'Apps stopped, changes kept',
    'stop-all': 'Everything stopped, changes kept',
    'canvas-closed': 'Canvas closed',
  };
  const name = board.nameOf;
  const time = $derived.by(() => {
    const date = new Date(run.at ?? '');
    const today = date.toDateString() === new Date().toDateString();
    return date.toLocaleString(
      [],
      today
        ? { hour: '2-digit', minute: '2-digit' }
        : { month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' },
    );
  });
  const changed = $derived([...new Set((run.changes ?? []).map(change => change.app))]);
</script>

{#if run.note}
  {@const stopped = (run.stopped ?? []).map(name).join(', ')}
  <div class="run">
    <div class="head note">
      <span class="what"
        >{NOTES[run.note] ?? 'Stopped'}{#if stopped}<small title={stopped}>{stopped}</small>{/if}</span
      >
      <time>{time}</time>
    </div>
  </div>
{:else}
  {@const on = Object.keys(run.nodes ?? {})
    .map(name)
    .join(', ')}
  <div class="run">
    <button class="head" type="button" aria-expanded={open} onclick={toggle}>
      <span class="what"
        >{run.kind === 'stop'
          ? 'Stop and revert'
          : `${(run.env ?? '').toUpperCase()}, ${run.mode ?? 'auto'}`}{#if on}<small title={on}>{on}</small>{/if}</span
      >
      {#if run.changes?.length}
        <span class="changes" title="Code changes Koppler made in your repos"
          >{run.changes.length} {run.changes.length === 1 ? 'change' : 'changes'}</span
        >
      {/if}
      <span class="state" data-state={run.state}>{STATES[run.state ?? ''] ?? run.state}</span>
      <time>{time}</time>
    </button>
    {#if run.reason}<p class="reason">{run.reason}</p>{/if}
    {#if open}
      <ul class="plan">
        {#each VERBS as [verb, label] (verb)}
          {#if run.plan?.[verb]?.length}
            <li>
              <span class="verb" data-verb={verb}>{label}</span>
              <span class="apps">
                {#each run.plan[verb] as step (step.id)}
                  <span
                    >{name(step.id)}{#if step.why?.length}<small>{step.why.join('; ')}</small>{/if}</span
                  >
                {/each}
              </span>
            </li>
          {/if}
        {/each}
      </ul>
      {#if run.changes?.length}
        <div class="diffs">
          <h3>Code changes in your repos</h3>
          {#each changed as app (app)}
            <h4>{name(app)}</h4>
            {#each run.changes.filter(change => change.app === app) as change (change.title + (change.file ?? ''))}
              <figure>
                <figcaption>
                  <code>{change.file || change.title}</code>
                  <span>{change.file ? change.title : ''}{change.fresh ? '' : ' (from an earlier run)'}</span>
                </figcaption>
                <pre>{#each change.removed ?? [] as line, at (at)}<span class="del"
                      ><b aria-hidden="true">-</b><span class="sr">removed: </span>{line}</span
                    >{/each}{#each change.added ?? [] as line, at (at)}<span class="add"
                      ><b aria-hidden="true">+</b><span class="sr">added: </span>{line}</span
                    >{/each}{#if !change.removed?.length && !change.added?.length}<span>No lines recorded.</span
                    >{/if}</pre>
              </figure>
            {/each}
          {/each}
        </div>
      {/if}
      {#if on}
        <button class="back" type="button" onclick={back}>Put this board back</button>
      {/if}
    {/if}
  </div>
{/if}

<style>
  .run {
    border-top: 1px solid var(--line);
  }
  .head {
    display: flex;
    align-items: baseline;
    gap: 8px;
    width: 100%;
    padding: 9px 10px;
    border: 0;
    border-radius: 7px;
    background: none;
    color: var(--ink);
    font: 600 13px var(--sans);
    text-align: left;
  }
  button.head {
    cursor: pointer;
  }
  button.head:hover {
    background: color-mix(in oklab, var(--ink) 6%, transparent);
  }
  .what {
    flex: 1;
    min-width: 0;
  }
  .what small {
    display: block;
    overflow: hidden;
    color: var(--muted);
    font-weight: 400;
    font-size: 12px;
    text-overflow: ellipsis;
    white-space: nowrap;
  }
  .note .what {
    color: var(--muted);
    font-weight: 500;
  }
  time,
  .changes {
    flex: none;
    color: var(--muted);
    font-weight: 400;
    font-size: 12px;
  }
  .state {
    flex: none;
    font-weight: 600;
    font-size: 12px;
  }
  .state[data-state='done'] {
    color: var(--ok);
  }
  .state[data-state='failed'] {
    color: var(--bad);
  }
  .state[data-state='waiting'],
  .state[data-state='applying'] {
    color: var(--warn);
  }
  .state[data-state='replaced'] {
    color: var(--muted);
  }
  .reason {
    margin: 0 10px 8px;
    color: var(--bad);
    font-size: 12.5px;
  }
  .plan {
    display: grid;
    gap: 6px;
    margin: 0 10px 10px;
    padding: 0;
    list-style: none;
  }
  .plan li {
    display: grid;
    grid-template-columns: 120px minmax(0, 1fr);
    gap: 8px;
  }
  .verb {
    color: var(--muted);
    font-weight: 600;
    font-size: 12px;
  }
  .apps {
    display: grid;
    gap: 4px;
  }
  .apps small {
    display: block;
    color: var(--muted);
    font-size: 12px;
  }
  .diffs {
    margin: 0 10px 10px;
  }
  h3,
  h4 {
    margin: 8px 0 4px;
    font-size: 12.5px;
  }
  h4 {
    color: var(--muted);
  }
  figure {
    margin: 0 0 8px;
    border: 1px solid var(--line);
    border-radius: 7px;
    overflow: hidden;
  }
  figcaption {
    display: grid;
    gap: 2px;
    padding: 6px 8px;
    background: var(--panel);
    font-size: 12px;
  }
  figcaption code {
    font: 12px var(--mono);
  }
  figcaption span {
    color: var(--muted);
  }
  pre {
    margin: 0;
    padding: 6px 8px;
    overflow-x: auto;
    font: 12px/1.5 var(--mono);
  }
  pre span {
    display: block;
  }
  pre .del {
    color: var(--bad);
  }
  pre .add {
    color: var(--ok);
  }
  pre b {
    display: inline-block;
    width: 1.2em;
    font-weight: 400;
  }
  .sr {
    position: absolute;
    width: 1px;
    height: 1px;
    overflow: hidden;
    clip-path: inset(50%);
    white-space: nowrap;
  }
  .back {
    margin: 0 10px 10px;
    padding: 5px 10px;
    border: 1px solid var(--line);
    border-radius: 6px;
    background: none;
    color: var(--ink);
    font: 600 12px var(--sans);
    cursor: pointer;
  }
</style>
