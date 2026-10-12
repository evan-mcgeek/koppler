<script lang="ts">
  // One message from the agent: what it says, the commands it gives, and for a question the ways to answer it.
  import { inbox, type Message } from './inbox.svelte.ts';

  /** `past`: it is history, shown faded with nothing to press. */
  const { one, past }: { one: Message; past: boolean } = $props();
  const KINDS: Record<string, string> = { question: 'Question', result: 'Done', failure: 'Failed', info: 'Update' };
  let copied = $state('');
  const waits = (message: Message) => message.kind === 'question' && !message.answered;
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
  const outcome = (message: Message) => {
    const done = message.answered;
    if (!done) return '';
    const picked = message.choices?.find(choice => choice.id === done.choice)?.label ?? done.choice;
    const how =
      done.via === 'replaced'
        ? 'Closed: a newer run replaced it'
        : done.via === 'dismissed'
          ? 'Dismissed'
          : done.via === 'chat'
            ? 'Answered in the chat'
            : picked
              ? `You chose: ${picked}`
              : `You answered: ${done.text ?? ''}`;
    return `${how}, ${time(done.at)}.`;
  };
  const copy = async (command: string) => {
    await navigator.clipboard.writeText(command).catch(() => undefined);
    copied = command;
    setTimeout(() => (copied = ''), 1500);
  };
  const reply = (ev: SubmitEvent, message: Message) => {
    ev.preventDefault();
    const box = (ev.currentTarget as HTMLFormElement).querySelector('textarea');
    const text = box?.value.trim();
    if (text) void inbox.answer(message, { text });
  };
</script>

<article class:waits={waits(one)} class:past data-kind={one.kind} inert={past}>
  <div class="meta"><span class="kind">{KINDS[one.kind] ?? 'Update'}</span><time>{time(one.at)}</time></div>
  <h3>{one.title}</h3>
  {#if one.summary}<p>{one.summary}</p>{/if}
  {#each one.sections ?? [] as section, at (at)}
    {#if section.title}<h4>{section.title}</h4>{/if}
    {#each section.commands ?? [] as command (command)}
      <div class="cmd">
        <code>{command}</code>
        <button type="button" title="Copy this command" onclick={() => void copy(command)}
          >{copied === command ? 'Copied' : 'Copy'}</button
        >
      </div>
    {/each}
    {#if section.items?.length}
      <ul>
        {#each section.items as item, index (index)}<li>{item}</li>{/each}
      </ul>
    {/if}
  {/each}
  {#if waits(one)}
    {#if one.choices?.length}
      <div class="choices">
        {#each one.choices as choice (choice.id)}
          <button class="choice" type="button" onclick={() => void inbox.answer(one, { choice: choice.id })}>
            <strong>{choice.label}</strong>{#if choice.detail}<span>{choice.detail}</span>{/if}
          </button>
        {/each}
      </div>
    {/if}
    <form
      onsubmit={ev => {
        reply(ev, one);
      }}
    >
      <textarea rows="1" placeholder="Or answer in your own words" aria-label="Your answer"></textarea>
      <button type="submit">Send</button>
    </form>
    <button
      class="dismiss"
      type="button"
      title="Close this question without answering; the agent is not told"
      onclick={() => void inbox.dismiss(one)}>Dismiss</button
    >
  {/if}
  {#if one.answered}<p class="answered">{outcome(one)}</p>{/if}
</article>

<style>
  form button,
  .cmd button,
  .dismiss {
    padding: 4px 10px;
    border: 1px solid var(--line);
    border-radius: 6px;
    background: none;
    color: var(--ink);
    font: 600 12px var(--sans);
    cursor: pointer;
  }
  article {
    display: grid;
    gap: 6px;
    padding: 10px 12px;
    border: 1px solid var(--line);
    border-radius: 10px;
    background: var(--surface);
  }
  article.waits {
    border-color: color-mix(in oklab, var(--warn) 55%, transparent);
  }
  article.past {
    opacity: 0.6;
  }
  .meta {
    display: flex;
    justify-content: space-between;
    color: var(--muted);
    font-size: 12px;
  }
  .kind {
    font-weight: 600;
  }
  [data-kind='failure'] .kind {
    color: var(--bad);
  }
  [data-kind='result'] .kind {
    color: var(--ok);
  }
  [data-kind='question'] .kind {
    color: var(--warn);
  }
  h3,
  h4,
  p,
  ul {
    margin: 0;
  }
  h3 {
    font-size: 14px;
  }
  h4 {
    margin-top: 4px;
    font-size: 12.5px;
  }
  ul {
    padding-left: 18px;
  }
  .cmd {
    display: flex;
    align-items: center;
    gap: 8px;
  }
  code {
    flex: 1;
    min-width: 0;
    padding: 5px 8px;
    overflow-x: auto;
    border: 1px solid var(--line);
    border-radius: 6px;
    background: var(--paper);
    font: 12px var(--mono);
    white-space: nowrap;
  }
  .choices {
    display: grid;
    gap: 6px;
  }
  .choice {
    display: grid;
    gap: 2px;
    padding: 8px 10px;
    border: 1px solid var(--line);
    border-radius: 8px;
    background: var(--paper);
    color: var(--ink);
    font: inherit;
    text-align: left;
    cursor: pointer;
  }
  .choice:hover,
  .choice:focus-visible {
    border-color: var(--cable);
    outline: none;
  }
  .choice span {
    color: var(--muted);
    font-size: 12px;
  }
  form {
    display: flex;
    gap: 6px;
  }
  textarea {
    flex: 1;
    min-width: 0;
    padding: 5px 8px;
    border: 1px solid var(--line);
    border-radius: 6px;
    background: var(--paper);
    color: var(--ink);
    font: 13px var(--sans);
    field-sizing: content;
    resize: none;
  }
  .dismiss {
    justify-self: start;
    border-color: transparent;
    color: var(--muted);
  }
  .answered {
    color: var(--muted);
    font-size: 12px;
  }
</style>
