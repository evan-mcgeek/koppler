<script lang="ts">
  // After Plan a run with these: what was picked in Discover, the apps put on the board, and what stays deployed. An app
  // not cloned here can be cloned; a queue, database, resource or outside system never runs here.
  import X from '@lucide/svelte/icons/x';
  import { board } from './board.svelte.ts';
  import { discovered } from './discover.svelte.ts';
  import { toasts } from './toast.svelte.ts';

  const from = $derived(board.fromDiscover);
  const env = $derived(board.env.toUpperCase());
  const apps = $derived((from?.leftOut ?? []).filter(card => !card.includes(':') && !board.facts?.apps[card]?.outside));
  const never = $derived((from?.leftOut ?? []).filter(card => !apps.includes(card)));
  const info = (card: string) => discovered.data(card, false, 0);
  const clone = async (card: string) => {
    const slug = board.facts?.apps[card]?.slug;
    if (!slug) return;
    await navigator.clipboard.writeText(`git clone git@github.com:${slug}.git`).catch(() => undefined);
    toasts.show(`Clone command for ${info(card).name} copied.`);
  };
</script>

{#if from}
  <aside class="left-out" aria-labelledby="left-out-title">
    <header>
      <h2 id="left-out-title">Left out</h2>
      <button class="close" type="button" aria-label="Close" onclick={() => (board.fromDiscover = null)}
        ><X size={16} /></button
      >
    </header>
    <p class="from">
      <strong>From Discover: {from.picked} picked.</strong>
      {#if from.running.length}{from.running.map(card => info(card).name).join(' and ')}
        {from.running.length === 1 ? 'is' : 'are'} cloned and will run here.{/if}
      {#if from.leftOut.length}The other {from.leftOut.length} stay deployed {env}.{/if}
      <button
        class="text"
        type="button"
        onclick={() => {
          board.goDiscover();
        }}>Back to Discover</button
      >
    </p>
    {#if apps.length}
      <p class="say">
        Picked in Discover but not cloned here. They stay deployed {env} and the apps above call them there.
      </p>
      {#each apps as card (card)}
        <div class="item">
          <span class="row"><span class="name">{info(card).name}</span><span class="tag">{info(card).tag}</span></span>
          <span class="row"
            ><span class="where">On GitHub · {board.facts?.apps[card]?.slug ?? card}</span>
            <button class="clone" type="button" onclick={() => void clone(card)}>Clone it</button></span
          >
        </div>
      {/each}
    {/if}
    {#if never.length}
      <h3>Can't run here</h3>
      {#each never as card (card)}
        <div class="item">
          <span class="row"><span class="name">{info(card).name}</span><span class="tag">{info(card).tag}</span></span>
          <span class="where">{info(card).meta ? `${info(card).meta} · ` : ''}stays deployed {env}</span>
        </div>
      {/each}
    {/if}
  </aside>
{/if}

<style>
  .left-out {
    display: flex;
    flex: none;
    flex-direction: column;
    width: 340px;
    overflow-y: auto;
    padding: 16px 18px;
    border-left: 1px solid var(--line);
    background: var(--panel);
    color: var(--ink);
  }
  header {
    display: flex;
    align-items: center;
  }
  h2 {
    flex: 1;
    margin: 0;
    font: 600 22px var(--display);
  }
  .close {
    display: grid;
    place-items: center;
    width: 28px;
    height: 28px;
    padding: 0;
    border: 0;
    background: none;
    color: var(--ink);
    cursor: pointer;
  }
  .from,
  .say {
    margin: 8px 0 0;
    color: var(--ink-muted);
    font: 400 13px/1.5 var(--sans);
  }
  .from strong {
    color: var(--ink);
    font-weight: 600;
  }
  .say {
    padding-bottom: 12px;
    border-bottom: 1px solid var(--line);
  }
  h3 {
    margin: 16px 0 0;
    color: var(--ink-muted);
    font: 600 12px var(--sans);
  }
  .item {
    display: grid;
    gap: 8px;
    padding: 12px 0;
    border-bottom: 1px solid var(--line);
  }
  .row {
    display: flex;
    align-items: center;
    gap: 10px;
  }
  .name {
    flex: 1;
    min-width: 0;
    font: 600 14px var(--sans);
  }
  .tag {
    padding: 1px 5px;
    border: 1px solid var(--line-strong);
    color: var(--ink-muted);
    font: 400 10px var(--mono);
    letter-spacing: 0.06em;
    text-transform: uppercase;
  }
  .where {
    flex: 1;
    min-width: 0;
    color: var(--ink-muted);
    font: 400 12px var(--sans);
  }
  .clone {
    padding: 6px 10px;
    border: 1px solid var(--line-strong);
    background: none;
    color: var(--ink);
    font: 600 13px var(--sans);
    cursor: pointer;
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
  button:focus-visible {
    outline: 2px solid var(--ink);
    outline-offset: 2px;
  }
</style>
