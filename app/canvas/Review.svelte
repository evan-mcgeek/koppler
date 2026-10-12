<script lang="ts">
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
  aria-labelledby="review-title"
  onclose={() => {
    // Escape closed it. A close that arrives after the next review opened is the previous one's: left alone.
    if (!dialog?.open) runs.review = null;
  }}
>
  {#if review}
    <h2 id="review-title">{review.title}</h2>
    <p class="sub">{review.sub}</p>
    <div class="body">
      {#each review.notices as notice (notice.text)}
        <p class="notice" class:prod={notice.kind === 'prod'}>{notice.text}</p>
      {/each}
      {#each review.groups as group (group.label)}
        <ul class="lines">
          <li>
            <span class="verb" data-verb={group.verb}>{group.label}</span>
            <span class="apps">
              {#each group.items as item (item.name)}
                <span class:off={item.off}>
                  {item.name}
                  {#each item.notes as note (note.text)}<small class={note.kind}>{note.text}</small>{/each}
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
          review.confirm();
          runs.review = null;
        }}>{review.ok}</button
      >
    </div>
  {/if}
</dialog>

<style>
  dialog {
    width: 520px;
    max-width: calc(100vw - 32px);
    max-height: calc(100vh - 32px);
    padding: 20px;
    border: 1px solid var(--line);
    border-radius: 12px;
    background: var(--surface);
    color: var(--ink);
    box-shadow: var(--lift-high);
    font: 13px/1.4 var(--sans);
  }
  dialog[open] {
    display: flex;
    flex-direction: column;
  }
  dialog::backdrop {
    background: color-mix(in oklab, var(--desk) 70%, transparent);
  }
  h2 {
    margin: 0;
    font-size: 17px;
    font-weight: 700;
  }
  .sub {
    margin: 4px 0 10px;
    color: var(--muted);
  }
  .body {
    flex: 1 1 auto;
    min-height: 0;
    margin: 0 -20px;
    padding: 0 20px;
    overflow-y: auto;
  }
  .notice {
    margin: 0 0 12px;
    padding: 8px 10px;
    border-radius: 7px;
    background: color-mix(in oklab, var(--warn) 14%, transparent);
    font-size: 12.5px;
  }
  .notice.prod {
    background: color-mix(in oklab, var(--prod) 16%, transparent);
  }
  .lines {
    display: grid;
    gap: 10px;
    margin: 0 0 12px;
    padding: 0;
    list-style: none;
  }
  .lines li {
    display: grid;
    grid-template-columns: 124px minmax(0, 1fr);
    column-gap: 12px;
  }
  .verb {
    font-weight: 600;
  }
  .verb[data-verb='starts'] {
    color: var(--ok);
  }
  .verb[data-verb='restarts'] {
    color: var(--warn);
  }
  .verb[data-verb='stops'] {
    color: var(--bad);
  }
  .verb[data-verb='keeps'],
  .verb[data-verb='calls'] {
    color: var(--muted);
  }
  .apps {
    display: grid;
    grid-template-columns: minmax(0, 1fr);
    gap: 6px;
  }
  small {
    display: block;
    color: var(--muted);
    font-size: 12px;
  }
  small:not(.host)::first-letter {
    text-transform: uppercase;
  }
  small.host {
    font: 12px var(--mono);
    overflow-wrap: anywhere;
  }
  small.flag,
  .off,
  .off small {
    color: var(--warn);
    font-weight: 600;
  }
  .actions {
    display: flex;
    justify-content: flex-end;
    gap: 8px;
    margin-top: 18px;
  }
  .back {
    margin-right: auto;
  }
  button {
    padding: 6px 12px;
    border: 1px solid var(--line);
    border-radius: 8px;
    background: none;
    color: var(--ink);
    font: 600 13px var(--sans);
    cursor: pointer;
  }
  button:hover {
    background: color-mix(in oklab, var(--ink) 7%, transparent);
  }
  .ok {
    border-color: var(--cable);
    background: var(--cable);
    color: var(--on-accent);
  }
  .ok:hover {
    background: color-mix(in oklab, var(--cable) 85%, var(--ink));
  }
  .ok.prod {
    border-color: var(--prod);
    background: var(--prod);
  }
  .ok:disabled {
    border-color: var(--line);
    background: color-mix(in oklab, var(--ink) 8%, transparent);
    color: var(--muted);
    cursor: not-allowed;
  }
  :focus-visible {
    outline: 2px solid var(--cable);
    outline-offset: 2px;
  }
</style>
