<script lang="ts">
  let sheet: HTMLElement | undefined = $state();
  const shortcut = (ev: KeyboardEvent) => {
    if (ev.key !== '?' || (ev.target as Element).closest('input, select, textarea')) return;
    sheet?.togglePopover();
  };
</script>

<svelte:window onkeydown={shortcut} />

<button
  class="open"
  type="button"
  popovertarget="help"
  aria-label="Shortcuts and legend"
  title="Shortcuts and legend (?)"
>
  <svg viewBox="0 0 16 16" width="16" height="16" aria-hidden="true">
    <circle cx="8" cy="8" r="6.2" />
    <path d="M6.3 6.3a1.8 1.8 0 1 1 2.4 1.7c-.5.2-.7.6-.7 1.1v.3" />
    <circle class="dot" cx="8" cy="11.4" r=".4" />
  </svg>
</button>
<div class="sheet" id="help" popover bind:this={sheet} aria-label="Shortcuts and legend">
  <h2>Shortcuts</h2>
  <dl>
    <dt><kbd>F</kbd></dt>
    <dd>Fit the whole board in view</dd>
    <dt><kbd>V</kbd> / <kbd>H</kbd>, hold <kbd>Space</kbd></dt>
    <dd>Select / move around the board</dd>
    <dt><kbd>Cmd</kbd> or <kbd>Ctrl</kbd> + <kbd>Z</kbd></dt>
    <dd>Undo (add <kbd>Shift</kbd> to redo)</dd>
    <dt><kbd>Tab</kbd>, then arrow keys</dt>
    <dd>Move to a card, then move it</dd>
    <dt><kbd>Delete</kbd></dt>
    <dd>Remove the selected cards</dd>
    <dt><kbd>?</kbd></dt>
    <dd>This sheet</dd>
  </dl>
  <h2>On the board</h2>
  <dl>
    <dt><span class="cable"></span></dt>
    <dd>
      A cable: the app at its start calls your local copy of the app at its end. Drag from the ring on a card's edge, or
      use the card's Cables field.
    </dd>
    <dt><span class="card"></span></dt>
    <dd>A tunnel to a database or cache the app uses</dd>
    <dt><span class="cable queue"></span></dt>
    <dd>A queue between apps: dashed while it is the deployed one, solid once its switch runs it locally</dd>
    <dt><span class="card outside"></span></dt>
    <dd>An outside system, such as a payment provider: it never runs here</dd>
    <dt><span class="protected">Protected</span></dt>
    <dd>
      A protected environment (production, usually): red marks only the frame. Red on the board always means something
      failed.
    </dd>
    <dt><span class="calls">Calls QA</span></dt>
    <dd>Apps this one still calls in the deployed environment. Click one to run it locally too.</dd>
    <dt>Zoomed out</dt>
    <dd>Cards show only their state; zoom in to change them</dd>
  </dl>
</div>

<style>
  .open {
    display: grid;
    place-items: center;
    width: 32px;
    height: 32px;
    padding: 0;
    border: 0;
    border-radius: 8px;
    background: none;
    color: var(--muted);
    cursor: pointer;
  }
  .open:hover {
    background: color-mix(in oklab, var(--ink) 7%, transparent);
  }
  .open svg {
    fill: none;
    stroke: currentColor;
    stroke-width: 1.4;
    stroke-linecap: round;
  }
  .open .dot {
    fill: currentColor;
  }
  .sheet {
    inset: 60px 16px auto auto;
    width: 440px;
    max-width: calc(100vw - 24px);
    max-height: calc(100vh - 80px);
    margin: 0;
    padding: 14px 16px 16px;
    overflow-y: auto;
    border: 1px solid var(--line);
    border-radius: 10px;
    background: var(--surface);
    color: var(--ink);
    box-shadow: var(--lift);
    font: 12.5px/1.4 var(--sans);
  }
  h2 {
    margin: 4px 0 8px;
    font-size: 13px;
    font-weight: 700;
  }
  dl {
    display: grid;
    grid-template-columns: 172px 1fr;
    gap: 7px 14px;
    margin: 0 0 14px;
  }
  dt {
    display: flex;
    align-items: center;
    gap: 4px;
    white-space: nowrap;
  }
  dd {
    margin: 0;
    color: var(--muted);
  }
  kbd {
    padding: 0 5px;
    border: 1px solid var(--line);
    border-bottom-width: 2px;
    border-radius: 4px;
    background: var(--paper);
    font: 12px var(--mono);
  }
  .cable {
    width: 44px;
    border-top: 2.5px solid var(--cable);
  }
  .cable.queue {
    border-top: 2px dashed var(--msg);
  }
  .card {
    width: 44px;
    height: 16px;
    border: 1px dashed color-mix(in oklab, var(--muted) 55%, var(--line));
    border-radius: 4px;
    background: var(--paper);
  }
  .card.outside {
    background: none;
  }
  .protected {
    padding: 0 6px;
    border-top: 3px solid var(--prod);
    color: var(--prod);
    font-weight: 600;
  }
  .calls {
    color: var(--muted);
  }
</style>
