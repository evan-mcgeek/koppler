<script lang="ts">
  import Icon from './Icon.svelte';
  import Check from '@lucide/svelte/icons/check';
  // "Before this runs on PROD": what the user has to do first, worked out live (sign-ins, hosts entries, credentials,
  // what the stack lacks), in the order it can be done, each with its command.
  import Command from './Command.svelte';
  import { board } from './board.svelte.ts';
  import { post } from './data.ts';
  import { runs } from './run.svelte.ts';

  interface Step {
    title: string;
    why?: string;
    command?: string | null;
    where?: string | null;
    alt?: string;
    how?: string;
    apps?: string[];
    done?: boolean | null;
    gap?: true;
  }
  let dialog = $state<HTMLDialogElement>();
  let steps = $state.raw<Step[] | null>(null);
  let failed = $state('');
  let asked = $state(false);
  const env = $derived(board.env.toUpperCase());

  export async function open(): Promise<void> {
    steps = null;
    failed = '';
    asked = false;
    dialog?.showModal();
    const apps = board.nodes.map(node => node.id);
    const noTunnels = board.nodes.filter(node => node.data.hideTunnels).map(node => node.id);
    const said = await post<{ steps?: Step[] }>('needs', { env: board.env, apps, noTunnels });
    if ('error' in said) failed = said.error;
    else steps = said.steps ?? [];
  }
  const ask = async () => {
    const gaps = (steps ?? []).filter(step => step.gap && !step.done).map(step => step.title);
    asked = await runs.askFacts(board.env, gaps);
  };
</script>

<dialog bind:this={dialog} aria-labelledby="checklist-title">
  <h2 id="checklist-title">Before this runs on {env}</h2>
  <p class="sub">In this order. Commands go in your own terminal, not in the agent: secrets must not reach it.</p>
  <ol>
    {#if failed}
      <li><span class="mark">!</span><span class="what">{failed}</span></li>
    {:else if !steps}
      <li><span class="mark"></span><span class="what">Working out what is needed…</span></li>
    {:else if !steps.length}
      <li class="done">
        <span class="mark"><Icon of={Check} size={13} /></span><span class="what"
          >Nothing for you to do. Koppler does the rest.</span
        >
      </li>
    {:else}
      {#each steps as step, at (at)}
        <li class:done={step.done} class:gap={step.gap && !step.done}>
          <span class="mark"
            >{#if step.done}<Icon of={Check} size={13} />{:else}{step.gap ? '!' : at + 1}{/if}</span
          >
          <span class="what">
            {step.title}{#if step.apps?.length}
              <small class="for">({step.apps.join(', ')})</small>{/if}
            {#if !step.done}
              {#if step.why}<small>{step.why}</small>{/if}
              {#if step.command}
                <Command command={step.command} />
                {#if step.where}<small>Where: {step.where}</small>{/if}
              {/if}
              {#if step.alt}<small>Or: {step.alt}</small>{/if}
              {#if step.how && !step.gap}<small>{step.how}</small>{/if}
            {/if}
          </span>
        </li>
      {/each}
    {/if}
  </ol>
  <div class="actions">
    {#if steps?.some(step => step.gap && !step.done)}
      <button class="ok" type="button" disabled={asked} onclick={() => void ask()}
        >{asked ? 'Sent to the agent' : 'Ask the agent to find them'}</button
      >
    {/if}
    <button type="button" onclick={() => void open()}>Check again</button>
    <button type="button" onclick={() => dialog?.close()}>Done</button>
  </div>
</dialog>

<style>
  dialog {
    display: none;
    flex-direction: column;
    gap: 10px;
    width: min(600px, calc(100vw - 32px));
    max-height: min(760px, calc(100vh - 48px));
    padding: 20px;
    border: 1px solid var(--line);
    border-radius: 14px;
    background: var(--surface);
    color: var(--ink);
    font: 14px var(--sans);
  }
  dialog[open] {
    display: flex;
  }
  dialog::backdrop {
    background: color-mix(in oklab, var(--desk) 60%, transparent);
  }
  h2 {
    margin: 0;
    font-size: 17px;
  }
  .sub {
    margin: 0;
    color: var(--muted);
  }
  ol {
    display: grid;
    gap: 12px;
    margin: 4px 0;
    padding: 0;
    overflow-y: auto;
    list-style: none;
  }
  li {
    display: grid;
    grid-template-columns: 22px minmax(0, 1fr);
    gap: 10px;
  }
  .mark {
    display: grid;
    place-items: center;
    width: 22px;
    height: 22px;
    border-radius: 50%;
    background: color-mix(in oklab, var(--ink) 8%, transparent);
    font: 600 12px var(--sans);
  }
  .done .mark {
    background: color-mix(in oklab, var(--ok) 22%, transparent);
  }
  .done .what {
    color: var(--muted);
  }
  .gap .mark {
    background: color-mix(in oklab, var(--warn) 25%, transparent);
  }
  .what {
    font-weight: 600;
  }
  small {
    display: block;
    color: var(--muted);
    font-weight: 400;
    font-size: 12.5px;
  }
  small.for {
    display: inline;
    margin-left: 4px;
  }
  li :global(.cmd) {
    margin: 4px 0;
  }
  button {
    padding: 5px 12px;
    border: 1px solid var(--line);
    border-radius: 8px;
    background: none;
    color: var(--ink);
    font: 600 13px var(--sans);
    cursor: pointer;
  }
  button:disabled {
    opacity: 0.6;
    cursor: default;
  }
  .ok {
    margin-right: auto;
    border-color: var(--cable);
    background: var(--cable);
    color: var(--on-accent);
  }
  .actions {
    display: flex;
    justify-content: flex-end;
    gap: 8px;
  }
</style>
