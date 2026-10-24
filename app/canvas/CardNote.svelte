<script lang="ts">
  // A card's note for the agent: a link to add one, then a box that grows with it. The run carries it.
  const { value, placeholder, onchange }: { value: string; placeholder: string; onchange: (note: string) => void } =
    $props();
  let noting = $state(false);
  const grow = (box: HTMLTextAreaElement) => {
    box.style.height = 'auto';
    box.style.height = `${String(box.scrollHeight + 2)}px`;
  };
</script>

{#if value || noting}
  <label class="note nodrag">
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

<style>
  .note {
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
  textarea::placeholder {
    color: var(--muted);
  }
  :is(textarea, .add):focus-visible {
    outline: 2px solid var(--ink);
    outline-offset: 1px;
  }
</style>
