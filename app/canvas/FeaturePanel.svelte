<script lang="ts">
  import { untrack } from 'svelte';
  import Clock from '@lucide/svelte/icons/clock';
  // A feature board's panel: its request, and its steps in phases. Picking a phase dims the others on the map.
  import ChevronDown from '@lucide/svelte/icons/chevron-down';
  import ChevronRight from '@lucide/svelte/icons/chevron-right';
  import X from '@lucide/svelte/icons/x';
  import { linksOf } from '../src/core/discover.ts';
  import { numbered, type Feature } from '../src/core/feature.ts';
  import { atRest, breakable, noteWords, phaseName, valueWords } from '../src/core/step-text.ts';
  import { phaseFolds } from './phase-folds.svelte.ts';
  import { board } from './board.svelte.ts';
  import { stacks } from './stacks.svelte.ts';
  import { discovered } from './discover.svelte.ts';

  const { feature }: { feature: Feature } = $props();
  /** What a step does, in words: "calls", "publishes to". */
  const VERB: Record<string, string> = {
    call: 'calls',
    publish: 'publishes to',
    read: 'is read by',
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
  /** The one step opened, by its number; a new board opens none. */
  let opened = $state<string | null>(null);
  $effect(() => {
    if (board.name) untrack(() => (opened = null));
  });
  // A step picked or walked to in a folded phase opens its phase.
  $effect(() => {
    const phase = discovered.current && feature.phases[discovered.current.phase];
    if (phase && phaseFolds.names.includes(phase.name))
      untrack(() => {
        phaseFolds.set(phaseFolds.names.filter(name => name !== phase.name));
      });
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
    {team && stacks.shared ? 'Team feature board' : 'Feature board'} · {feature.phases.length}
    {feature.phases.length === 1 ? 'phase' : 'phases'} · {steps.length}
    {steps.length === 1 ? 'step' : 'steps'}
  </p>
  <div class="request">
    {#if board.viewOnly}
      <p class="said">{feature.request}</p>
    {:else if editing}
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
        }}>{feature.request || 'Add the request it came from'}</button
      >
    {/if}
  </div>
  <p class="uses">
    {#if !board.viewOnly}Uses {recorded} of the stack's links{steps.length > recorded
        ? `; ${String(steps.length - recorded)} not in it yet`
        : ''}.{/if}
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
    {#if !board.viewOnly}<button
        class="text walk"
        type="button"
        aria-pressed={discovered.commenting}
        title="Then a click on the card or the step it is about"
        onclick={() => {
          discovered.commenting = !discovered.commenting;
        }}>Comment</button
      >{/if}
  </p>

  {#each feature.phases as one, at (one.name)}
    {@const folded = phaseFolds.names.includes(one.name)}
    <section
      class:dim={discovered.shownPhase !== null && discovered.shownPhase !== at}
      class:marked={discovered.shownPhase === at}
    >
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
            aria-expanded={!folded}
            title={folded ? 'Show its steps' : 'Fold it to its name'}
            onclick={() => {
              phaseFolds.toggle(one.name);
            }}
            ><span class="number" aria-hidden="true">{at + 1}</span><span class="name"
              >{phaseName(one.name, at + 1)}</span
            >{#if discovered.startsOn(one)}<span
                class="when"
                title="This phase starts on a schedule: its first step is a scheduled job"
                ><Clock size={12} aria-hidden="true" />{discovered.startsOn(one)}</span
              >{/if}<span class="fold" aria-hidden="true"
              >{#if folded}<ChevronRight size={14} />{:else}<ChevronDown size={14} />{/if}</span
            ></button
          >
          {#if !board.viewOnly}<button
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
            >{/if}
        {/if}
      </header>
      {#if folded}
        {@const count = steps.filter(step => step.phase === at).length}
        <p class="folded">{count} {count === 1 ? 'step' : 'steps'}</p>
      {:else}
        {#each steps.filter(step => step.phase === at) as { step, number } (number)}
          {@const ref = { from: step.from, to: step.to, phase: one.name }}
          {@const talks = discovered.openOn({ step: ref })}
          {@const shown = atRest(step)}
          {@const open = opened === number}
          <div
            class="step"
            class:proposed={step.proposed}
            class:open
            aria-current={discovered.step === number || undefined}
            {@attach (row: HTMLElement) => {
              if (discovered.step === number) row.scrollIntoView({ block: 'nearest' });
            }}
          >
            <button
              class="head"
              type="button"
              aria-label="Step {number}: {name(step.from)} {VERB[step.kind] ?? 'calls'} {name(step.to)}"
              aria-expanded={shown.opens ? open : undefined}
              title={board.viewOnly
                ? 'Pick its two cards (Shift adds them to the pick)'
                : 'Pick its two cards, to plan a run with them (Shift adds them to the pick)'}
              onclick={ev => {
                if (shown.opens) opened = open ? null : number;
                discovered.picked = [...new Set([...(ev.shiftKey ? discovered.picked : []), step.from, step.to])];
              }}
            >
              <span class="caret" aria-hidden="true"
                >{#if shown.opens && !board.viewOnly}{#if open}<ChevronDown size={12} />{:else}<ChevronRight
                      size={12}
                    />{/if}{/if}</span
              >
              <span class="at">{number}</span>
              <span class="what">
                <span class="route"
                  ><b>{name(step.from)}</b> <span class="verb">{VERB[step.kind] ?? 'calls'}</span>
                  <b>{name(step.to)}</b></span
                >
                {#if shown.line && !open}<span class="summary">{shown.line}</span>{/if}
              </span>
            </button>
            <span class="end">
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
              {:else if talks.length && !board.viewOnly}
                <button
                  class="talk"
                  type="button"
                  aria-label="{talks.length} {talks.length === 1 ? 'comment' : 'comments'} on step {number}"
                  onclick={() => {
                    discovered.thread = { id: talks[0]?.id ?? '' };
                  }}>{talks.length}</button
                >
              {/if}
              {#if !step.proposed && !board.viewOnly}
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
            </span>
            {#if open}
              <div class="opened">
                {#if step.summary}<p class="said">{step.summary}</p>{/if}
                {#if step.values?.length}
                  <dl class="values">
                    {#each step.values as value (value.label)}
                      <div>
                        <dt>{value.label}</dt>
                        {#each value.items as item, at (at)}
                          <dd>
                            {#each valueWords(item) as words, part (part)}{#if words.date}<span class="nowrap"
                                  >{words.text}</span
                                >{:else}{#each breakable(words.text) as bit, cut (cut)}{#if cut}<wbr
                                    />{/if}{bit}{/each}{/if}{/each}
                          </dd>
                        {/each}
                      </div>
                    {/each}
                  </dl>
                {/if}
                {#if step.note && step.note !== shown.line}
                  <div class="agent">
                    <span class="label">Agent’s note</span>
                    <p>
                      {#each noteWords(step.note) as words, part (part)}{#if words.code}<code class:nowrap={words.date}
                            >{#each breakable(words.text) as bit, cut (cut)}{#if cut}<wbr />{/if}{bit}{/each}</code
                          >{:else}{words.text}{/if}{/each}
                    </p>
                  </div>
                {/if}
              </div>
            {/if}
            {#if board.viewOnly && shown.opens}
              <button
                class="text details"
                type="button"
                aria-expanded={open}
                onclick={() => {
                  opened = open ? null : number;
                }}>{open ? 'Hide details' : 'Details'}</button
              >
            {/if}
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
          </div>
        {:else}
          <p class="none">No steps yet. Pick a card and add its links as steps.</p>
        {/each}
      {/if}
    </section>
  {:else}
    <p class="none">No steps yet. Pick a card and add its links as steps.</p>
  {/each}

  {#if board.viewOnly}{:else if adding}
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
  /* The request in two lines at most, muted, with no box; changed in place. */
  .request {
    margin-top: 10px;
  }
  .request .said {
    display: -webkit-box;
    -webkit-line-clamp: 2;
    line-clamp: 2;
    -webkit-box-orient: vertical;
    overflow: hidden;
    margin: 0;
    padding: 0;
    border: 0;
    background: none;
    color: var(--muted);
    font: 400 13px/1.45 var(--sans);
    text-align: left;
    cursor: text;
  }
  .label {
    color: var(--ink-muted);
    font: 400 12px var(--sans);
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
    padding: 0 0 6px;
  }
  .phase {
    display: flex;
    flex: 1;
    align-items: center;
    gap: 8px;
    min-width: 0;
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
    width: 20px;
    height: 20px;
    background: var(--ink);
    color: var(--panel);
    font: 600 12px var(--mono);
  }
  .phase .name {
    flex: 1;
    min-width: 0;
  }
  .fold {
    display: flex;
    color: var(--muted);
  }
  .folded {
    margin: 0;
    padding: 0 0 10px 28px;
    border-bottom: 1px solid var(--line);
    color: var(--muted);
    font: 400 12px var(--sans);
  }
  .marked .number {
    outline: 2px solid var(--ink);
    outline-offset: 2px;
  }
  /* A step: caret, number, the route and its summary, and the end slot; opened, its detail spans from the number on. */
  .step {
    display: grid;
    grid-template-columns: minmax(0, 1fr) auto;
    margin: 0 -10px 0 -6px;
    padding: 0 10px 0 0;
    border-bottom: 1px solid var(--line);
  }
  .step[aria-current='true'] {
    background: var(--tint);
  }
  .head {
    display: grid;
    grid-template-columns: 14px 30px minmax(0, 1fr);
    column-gap: 4px;
    padding: 8px 0 8px 6px;
    border: 0;
    background: none;
    color: var(--ink);
    text-align: left;
    cursor: pointer;
  }
  .head:focus-visible {
    outline: 2px solid var(--ink);
    outline-offset: -2px;
  }
  .caret {
    display: flex;
    align-items: center;
    height: 19px;
    color: var(--muted);
  }
  .at {
    color: var(--muted);
    font: 500 12px/19px var(--mono);
  }
  .step[aria-current='true'] .at {
    color: var(--ink);
    font-weight: 600;
  }
  .what {
    display: flex;
    flex-direction: column;
    gap: 3px;
    min-width: 0;
  }
  .route {
    font: 400 14px/19px var(--sans);
    overflow-wrap: anywhere;
    display: -webkit-box;
    -webkit-line-clamp: 2;
    line-clamp: 2;
    -webkit-box-orient: vertical;
    overflow: hidden;
  }
  .route b {
    font-weight: 600;
  }
  .verb {
    color: var(--muted);
  }
  .summary {
    display: -webkit-box;
    -webkit-line-clamp: 2;
    line-clamp: 2;
    -webkit-box-orient: vertical;
    overflow: hidden;
    color: var(--muted);
    font: 400 13px/18px var(--sans);
    text-wrap: pretty;
  }
  .end {
    display: flex;
    gap: 4px;
    align-items: start;
    padding-top: 6px;
  }
  .opened {
    grid-column: 1 / -1;
    display: flex;
    flex-direction: column;
    gap: 10px;
    min-width: 0;
    padding: 6px 0 10px 24px;
  }
  .opened .said {
    margin: 0;
    color: var(--ink);
    font: 500 13px/1.5 var(--sans);
    text-wrap: pretty;
    cursor: auto;
  }
  .values {
    display: flex;
    flex-direction: column;
    gap: 8px;
    margin: 0;
  }
  .values div {
    display: flex;
    flex-direction: column;
    gap: 2px;
  }
  .values dt {
    color: var(--muted);
    font: 400 12px/16px var(--sans);
  }
  .values dd {
    margin: 0;
    color: var(--ink);
    font: 500 12px/17px var(--mono);
    overflow-wrap: break-word;
  }
  .nowrap {
    white-space: nowrap;
  }
  .agent {
    display: flex;
    flex-direction: column;
    gap: 3px;
    padding-top: 8px;
    border-top: 1px solid var(--line);
  }
  .agent .label {
    color: var(--muted);
    font: 600 12px var(--sans);
  }
  .agent p {
    margin: 0;
    color: var(--muted);
    font: 400 12px/1.5 var(--sans);
    overflow-wrap: anywhere;
  }
  .agent code {
    font: 400 11.5px var(--mono);
  }
  button.details {
    grid-column: 1 / -1;
    justify-self: start;
    margin: -4px 0 8px 58px;
    color: var(--muted);
    font-size: 12px;
  }
  .open button.details {
    margin-left: 24px;
  }
  .proposed {
    border-bottom-style: dashed;
  }
  .proposed .route {
    color: var(--muted);
  }
  .step > .ask {
    grid-column: 1 / -1;
    padding: 0 0 8px 50px;
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
