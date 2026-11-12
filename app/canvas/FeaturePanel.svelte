<script lang="ts">
  import Clock from '@lucide/svelte/icons/clock';
  // A feature board's panel: its request, and its steps in phases. Picking a phase dims the others on the map.
  import X from '@lucide/svelte/icons/x';
  import { linksOf } from '../src/core/discover.ts';
  import { numbered, type Feature } from '../src/core/feature.ts';
  import { board } from './board.svelte.ts';
  import { stacks } from './stacks.svelte.ts';
  import { discovered } from './discover.svelte.ts';

  const { feature }: { feature: Feature } = $props();
  /** What a step does, in words: "calls", "publishes to". */
  const VERB: Record<string, string> = {
    call: 'calls',
    publish: 'publishes to',
    read: 'reads',
    uses: 'uses',
    feeds: 'feeds',
    bucket: 'uses',
    route: 'routes to',
    starts: 'starts',
  };
  const team = $derived(!board.own.some(one => one.name === board.name));
  const name = (card: string) => discovered.data(card, false).name;
  const steps = $derived(numbered(feature));
  const recorded = $derived.by(() => {
    const known = linksOf(board.facts ?? { apps: {} });
    return steps.filter(({ step }) =>
      known.some(link => link.from === step.from && link.to === step.to && link.sure === 'confirmed'),
    ).length;
  });
  let editing = $state(false);
  let request = $state('');
  let renaming = $state<string | null>(null);
  let renamed = $state('');
  let adding = $state(false);
  let phase = $state('');
  const saveRequest = () => {
    if (!editing) return;
    editing = false;
    if (request.trim() !== feature.request) discovered.editFeature({ request });
  };
</script>

<aside class="panel" aria-labelledby="feature-title">
  <h2 id="feature-title">{board.name}</h2>
  <p class="kind">
    {team && stacks.shared ? 'Team feature board' : 'Feature board'} · {steps.length}
    {steps.length === 1 ? 'step' : 'steps'}
  </p>
  <div class="request">
    <span class="label">The request</span>
    {#if editing}
      <!-- svelte-ignore a11y_autofocus -->
      <textarea
        aria-label="The request"
        rows="4"
        maxlength="4000"
        autofocus
        bind:value={request}
        onblur={saveRequest}
        onkeydown={ev => {
          if (ev.key === 'Escape') {
            editing = false;
            ev.stopPropagation();
          }
        }}
      ></textarea>
    {:else}
      <button
        class="said"
        type="button"
        title="Change the request"
        onclick={() => {
          request = feature.request;
          editing = true;
        }}>{feature.request ? `“${feature.request}”` : 'Add the request it came from'}</button
      >
    {/if}
  </div>
  <p class="uses">
    Uses {recorded} of the stack's links{steps.length > recorded
      ? `; ${String(steps.length - recorded)} not in it yet`
      : ''}.
    {#if steps.length}
      <button
        class="text walk"
        type="button"
        title="Then → and ← to step, Esc to stop"
        onclick={() => {
          discovered.step = steps[0]?.number ?? null;
        }}>Walk through the steps</button
      >
    {/if}
    <button
      class="text walk"
      type="button"
      aria-pressed={discovered.commenting}
      title="Then a click on the card or the step it is about"
      onclick={() => {
        discovered.commenting = !discovered.commenting;
      }}>Comment</button
    >
  </p>

  {#each feature.phases as one, at (one.name)}
    <section class:dim={discovered.phase !== null && discovered.phase !== at}>
      <header>
        {#if renaming === one.name}
          <form
            onsubmit={ev => {
              ev.preventDefault();
              if (renamed.trim()) discovered.editFeature({ rename: { from: one.name, to: renamed } });
              renaming = null;
            }}
          >
            <!-- svelte-ignore a11y_autofocus -->
            <input aria-label="Name of phase {at + 1}" maxlength="120" autofocus bind:value={renamed} />
            <button class="text" type="submit">Done</button>
          </form>
        {:else}
          <button
            class="phase"
            type="button"
            aria-pressed={discovered.phase === at}
            title="Show only this phase on the map"
            onclick={() => {
              discovered.phase = discovered.phase === at ? null : at;
            }}
            ><span class="number" aria-hidden="true">{at + 1}</span>{one.name}{#if discovered.startsOn(one)}<span
                class="when"
                title="This phase starts on a schedule: its first step is a scheduled job"
                ><Clock size={12} aria-hidden="true" />{discovered.startsOn(one)}</span
              >{/if}</button
          >
          <button
            class="text quiet"
            type="button"
            aria-label="Rename {one.name}"
            onclick={() => {
              renamed = one.name;
              renaming = one.name;
            }}>Rename</button
          >
          <button
            class="text quiet"
            type="button"
            aria-label="Remove {one.name}"
            title={one.steps.length
              ? 'Take this phase and its steps off the feature'
              : 'Take this phase off the feature'}
            onclick={() => {
              discovered.editFeature({ dropPhase: [one.name] });
            }}>Remove</button
          >
        {/if}
      </header>
      {#each steps.filter(step => step.phase === at) as { step, number } (number)}
        {@const ref = { from: step.from, to: step.to, phase: one.name }}
        {@const talks = discovered.openOn({ step: ref })}
        <div
          class="step"
          class:proposed={step.proposed}
          aria-current={discovered.step === number || undefined}
          {@attach (row: HTMLElement) => {
            if (discovered.step === number) row.scrollIntoView({ block: 'nearest' });
          }}
        >
          <button
            class="at"
            type="button"
            aria-label="Pick the apps of step {number}"
            title="Pick its two cards, to plan a run with them (Shift adds them to the pick)"
            onclick={ev => {
              discovered.picked = [...new Set([...(ev.shiftKey ? discovered.picked : []), step.from, step.to])];
            }}>{number}</button
          >
          <span class="what">
            <span class="from">{name(step.from)}</span>
            <span class="verb">{VERB[step.kind] ?? 'calls'} {name(step.to)}</span>
            {#if step.note}<span class="note">{step.note}</span>{/if}
            {#if step.proposed}
              <span class="ask"
                ><strong>Proposed</strong>
                <button
                  class="text"
                  type="button"
                  onclick={() => void discovered.accept([{ ...step, phase: one.name }])}>Accept</button
                >
                <button
                  class="text"
                  type="button"
                  onclick={() => {
                    discovered.drop([{ ...step, phase: one.name }]);
                  }}>Drop</button
                ></span
              >
            {/if}
          </span>
          {#if discovered.commenting}
            <button
              class="text here"
              type="button"
              aria-label="Comment on step {number}"
              onclick={() => {
                discovered.commenting = false;
                discovered.thread = { on: { step: ref } };
              }}>Here</button
            >
          {:else if talks.length}
            <button
              class="talk"
              type="button"
              aria-label="{talks.length} {talks.length === 1 ? 'comment' : 'comments'} on step {number}"
              onclick={() => {
                discovered.thread = { id: talks[0]?.id ?? '' };
              }}>{talks.length}</button
            >
          {/if}
          {#if !step.proposed}
            <button
              class="off"
              type="button"
              aria-label="Take step {number} off"
              title="Take this step off the feature"
              onclick={() => {
                discovered.editFeature({ unstep: [{ ...step, phase: one.name }] });
              }}><X size={14} /></button
            >
          {/if}
        </div>
      {:else}
        <p class="none">No steps yet. Pick a card and add its links as steps.</p>
      {/each}
    </section>
  {:else}
    <p class="none">No steps yet. Pick a card and add its links as steps.</p>
  {/each}

  {#if adding}
    <form
      class="add"
      onsubmit={ev => {
        ev.preventDefault();
        if (phase.trim()) discovered.editFeature({ phase: [phase] });
        adding = false;
      }}
    >
      <!-- svelte-ignore a11y_autofocus -->
      <input aria-label="Name of the new phase" maxlength="120" autofocus bind:value={phase} />
      <button class="text" type="submit">Add</button>
    </form>
  {:else}
    <button
      class="text add"
      type="button"
      onclick={() => {
        phase = '';
        adding = true;
      }}>Add a phase</button
    >
  {/if}
</aside>

<style>
  .when {
    display: inline-flex;
    align-items: center;
    gap: 4px;
    margin-left: 8px;
    color: var(--ink-muted);
    font: 12px var(--mono);
  }
  .panel {
    display: flex;
    flex: none;
    flex-direction: column;
    width: 300px;
    overflow-y: auto;
    padding: 16px 18px;
    border-right: 1px solid var(--line);
    background: var(--panel);
    color: var(--ink);
  }
  h2 {
    margin: 0;
    font: 600 26px/1.1 var(--display);
    overflow-wrap: anywhere;
  }
  .kind {
    margin: 4px 0 12px;
    color: var(--muted);
    font: 400 12px var(--sans);
  }
  /* A step's open threads, counted at its end. */
  .talk {
    flex: none;
    align-self: start;
    min-width: 20px;
    padding: 0 5px;
    border: 1px solid var(--ink);
    background: var(--panel);
    color: var(--ink);
    font: 600 11px/18px var(--mono);
    cursor: pointer;
  }
  .here {
    align-self: start;
  }
  .from {
    font: 500 14px var(--sans);
  }
  .verb {
    color: var(--muted);
    font: 400 13px var(--sans);
  }
  .request {
    display: grid;
    gap: 6px;
    margin-top: 14px;
    padding: 12px 14px;
    border: 1px solid var(--line);
    background: var(--desk);
  }
  .label {
    color: var(--ink-muted);
    font: 400 12px var(--sans);
  }
  .said {
    padding: 0;
    border: 0;
    background: none;
    color: var(--ink);
    font: 400 14px/1.5 var(--sans);
    text-align: left;
    cursor: text;
  }
  textarea,
  input {
    box-sizing: border-box;
    width: 100%;
    padding: 6px 8px;
    border: 1px solid var(--ink);
    background: var(--desk);
    color: var(--ink);
    font: 400 14px/1.5 var(--sans);
  }
  /* Full width, as tall as its words, scrolling past half the window. */
  textarea {
    min-height: calc(4lh + 14px);
    max-height: 50vh;
    field-sizing: content;
    resize: none;
  }
  .uses {
    margin: 10px 0 0;
    padding-bottom: 12px;
    border-bottom: 1px solid var(--line);
    color: var(--ink-muted);
    font: 400 12px var(--sans);
  }
  button.walk {
    display: block;
    margin-top: 10px;
  }
  section {
    padding-top: 14px;
  }
  section.dim {
    opacity: 0.45;
  }
  section header,
  section form {
    display: flex;
    align-items: center;
    gap: 10px;
  }
  .phase {
    display: flex;
    flex: 1;
    align-items: center;
    gap: 10px;
    padding: 0;
    border: 0;
    background: none;
    color: var(--ink);
    font: 600 15px var(--sans);
    text-align: left;
    cursor: pointer;
  }
  .number {
    display: grid;
    flex: none;
    place-items: center;
    width: 18px;
    height: 18px;
    background: var(--ink);
    color: var(--desk);
    font: 600 11px var(--mono);
  }
  .phase[aria-pressed='true'] .number {
    outline: 2px solid var(--ink);
    outline-offset: 2px;
  }
  .step {
    display: flex;
    gap: 12px;
    padding: 9px 0;
    border-bottom: 1px solid var(--line);
    font: 400 14px var(--sans);
  }
  /* Picked by its number on the map: tinted past the column on both sides, so its words stay where they were. */
  .step[aria-current='true'] {
    margin-inline: -8px;
    padding-inline: 8px;
    background: color-mix(in oklab, var(--cable) 12%, transparent);
  }
  .at {
    flex: none;
    align-self: start;
    width: 30px;
    padding: 0;
    border: 0;
    background: none;
    color: var(--ink-muted);
    font: 400 11px/20px var(--mono);
    text-align: left;
    cursor: pointer;
  }
  .at:hover,
  .at:focus-visible {
    color: var(--ink);
    text-decoration: underline;
    outline: none;
  }
  .what {
    display: grid;
    flex: 1;
    gap: 2px;
    min-width: 0;
  }
  .note {
    color: var(--ink-muted);
    font-size: 12px;
  }
  .proposed .what > span:first-child {
    color: var(--ink-muted);
  }
  .ask {
    display: flex;
    align-items: center;
    gap: 10px;
    font-size: 12px;
  }
  .off {
    display: grid;
    flex: none;
    place-items: center;
    width: 24px;
    height: 24px;
    padding: 0;
    border: 0;
    background: none;
    color: var(--ink-muted);
    cursor: pointer;
    visibility: hidden;
  }
  .step:hover .off,
  .off:focus-visible {
    visibility: visible;
  }
  .none {
    margin: 0;
    padding: 9px 0;
    color: var(--ink-muted);
    font: 400 13px/1.5 var(--sans);
  }
  button.text {
    padding: 0;
    border: 0;
    background: none;
    color: var(--ink);
    font: 400 13px var(--sans);
    text-decoration: underline;
    text-underline-offset: 3px;
    cursor: pointer;
  }
  .ask button.text {
    font-size: 12px;
  }
  button.quiet {
    color: var(--ink-muted);
    font-size: 12px;
  }
  .add {
    align-self: flex-start;
    margin-top: 14px;
  }
  form.add {
    display: flex;
    gap: 10px;
    width: 100%;
  }
  button:focus-visible {
    outline: 2px solid var(--ink);
    outline-offset: 2px;
  }
</style>
