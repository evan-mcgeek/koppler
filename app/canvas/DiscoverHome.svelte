<script lang="ts">
  // Discover's home: the whole stack first, then the feature boards in one list by name, and at the foot a question
  // to the agent, which becomes a feature board of your own that it drafts on the map.
  import type { StoredPreset } from '../src/core/presets.ts';
  import { featureOf, openComments } from '../src/core/feature.ts';
  import { board } from './board.svelte.ts';
  import { openFlow } from './boards.ts';
  import { discovered } from './discover.svelte.ts';
  import { live } from './live.svelte.ts';

  let question = $state('');
  const whole = $derived(!board.feature);
  /** Every card the whole stack holds: its apps, queues, databases and resources. */
  const size = $derived.by(() => {
    const facts = board.facts;
    if (!facts) return 0;
    return [facts.apps, facts.queues, facts.databases, facts.resources].reduce(
      (n, part) => n + Object.keys(part ?? {}).length,
      0,
    );
  });
  const flows = $derived(
    [...board.team, ...board.own]
      .filter(one => one['feature'])
      .sort((a, b) => a.name.toLowerCase().localeCompare(b.name.toLowerCase())),
  );
  const counted = (n: number, one: string) => `${String(n)} ${one}${n === 1 ? '' : 's'}`;
  /** "2 phases · 7 steps", or what it waits on. */
  const said = (preset: StoredPreset) => {
    const feature = featureOf(preset['feature']);
    const steps = feature?.phases.reduce((n, phase) => n + phase.steps.length, 0) ?? 0;
    if (!feature || (!feature.phases.length && !steps))
      return feature?.request ? 'Asked, waiting for the agent' : 'Empty';
    return `${counted(feature.phases.length, 'phase')} · ${counted(steps, 'step')}`;
  };
  const here = (preset: StoredPreset) => !whole && board.name === preset.name;
  /** The board on screen, asked of the agent and not settled yet: what it has found so far. */
  const drafting = $derived.by(() => {
    const feature = board.feature;
    if (!feature?.request || (live.status?.agent?.state ?? 'none') !== 'busy') return null;
    const steps = feature.phases.flatMap(phase => phase.steps);
    if (steps.some(step => !step.proposed)) return null;
    return discovered.proposals.length;
  });
  const ask = (ev: SubmitEvent) => {
    ev.preventDefault();
    const words = question.trim();
    if (!words) return;
    board.newFeature(words.replace(/[?.!\s]+$/, '').slice(0, 80) || 'New feature');
    void discovered.describe(words);
    question = '';
  };
</script>

<!-- eslint-disable @typescript-eslint/no-confusing-void-expression -- {@render} of a snippet returns nothing -->
{#snippet row(preset: StoredPreset)}
  <button
    class="row"
    type="button"
    aria-current={here(preset)}
    onclick={() => {
      if (!here(preset)) openFlow(preset);
    }}
    ><span class="here" aria-hidden="true"></span><span class="what"
      ><span class="name">{preset.name}</span><span class="sub">{said(preset)}</span
      >{#if here(preset) && drafting !== null}<span class="drafting" role="status"
          >Agent drafting · {drafting} found so far</span
        >{/if}</span
    >{#if openComments(featureOf(preset['feature']))}<span
        class="talks"
        title="Open comments"
        aria-label="{openComments(featureOf(preset['feature']))} open comments"
        >{openComments(featureOf(preset['feature']))}</span
      >{/if}</button
  >
{/snippet}

<aside class="home" aria-label="Discover">
  <button
    class="row whole"
    type="button"
    aria-current={whole}
    onclick={() => {
      if (!whole) openFlow(null);
    }}
    ><span class="here" aria-hidden="true"></span><span class="what"
      ><span class="name">Whole stack</span><span class="sub"
        >{size} {size === 1 ? 'app or resource' : 'apps and resources'}</span
      ></span
    ></button
  >
  {#if flows.length}
    <p class="head">Feature boards</p>
    {#each flows as preset (preset.name)}{@render row(preset)}{/each}
  {/if}
  <span class="spacer"></span>
  <form class="ask" onsubmit={ask}>
    <label for="discover-ask">Ask about {board.stack}</label>
    <textarea
      id="discover-ask"
      rows="2"
      maxlength="4000"
      placeholder="How does checkout work? What listens to Orders API?"
      bind:value={question}
      onkeydown={ev => {
        if (ev.key === 'Enter' && !ev.shiftKey) {
          ev.preventDefault();
          ev.currentTarget.form?.requestSubmit();
        }
      }}
    ></textarea>
    <span class="foot"
      ><span>The agent makes a feature board</span><button type="submit" disabled={!question.trim()}>Ask</button></span
    >
  </form>
</aside>

<style>
  .home {
    display: flex;
    flex: none;
    flex-direction: column;
    width: 300px;
    overflow-y: auto;
    border-right: 1px solid var(--line);
    background: var(--panel);
  }
  .row {
    display: flex;
    align-items: center;
    gap: 10px;
    width: 100%;
    padding: 7px 16px;
    border: 0;
    background: none;
    color: var(--ink);
    text-align: left;
    cursor: pointer;
  }
  .row.whole {
    padding: 12px 16px;
  }
  .row:hover,
  .row:focus-visible {
    background: color-mix(in oklab, var(--ink) 7%, transparent);
    outline: none;
  }
  .row[aria-current='true'] {
    background: var(--line-strong);
  }
  /* The board on screen: a filled square, as in the board menu. */
  .here {
    flex: none;
    width: 7px;
    height: 7px;
  }
  [aria-current='true'] .here {
    background: var(--ink);
  }
  .what {
    display: flex;
    flex: 1;
    flex-direction: column;
    gap: 1px;
    min-width: 0;
  }
  .name {
    overflow: hidden;
    font: 500 14px var(--sans);
    white-space: nowrap;
    text-overflow: ellipsis;
  }
  [aria-current='true'] .name {
    font-weight: 600;
  }
  .sub,
  .drafting {
    color: var(--muted);
    font: 400 12px var(--sans);
  }
  .drafting {
    color: var(--ink);
  }
  .head {
    margin: 0;
    padding: 10px 16px 4px;
    color: var(--muted);
    font: 600 12px var(--sans);
  }
  .spacer {
    flex: 1;
  }
  .ask {
    display: flex;
    flex-direction: column;
    gap: 8px;
    padding: 12px 16px;
    border-top: 1px solid var(--line);
  }
  .ask label {
    color: var(--muted);
    font: 600 12px var(--sans);
  }
  .ask textarea {
    min-height: 54px;
    padding: 8px 9px;
    border: 1px solid var(--line-strong);
    border-radius: 0;
    background: var(--desk);
    color: var(--ink);
    font: 400 13px/1.45 var(--sans);
    resize: vertical;
  }
  .ask textarea::placeholder {
    color: var(--muted);
  }
  .foot {
    display: flex;
    align-items: center;
    gap: 10px;
    color: var(--muted);
    font: 400 12px var(--sans);
  }
  .foot span {
    flex: 1;
  }
  .foot button {
    height: 30px;
    padding: 0 11px;
    border: 1px solid var(--line-strong);
    border-radius: 0;
    background: none;
    color: var(--ink);
    font: 600 13px var(--sans);
    cursor: pointer;
  }
  .foot button:disabled {
    color: var(--muted);
    cursor: default;
  }
  .talks {
    flex: none;
    padding: 0 5px;
    border: 1px solid var(--line-strong);
    color: var(--muted);
    font: 400 11px/16px var(--mono);
  }
</style>
