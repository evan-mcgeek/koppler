<script lang="ts">
  // A comment's thread beside the map: yours and the agent's answers, and the step the agent proposed, to keep or undo.
  import X from '@lucide/svelte/icons/x';
  import { numbered } from '../src/core/feature.ts';
  import { board } from './board.svelte.ts';
  import { discovered } from './discover.svelte.ts';
  import { live } from './live.svelte.ts';

  let text = $state('');
  const open = $derived(discovered.thread);
  const comment = $derived(open && 'id' in open ? board.feature?.comments?.find(one => one.id === open.id) : undefined);
  const on = $derived(comment?.on ?? (open && 'on' in open ? open.on : null));
  /** The agent has your last word and is at work. */
  const looking = $derived(comment?.thread.at(-1)?.by === 'you' && (live.status?.agent?.state ?? 'none') === 'busy');
  const time = (iso: string) =>
    Number.isNaN(Date.parse(iso))
      ? ''
      : new Date(iso).toLocaleTimeString(undefined, { hour: '2-digit', minute: '2-digit' });
  /** The agent's proposed step, while it still waits to be kept: its number. */
  const waiting = (step: { from: string; to: string; phase?: string }) =>
    board.feature
      ? numbered(board.feature).find(
          one =>
            one.step.proposed &&
            one.step.from === step.from &&
            one.step.to === step.to &&
            (!step.phase || board.feature?.phases[one.phase]?.name === step.phase),
        )?.number
      : undefined;
  const close = () => {
    discovered.thread = null;
    text = '';
  };
  const send = async (ev: SubmitEvent) => {
    ev.preventDefault();
    const words = text.trim();
    if (!words) return;
    text = '';
    if (comment) await discovered.reply(comment.id, words);
    else if (on) await discovered.comment(on, words);
  };
</script>

{#if on}
  <aside class="thread" aria-label="Comment on {discovered.about(on)}">
    <header>
      <h2>{'card' in on ? board.nameOf(on.card) : discovered.about(on)}</h2>
      {#if comment}
        <button class="text" type="button" onclick={() => void discovered.resolve(comment.id)}>Resolve</button>
      {/if}
      <button class="close" type="button" aria-label="Close" onclick={close}><X size={16} /></button>
    </header>
    {#each comment?.thread ?? [] as said, at (at)}
      <div class="said" class:agent={said.by === 'agent'}>
        <span class="who">{said.by === 'agent' ? 'Agent' : 'You'}{time(said.at) ? ` · ${time(said.at)}` : ''}</span>
        <p>{said.text}</p>
        {#if said.step && waiting(said.step)}
          {@const number = waiting(said.step)}
          {@const step = said.step}
          <span class="keep">
            <button
              class="primary"
              type="button"
              onclick={() =>
                void discovered.accept([{ from: step.from, to: step.to, ...(step.phase && { phase: step.phase }) }])}
              >Keep step {number}</button
            >
            <button
              class="text"
              type="button"
              onclick={() => {
                discovered.drop([{ from: step.from, to: step.to, ...(step.phase && { phase: step.phase }) }]);
              }}>Undo</button
            >
          </span>
        {/if}
      </div>
    {/each}
    {#if looking}
      <p class="looking" role="status"><span class="dot" aria-hidden="true"></span>The agent is looking into it</p>
    {/if}
    <form onsubmit={send}>
      <!-- svelte-ignore a11y_autofocus -->
      <textarea
        aria-label={comment ? 'Reply' : 'Comment'}
        rows="3"
        maxlength="2000"
        autofocus
        placeholder={comment ? 'Reply' : "Say what's missing or wrong"}
        bind:value={text}
        onkeydown={ev => {
          if (ev.key === 'Escape') {
            ev.stopPropagation();
            close();
          }
        }}
      ></textarea>
      <span class="foot">
        <span>The agent answers here</span>
        <button class="primary" type="submit" disabled={!text.trim()}>{comment ? 'Reply' : 'Comment'}</button>
      </span>
    </form>
  </aside>
{/if}

<style>
  .thread {
    display: flex;
    flex: none;
    flex-direction: column;
    gap: 12px;
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
    gap: 10px;
  }
  h2 {
    flex: 1;
    margin: 0;
    font: 600 20px/1.15 var(--display);
  }
  .close {
    display: flex;
    padding: 4px;
    border: 0;
    background: none;
    color: var(--ink);
    cursor: pointer;
  }
  .said {
    display: grid;
    gap: 4px;
    padding-bottom: 10px;
    border-bottom: 1px solid var(--line);
  }
  .who {
    color: var(--muted);
    font: 600 12px var(--sans);
  }
  .said p {
    margin: 0;
    font: 400 14px/1.45 var(--sans);
  }
  .keep {
    display: flex;
    align-items: center;
    gap: 12px;
    margin-top: 4px;
  }
  .looking {
    display: flex;
    align-items: center;
    gap: 8px;
    margin: 0;
    color: var(--muted);
    font: 400 13px var(--sans);
  }
  .dot {
    width: 7px;
    height: 7px;
    background: var(--warn);
  }
  form {
    display: grid;
    gap: 8px;
  }
  textarea {
    padding: 8px 9px;
    border: 1px solid var(--line-strong);
    border-radius: 0;
    background: var(--desk);
    color: var(--ink);
    font: 400 13px/1.45 var(--sans);
    resize: vertical;
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
  .primary {
    height: 30px;
    padding: 0 12px;
    border: 0;
    border-radius: 0;
    background: var(--ink);
    color: var(--desk);
    font: 600 13px var(--sans);
    cursor: pointer;
  }
  .primary:disabled {
    opacity: 0.5;
    cursor: default;
  }
  .text {
    padding: 0;
    border: 0;
    background: none;
    color: var(--ink);
    font: 400 13px var(--sans);
    text-decoration: underline;
    text-underline-offset: 3px;
    cursor: pointer;
  }
</style>
