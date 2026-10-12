<script lang="ts">
  // The agent's messages, beside the board: questions to answer, and what it finished or failed at.
  import InboxMessage from './InboxMessage.svelte';
  import { ago } from './boards.ts';
  import { inbox, type Message } from './inbox.svelte.ts';
  import { live } from './live.svelte.ts';

  let panel = $state<HTMLElement>();
  const list = $derived(inbox.messages);
  const waits = (one: Message) => one.kind === 'question' && !one.answered;
  const current = (one: Message) => !live.status?.startedAt || (one.at ?? '') >= live.status.startedAt || waits(one);
  const now = $derived(list.filter(current));
  const earlier = $derived(list.filter(one => !current(one)));
  /** Only the newest message and questions still open can be acted on; the rest is history. */
  const past = (one: Message) =>
    !waits(one) && (list[0] !== one || one.answered?.via === 'dismissed' || one.answered?.via === 'replaced');
  // Opened by a question: its first choice is ready under the keys.
  $effect(() => {
    if (inbox.open)
      (panel?.querySelector<HTMLElement>('.choice') ?? panel?.querySelector<HTMLElement>('.close'))?.focus();
  });
</script>

{#if inbox.open}
  <div
    class="panel"
    bind:this={panel}
    role="dialog"
    tabindex="-1"
    aria-label="Messages from the agent"
    onkeydown={ev => {
      if (ev.key === 'Escape') inbox.open = false;
    }}
  >
    <header>
      <h2>Agent</h2>
      <span class="sub">{inbox.question ? 'Waiting for your answer' : ''}</span>
      {#if list.some(one => !waits(one))}
        <button type="button" onclick={() => void inbox.clear()}>Clear</button>
      {/if}
      <button class="close" type="button" aria-label="Close" onclick={() => (inbox.open = false)}>×</button>
    </header>
    <div class="list">
      {#if inbox.waiting.length}
        <section class="waiting" aria-labelledby="waiting-title">
          <h3 id="waiting-title">Waiting for an agent ({inbox.waiting.length})</h3>
          <p>
            Sent while no agent was connected. One gets them when you run <code>/koppler-run connect</code> in your agent
            session; of several runs and Stops only the newest is acted on.
          </p>
          <ul>
            {#each inbox.waiting as one (one.key)}
              <li>
                <span class="what">{one.what}<small>{ago(one.at)}</small></span>
                <button type="button" aria-label="Drop: {one.what}" onclick={() => void inbox.drop(one.key)}
                  >Drop</button
                >
              </li>
            {/each}
          </ul>
        </section>
      {/if}
      {#if !list.length && inbox.waiting.length}
        <p class="none">The agent has said nothing yet.</p>
      {:else if !list.length}
        <p class="none">
          Nothing yet. When the agent needs a decision about your run, or finishes one, it shows up here.
        </p>
      {:else}
        {#each now as one (one.id)}
          <InboxMessage {one} past={past(one)} />
        {:else}
          <p class="none">Nothing since the canvas started.</p>
        {/each}
        {#if earlier.length}
          <details>
            <summary>Earlier ({earlier.length})</summary>
            {#each earlier as one (one.id)}
              <InboxMessage {one} past={past(one)} />
            {/each}
          </details>
        {/if}
      {/if}
    </div>
  </div>
{/if}

<style>
  .panel {
    display: flex;
    flex-direction: column;
    flex-shrink: 0;
    width: min(380px, 100%);
    border-left: 1px solid var(--line);
    background: var(--panel);
    color: var(--ink);
    font: 13px/1.45 var(--sans);
  }
  header {
    display: flex;
    align-items: center;
    gap: 8px;
    padding: 10px 12px;
    border-bottom: 1px solid var(--line);
  }
  h2 {
    margin: 0;
    font-size: 14px;
  }
  .sub {
    flex: 1;
    color: var(--warn);
    font-weight: 600;
    font-size: 12px;
  }
  header button {
    padding: 4px 10px;
    border: 1px solid var(--line);
    border-radius: 6px;
    background: none;
    color: var(--ink);
    font: 600 12px var(--sans);
    cursor: pointer;
  }
  .list {
    display: grid;
    align-content: start;
    gap: 10px;
    flex: 1;
    padding: 12px;
    overflow-y: auto;
  }
  .none {
    margin: 0;
    color: var(--muted);
  }
  .waiting {
    display: grid;
    gap: 6px;
    padding: 10px 12px;
    border: 1px solid color-mix(in oklab, var(--warn) 45%, transparent);
    border-radius: 10px;
    background: color-mix(in oklab, var(--warn) 8%, var(--surface));
  }
  .waiting h3,
  .waiting p,
  .waiting ul {
    margin: 0;
  }
  .waiting h3 {
    font-size: 13px;
  }
  .waiting p {
    color: var(--muted);
    font-size: 12px;
  }
  .waiting code {
    font: 12px var(--mono);
  }
  .waiting ul {
    display: grid;
    gap: 4px;
    padding: 0;
    list-style: none;
  }
  .waiting li {
    display: flex;
    align-items: center;
    gap: 8px;
  }
  .what {
    display: grid;
    flex: 1;
    min-width: 0;
    font-weight: 600;
  }
  .what small {
    color: var(--muted);
    font-weight: 400;
    font-size: 12px;
  }
  .waiting button {
    flex: none;
    padding: 4px 10px;
    border: 1px solid var(--line);
    border-radius: 6px;
    background: none;
    color: var(--ink);
    font: 600 12px var(--sans);
    cursor: pointer;
  }
  summary {
    color: var(--muted);
    font-size: 12.5px;
    cursor: pointer;
  }
  details {
    display: grid;
    gap: 10px;
  }
  details > :global(article) {
    margin-top: 10px;
  }
</style>
