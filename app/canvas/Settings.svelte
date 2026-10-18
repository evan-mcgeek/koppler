<script lang="ts">
  import Icon from './Icon.svelte';
  import Settings from '@lucide/svelte/icons/settings';
  import { debug } from './debug.svelte.ts';
  import { appearance, DEPLOYEDS, LOCALS, SCHEMES, type Scheme } from './appearance.svelte.ts';
  import { toasts } from './toast.svelte.ts';
  import { post } from './data.ts';

  // A new address: every other open tab and every copied link stops working, so it is asked for twice.
  let renewing = $state(false);
  const renew = async () => {
    const said = await post<{ path: string }>('new-address', { port: location.port });
    if ('error' in said) {
      toasts.show(`No new address: ${said.error}`, 'warning');
      renewing = false;
      return;
    }
    location.replace(said.path + location.hash);
  };

  const copyLog = async () => {
    const text = await debug.read();
    if (!text) {
      toasts.show('The debug log is empty. Turn it on, then do what went wrong.');
      return;
    }
    const copied = await navigator.clipboard.writeText(text).then(
      () => true,
      () => false,
    );
    if (copied) toasts.show('Last 300 entries copied');
    else toasts.show("Copy is blocked here: the log is debug.jsonl in Koppler's run folder", 'warning');
  };

  const schemes = Object.entries(SCHEMES) as [Scheme, (typeof SCHEMES)[Scheme]][];
  const picks = $derived([
    [
      'Local',
      LOCALS,
      appearance.local,
      (hex: string) => {
        appearance.pickLocal(hex);
      },
    ],
    [
      'Deployed',
      DEPLOYEDS,
      appearance.deployed,
      (hex: string) => {
        appearance.pickDeployed(hex);
      },
    ],
  ] as const);
  const custom = $derived(!!(appearance.now.local ?? appearance.now.deployed));
</script>

<button class="open" type="button" popovertarget="settings" aria-label="Settings" title="Settings">
  <Icon of={Settings} size={16} />
</button>
<div class="pop" id="settings" popover aria-label="Settings">
  <div class="row log">
    <label
      class="toggle"
      title={debug.forced
        ? 'Always on while Koppler runs from its source folder, so every problem can be traced.'
        : 'Keeps every click, change and message on this canvas, so a problem can be traced. Nothing you type is kept.'}
    >
      <input type="checkbox" role="switch" bind:checked={debug.on} disabled={debug.forced} /><span
        class="track"
        aria-hidden="true"
      ></span>Debug log
    </label>
    {#if debug.on}
      <button class="text" type="button" onclick={copyLog}>Copy</button>
      <button
        class="text"
        type="button"
        onclick={() => {
          debug.clear();
          toasts.show('Debug log cleared');
        }}>Clear</button
      >
    {/if}
  </div>
  <div class="row address">
    {#if renewing}
      <span class="warn">Other open tabs and copied links stop working.</span>
      <button class="text" type="button" onclick={() => (renewing = false)}>Cancel</button>
      <button class="text go" type="button" onclick={() => void renew()}>Get it</button>
    {:else}
      <span>Address</span>
      <button
        class="text"
        type="button"
        title="Give the canvas a new address, so a link that was copied or shared no longer opens it"
        onclick={() => (renewing = true)}>New address</button
      >
    {/if}
  </div>
  <section class="appearance" aria-label="Appearance">
    <h2>Appearance · scheme</h2>
    <div class="schemes" role="radiogroup" aria-label="Scheme">
      {#each schemes as [id, scheme] (id)}
        <button
          type="button"
          role="radio"
          class="scheme"
          aria-checked={appearance.now.scheme === id}
          onclick={() => {
            appearance.pickScheme(id);
          }}
        >
          <span class="mark" aria-hidden="true"></span>
          <span class="swatch" aria-hidden="true"
            ><i style:background="var(--desk)"></i><i style:background={scheme.local}></i><i
              style:background={scheme.deployed}
            ></i></span
          >
          <span class="words"><b>{scheme.name}</b><small>{scheme.note}</small></span>
        </button>
      {/each}
    </div>
    {#each picks as [label, hexes, now, pick] (label)}
      <div class="picks-head">
        <h2>{label}</h2>
        {#if label === 'Local' && custom}
          <button
            class="link"
            type="button"
            onclick={() => {
              appearance.schemeDefault();
            }}>Scheme default</button
          >
        {/if}
      </div>
      <div class="picks" role="radiogroup" aria-label="{label} colour">
        {#each hexes as hex (hex)}
          <button
            type="button"
            role="radio"
            aria-checked={now === hex}
            aria-label="{label} {hex}"
            style:--hex={hex}
            onclick={() => {
              pick(hex);
            }}
          ></button>
        {/each}
      </div>
    {/each}
    <p>Warning and PROD colours are left out of both rows, so a custom pick can never be mistaken for either.</p>
  </section>
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
    anchor-name: --settings;
  }
  .open:hover {
    background: color-mix(in oklab, var(--ink) 7%, transparent);
  }
  .pop {
    inset: auto auto 56px 12px;
    margin: 0;
    padding: 10px 12px;
    border: 1px solid var(--line);
    border-radius: 10px;
    background: var(--surface);
    color: var(--ink);
    box-shadow: var(--lift);
    font: 13px var(--sans);
  }
  .row {
    display: flex;
    align-items: center;
    gap: 4px;
  }
  .log {
    margin-bottom: 8px;
    padding-bottom: 8px;
    border-bottom: 1px solid var(--line);
  }
  .toggle {
    flex: 1;
    min-height: 28px;
    margin-right: 8px;
  }
  .row button.text {
    width: auto;
    padding: 0 10px;
    border-color: var(--line);
    color: var(--ink);
    font: 600 12px var(--sans);
  }
  .row span {
    margin-right: 8px;
    color: var(--muted);
  }
  .row button {
    display: grid;
    place-items: center;
    width: 30px;
    height: 28px;
    padding: 0;
    border: 1px solid transparent;
    border-radius: 6px;
    background: none;
    color: var(--muted);
    cursor: pointer;
  }
  .row button:hover {
    background: color-mix(in oklab, var(--ink) 7%, transparent);
  }
  .address .warn {
    flex: 1;
    max-width: 200px;
    color: var(--muted);
    font-size: 12px;
  }
  .appearance {
    width: 340px;
    margin-top: 8px;
    padding-top: 10px;
    border-top: 1px solid var(--line);
  }
  h2 {
    margin: 0 0 8px;
    color: var(--ink-muted);
    font: 500 10px var(--mono);
    letter-spacing: 0.08em;
    text-transform: uppercase;
  }
  .schemes {
    display: grid;
    border: 1px solid var(--line-strong);
  }
  .scheme {
    display: grid;
    grid-template-columns: 12px 56px minmax(0, 1fr);
    align-items: center;
    gap: 12px;
    padding: 8px 12px;
    border: 0;
    border-bottom: 1px solid var(--line);
    background: none;
    color: var(--ink);
    text-align: left;
    cursor: pointer;
  }
  .scheme:last-child {
    border-bottom: 0;
  }
  .scheme:hover {
    background: color-mix(in oklab, var(--ink) 5%, transparent);
  }
  .mark {
    width: 12px;
    height: 12px;
    border: 1px solid var(--line-strong);
  }
  .scheme[aria-checked='true'] .mark {
    border-color: var(--ink);
    background: radial-gradient(var(--ink) 0 3px, transparent 3.5px);
  }
  .swatch {
    display: flex;
    height: 24px;
    border: 1px solid var(--line-strong);
  }
  .swatch i {
    flex: 1;
  }
  .words {
    display: grid;
  }
  .words b {
    font: 600 14px var(--sans);
  }
  .words small {
    color: var(--ink-muted);
    font: 12px var(--sans);
  }
  .picks-head {
    display: flex;
    justify-content: space-between;
    margin-top: 14px;
  }
  .link {
    padding: 0;
    border: 0;
    background: none;
    color: var(--ink-muted);
    font: 12px var(--sans);
    text-decoration: underline;
    text-underline-offset: 3px;
    cursor: pointer;
  }
  .picks {
    display: flex;
    gap: 10px;
  }
  .picks button {
    width: 30px;
    height: 30px;
    padding: 0;
    border: 3px solid transparent;
    background: var(--hex) content-box;
    outline: 1px solid transparent;
    cursor: pointer;
  }
  .picks button[aria-checked='true'] {
    outline-color: var(--ink);
    outline-offset: 0;
  }
  .appearance p {
    margin: 12px 0 0;
    color: var(--ink-muted);
    font: 12px/1.45 var(--sans);
  }
  .address .go {
    color: var(--bad);
  }
</style>
