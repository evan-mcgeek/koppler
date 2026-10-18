<script lang="ts">
  import ReviewControls from './ReviewControls.svelte';
  import { board } from './board.svelte.ts';
  import { runs } from './run.svelte.ts';

  let dialog: HTMLDialogElement | undefined = $state();
  const review = $derived(runs.review);
  $effect(() => {
    if (review && !dialog?.open) dialog?.showModal();
    else if (!review && dialog?.open) dialog.close();
  });
</script>

<dialog
  bind:this={dialog}
  class:prod={review?.prod && board.protected}
  aria-labelledby="review-title"
  onclose={() => {
    // Escape closed it. A close that arrives after the next review opened is the previous one's: left alone.
    if (!dialog?.open) runs.review = null;
  }}
>
  {#if review}
    {#if review.prod && board.protected}
      <p class="stripes" aria-hidden="true">{board.env.toUpperCase()} · production data and customers</p>
    {/if}
    <p class="kicker" aria-hidden="true">Review first</p>
    <h2 id="review-title">{review.title}</h2>
    <p class="sub">{review.sub}</p>
    <div class="body">
      {#each review.notices as notice, at (at)}
        <p class="notice" class:prod={notice.kind === 'prod'}>
          {notice.text}
          {#if notice.act}<button class="mini" type="button" onclick={notice.act.run}>{notice.act.label}</button>{/if}
        </p>
      {/each}
      {#each review.groups as group, at (at)}
        <ul class="lines">
          <li>
            <span class="verb" data-verb={group.verb}>{group.label}</span>
            <span class="apps">
              {#each group.items as item, at (at)}
                <span class:off={item.off}>
                  {item.name}
                  {#if item.act}
                    <button class="mini" type="button" title={item.act.title} onclick={item.act.run}
                      >{item.act.label}</button
                    >
                  {/if}
                  {#each item.notes as note, at (at)}<small class={note.kind} title={note.title}>{note.text}</small
                    >{/each}
                  {#if item.id}<ReviewControls id={item.id} />{/if}
                </span>
              {/each}
            </span>
          </li>
        </ul>
      {/each}
    </div>
    <div class="actions">
      {#if review.back}
        <button
          class="back"
          type="button"
          onclick={() => {
            const { back } = review;
            runs.review = null;
            back?.run();
          }}>{review.back.label}</button
        >
      {/if}
      <button
        type="button"
        onclick={() => {
          runs.review = null;
        }}>Cancel</button
      >
      <button
        class="ok"
        class:prod={review.prod}
        type="button"
        disabled={review.blocked}
        onclick={() => {
          runs.confirm();
        }}>{review.ok}</button
      >
    </div>
  {/if}
</dialog>

<style>
  dialog {
    width: 600px;
    max-width: calc(100vw - 32px);
    max-height: calc(100vh - 32px);
    padding: 24px 28px;
    border: 1px solid var(--line-strong);
    background: var(--panel);
    color: var(--ink);
    font: 14px/1.45 var(--sans);
  }
  dialog.prod {
    padding-top: 0;
    border: 2px solid var(--prod);
  }
  dialog[open] {
    display: flex;
    flex-direction: column;
  }
  dialog::backdrop {
    background: color-mix(in oklab, var(--desk) 78%, transparent);
  }
  .stripes {
    margin: 0 -28px 20px;
    padding: 6px 28px;
    background: var(--prod-stripes);
    color: var(--desk);
    font: 700 11px var(--mono);
    letter-spacing: 0.08em;
    text-transform: uppercase;
  }
  .kicker {
    margin: 0 0 6px;
    color: var(--ink-muted);
    font: 500 10px var(--mono);
    letter-spacing: 0.08em;
    text-transform: uppercase;
  }
  h2 {
    margin: 0;
    font: 600 28px/1.15 var(--mono);
    font-stretch: 87.5%;
    letter-spacing: -0.01em;
  }
  .prod h2 {
    color: var(--prod);
  }
  .sub {
    margin: 8px 0 16px;
    color: var(--ink-muted);
  }
  .body {
    flex: 1 1 auto;
    min-height: 0;
    margin: 0 -28px;
    padding: 0 28px;
    overflow-y: auto;
    border-top: 1px solid var(--line);
  }
  .notice {
    margin: 16px 0 0;
    padding: 10px 12px;
    border: 1px solid var(--warn);
    font-size: 13px;
  }
  .notice.prod {
    border-color: var(--prod);
  }
  .lines {
    display: grid;
    gap: 10px;
    margin: 0;
    padding: 16px 0;
    border-bottom: 1px solid var(--line);
    list-style: none;
  }
  .lines li {
    display: grid;
    grid-template-columns: 124px minmax(0, 1fr);
    column-gap: 16px;
  }
  .verb {
    padding-top: 3px;
    color: var(--ink-muted);
    font: 500 10px/1.6 var(--mono);
    letter-spacing: 0.08em;
    text-transform: uppercase;
  }
  .verb[data-verb='restarts'] {
    color: var(--warn);
  }
  .verb[data-verb='stops'] {
    color: var(--prod);
  }
  .apps {
    display: grid;
    grid-template-columns: minmax(0, 1fr);
    gap: 8px;
    font-weight: 600;
  }
  .mini {
    margin-left: 8px;
    padding: 2px 8px;
    border: 1px solid var(--line-strong);
    background: none;
    color: var(--ink);
    font: 600 11px var(--mono);
    cursor: pointer;
  }
  small {
    display: block;
    color: var(--ink-muted);
    font-size: 12px;
    font-weight: 400;
  }
  small:not(.host)::first-letter {
    text-transform: uppercase;
  }
  small.host {
    font: 11px var(--mono);
    overflow-wrap: anywhere;
  }
  small.flag,
  .off,
  .off small {
    color: var(--warn);
  }
  .actions {
    display: flex;
    justify-content: flex-end;
    gap: 8px;
    margin-top: 20px;
  }
  .back {
    margin-right: auto;
  }
  button {
    padding: 8px 14px;
    border: 1px solid var(--line-strong);
    background: none;
    color: var(--ink);
    font: 600 12px var(--mono);
    cursor: pointer;
  }
  button:hover {
    background: color-mix(in oklab, var(--ink) 7%, transparent);
  }
  .ok {
    border-color: var(--local);
    background: var(--local);
    color: var(--desk);
  }
  .ok:hover {
    background: color-mix(in oklab, var(--local) 85%, var(--desk));
  }
  .ok.prod {
    border-color: var(--prod);
    background: var(--prod);
    color: var(--desk);
  }
  .ok:disabled {
    border: 1px dashed var(--line-strong);
    background: none;
    color: var(--ink-muted);
    cursor: not-allowed;
  }
  .ok.prod:disabled {
    border-color: var(--prod);
    color: var(--prod);
  }
  :focus-visible {
    outline: 2px solid var(--local);
    outline-offset: 2px;
  }
</style>
