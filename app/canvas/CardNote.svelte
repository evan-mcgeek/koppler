<script lang="ts">
  // A card's note for the agent; the run carries it. An app offers it with a link; any other card shows a written note as
  // text, opened in place to edit, and is offered one from its foot while picked.
  import NotebookPen from '@lucide/svelte/icons/notebook-pen';
  const {
    value,
    placeholder,
    onchange,
    card = false,
    reading = false,
    editing = false,
    onediting = () => undefined,
  }: {
    value: string;
    placeholder: string;
    onchange: (note: string) => void;
    /** A card that is not an app: no link at rest, its note as text. */
    card?: boolean;
    /** In Live: the note is read, not edited. */
    reading?: boolean;
    /** The box is open, and how the card hears it open or close. */
    editing?: boolean;
    onediting?: (open: boolean) => void;
  } = $props();
  let noting = $state(false);
  let draft = $state('');
  let before = '';
  const grow = (box: HTMLTextAreaElement) => {
    box.style.height = 'auto';
    box.style.height = `${String(box.scrollHeight + 2)}px`;
  };
  const focus = (box: HTMLTextAreaElement) => {
    box.focus();
  };
  $effect(() => {
    if (editing) {
      before = value;
      draft = value;
    }
  });
  const done = () => {
    onchange(draft.trim() ? draft : '');
    onediting(false);
  };
</script>

{#if !card}
  {#if value || noting}
    <label class="field nodrag">
      Note for the agent
      <textarea
        rows="2"
        {placeholder}
        {value}
        {@attach grow}
        oninput={ev => {
          grow(ev.currentTarget);
          onchange(ev.currentTarget.value);
        }}
        onblur={() => (noting = false)}
      ></textarea>
    </label>
  {:else}
    <button class="add nodrag" type="button" onclick={() => (noting = true)}>Add a note for the agent</button>
  {/if}
{:else if editing && !reading}
  <div class="editing nodrag">
    <label class="field">
      Note for the agent
      <textarea
        rows="2"
        {placeholder}
        bind:value={draft}
        {@attach grow}
        {@attach focus}
        oninput={ev => {
          grow(ev.currentTarget);
        }}
        onkeydown={ev => {
          if (ev.key !== 'Escape') return;
          ev.stopPropagation();
          draft = before;
          onediting(false);
        }}
        onblur={ev => {
          // Leaving for Remove note or Done lets them act; anywhere else saves.
          if (!(ev.relatedTarget as Element | null)?.closest('.editing')) done();
        }}
      ></textarea>
    </label>
    <span class="choices">
      <button
        class="remove"
        type="button"
        onclick={() => {
          draft = '';
          done();
        }}>Remove note</button
      >
      <button class="done" type="button" onclick={done}>Done</button>
    </span>
  </div>
{:else if value}
  {#if reading}
    <div class="written">
      <span class="label"><NotebookPen size={12} aria-hidden="true" />Note for the agent</span>
      <span class="text">{value}</span>
    </div>
  {:else}
    <button
      class="written nodrag"
      type="button"
      title="Click to edit"
      onclick={() => {
        onediting(true);
      }}
    >
      <span class="label"><NotebookPen size={12} aria-hidden="true" />Note for the agent</span>
      <span class="text">{value}</span>
    </button>
  {/if}
{/if}

<style>
  .field {
    display: grid;
    gap: 5px;
    color: var(--ink-muted);
    font: 400 12px var(--sans);
  }
  .add {
    display: inline-flex;
    justify-self: start;
    align-items: center;
    gap: 5px;
    min-height: 24px;
    padding: 2px 0;
    border: 0;
    background: none;
    color: var(--muted);
    font: 500 12.5px var(--sans);
    cursor: pointer;
  }
  .add::before {
    content: '+';
    font-size: 16px;
    line-height: 1;
  }
  .add:hover {
    color: var(--cable);
  }
  textarea {
    width: 100%;
    min-height: 52px;
    padding: 6px 8px;
    resize: none;
    overflow: hidden;
    border: 1px solid var(--line);
    border-radius: 6px;
    background: var(--paper);
    color: var(--ink);
    font: 13px/1.4 var(--sans);
  }
  .editing textarea {
    padding: 7px 9px;
    border-color: var(--line-strong);
    border-radius: 0;
    background: var(--desk);
  }
  textarea::placeholder {
    color: var(--muted);
  }
  .editing {
    display: grid;
    gap: 8px;
  }
  .choices {
    display: flex;
    justify-content: space-between;
    align-items: center;
  }
  .choices button {
    padding: 0;
    border: 0;
    background: none;
    font: 400 12px var(--sans);
    text-decoration: underline;
    text-underline-offset: 3px;
    cursor: pointer;
  }
  .remove {
    color: var(--ink-muted);
  }
  .done {
    color: var(--ink);
  }
  /* A written note reads as text, set apart from the card's own data by its edge and icon. */
  .written {
    display: flex;
    flex-direction: column;
    gap: 3px;
    width: 100%;
    padding: 7px 9px;
    border: 0;
    border-left: 2px solid var(--line-strong);
    background: var(--desk);
    text-align: left;
  }
  button.written {
    cursor: pointer;
  }
  .written .label {
    display: flex;
    align-items: center;
    gap: 6px;
    color: var(--ink-muted);
    font: 400 12px var(--sans);
  }
  .written .text {
    display: -webkit-box;
    overflow: hidden;
    color: var(--ink);
    font: 400 13px/1.4 var(--sans);
    -webkit-box-orient: vertical;
    -webkit-line-clamp: 2;
    line-clamp: 2;
  }
  :is(textarea, .add, .written, .choices button):focus-visible {
    outline: 2px solid var(--ink);
    outline-offset: 2px;
  }
</style>
