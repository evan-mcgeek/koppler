<script lang="ts">
  // Share in Discover's bar: a feature board as a view-only page, a snapshot of today, for anyone to open in a browser.
  import { board } from './board.svelte.ts';
  import { savePage } from './boards.ts';
  import { toasts } from './toast.svelte.ts';

  const id = $props.id();
  let pop = $state<HTMLDivElement>();
  let button = $state<HTMLButtonElement>();
  let env = $state(board.env);
  let busy = $state(false);
  /** When this board was last shared from this Mac, to say so to the sharer. */
  const key = $derived(`koppler-shared:${board.dir}:${board.name ?? ''}`);
  let shared = $state('');
  const said = (iso: string) =>
    new Date(iso).toLocaleDateString(undefined, { day: 'numeric', month: 'short', year: 'numeric' });
  const place = () => {
    const at = button?.getBoundingClientRect();
    if (!at || !pop) return;
    pop.style.top = `${String(at.bottom + 6)}px`;
    pop.style.left = `${String(Math.max(8, Math.min(at.right - 360, innerWidth - 368)))}px`;
  };
  const share = async () => {
    if (!board.name || busy) return;
    busy = true;
    const file = await savePage(board.name, env);
    busy = false;
    if (!file) return;
    shared = new Date().toISOString();
    try {
      localStorage.setItem(key, shared);
    } catch {
      // Not remembered where the browser keeps nothing.
    }
    pop?.hidePopover();
    toasts.show(`Saved ${file}: send it, attach it, or put it on your team's site. It opens in any browser.`);
  };
</script>

<button
  bind:this={button}
  class="share"
  type="button"
  disabled={!board.feature}
  title={board.feature ? 'A view-only page of this feature board' : 'Shares are of feature boards: pick one first'}
  popovertarget={id}>Share</button
>
<div
  bind:this={pop}
  {id}
  class="pop"
  popover
  role="dialog"
  aria-label="Share {board.name ?? ''}, view only"
  onbeforetoggle={ev => {
    if (ev.newState !== 'open') return;
    env = board.env;
    try {
      shared = localStorage.getItem(key) ?? '';
    } catch {
      shared = '';
    }
  }}
  ontoggle={ev => {
    if (ev.newState === 'open') place();
  }}
>
  <strong>Share {board.name}, view only</strong>
  <p>
    Anyone with the page sees the map, the steps, the walk-through and each app's description, on {env.toUpperCase()}.
    No hosts, routes or settings. Nothing they do is saved.
  </p>
  <div class="row">
    <span class="label">Environment</span>
    <span class="seg" role="radiogroup" aria-label="Environment of the page">
      {#each board.envs as one (one)}
        <label><input type="radio" name="{id}-env" value={one} bind:group={env} />{one.toUpperCase()}</label>
      {/each}
    </span>
  </div>
  <p class="snap">
    A snapshot of today. Share again after changes.{#if shared}<span class="when">Shared {said(shared)}</span>{/if}
  </p>
  <button class="primary" type="button" disabled={busy} onclick={() => void share()}>Save the page</button>
</div>

<style>
  .share {
    height: 32px;
    padding: 0 12px;
    border: 1px solid var(--line-strong);
    border-radius: 0;
    background: none;
    color: var(--ink);
    font: 600 13px var(--sans);
    cursor: pointer;
  }
  .share:disabled {
    color: var(--muted);
    cursor: default;
  }
  .share:not(:disabled):hover,
  .share:focus-visible {
    border-color: var(--ink);
    outline: none;
  }
  .pop {
    position: fixed;
    inset: auto;
    width: 360px;
    margin: 0;
    padding: 14px 16px;
    border: 1px solid var(--ink);
    border-radius: 0;
    background: var(--panel);
    color: var(--ink);
    box-shadow: var(--lift);
    font: 400 13px var(--sans);
  }
  .pop:popover-open {
    display: grid;
    gap: 10px;
  }
  p {
    margin: 0;
    color: var(--muted);
  }
  .row {
    display: flex;
    align-items: center;
    justify-content: space-between;
  }
  .label {
    color: var(--muted);
    font: 600 12px var(--sans);
  }
  .seg label {
    padding: 4px 10px;
  }
  .snap {
    display: flex;
    flex-wrap: wrap;
    gap: 4px 10px;
  }
  .when {
    color: var(--ink);
  }
  .primary {
    justify-self: end;
    height: 32px;
    padding: 0 14px;
    border: 0;
    border-radius: 0;
    background: var(--ink);
    color: var(--desk);
    font: 600 13px var(--sans);
    cursor: pointer;
  }
  .primary:disabled {
    opacity: 0.6;
    cursor: default;
  }
</style>
