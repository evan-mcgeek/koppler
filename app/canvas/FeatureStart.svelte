<script lang="ts">
  // A new feature board: the request goes to the agent, which proposes its steps; or it starts from one app.
  import Sparkle from '@lucide/svelte/icons/sparkle';
  import { board } from './board.svelte.ts';
  import { discovered } from './discover.svelte.ts';

  let request = $state(board.feature?.request ?? '');
  let all = $state(false);
  const sent = $derived(!!board.feature?.request);
  const apps = $derived(
    Object.entries(board.facts?.apps ?? {})
      .filter(([, app]) => !app.outside)
      .map(([id, app]) => ({ id, name: app.name, cloned: !!board.app(id)?.cloned }))
      .sort((a, b) => Number(b.cloned) - Number(a.cloned) || a.name.localeCompare(b.name)),
  );
  const shown = $derived(all ? apps : apps.slice(0, 3));
</script>

<div class="start" role="region" aria-labelledby="feature-start-title">
  <header>
    <h2 id="feature-start-title">New feature board</h2>
    <p>Describe what the feature does and the agent proposes the apps and links it uses. You accept each one.</p>
  </header>
  <form
    onsubmit={ev => {
      ev.preventDefault();
      if (request.trim()) void discovered.describe(request);
    }}
  >
    <label for="feature-request">Describe the feature</label>
    <textarea
      id="feature-request"
      rows="4"
      maxlength="4000"
      placeholder="When an order is paid, tell the warehouse and email the customer."
      bind:value={request}
    ></textarea>
    <span class="foot">
      {#if sent}
        <span class="said" role="status">With the agent. Its proposals show here, dashed, for you to accept.</span>
      {:else}
        <span>Paste a ticket or write it in your own words. Names of apps help.</span>
      {/if}
      <button class="primary" type="submit" disabled={!request.trim()}
        ><Sparkle size={14} aria-hidden="true" />{sent ? 'Hand it over again' : 'Hand it to the agent'}</button
      >
    </span>
  </form>
  <div class="from">
    <span class="label">Or start from an app</span>
    <span class="apps">
      {#each shown as app (app.id)}
        <button
          type="button"
          onclick={() => {
            discovered.editFeature({ card: [app.id] });
          }}>{app.name}</button
        >
      {/each}
      {#if !all && apps.length > 3}
        <button
          class="text"
          type="button"
          onclick={() => {
            all = true;
          }}>All apps…</button
        >
      {/if}
    </span>
  </div>
</div>

<style>
  .start {
    position: absolute;
    top: 50%;
    left: 50%;
    width: min(720px, calc(100% - 32px));
    max-height: calc(100% - 32px);
    overflow-y: auto;
    border: 1px solid var(--line-strong);
    background: var(--panel);
    color: var(--ink);
    transform: translate(-50%, -50%);
  }
  header,
  form,
  .from {
    padding: 22px 24px;
  }
  header,
  form {
    border-bottom: 1px solid var(--line);
  }
  h2 {
    margin: 0;
    font: 600 26px var(--display);
  }
  header p {
    margin: 6px 0 0;
    color: var(--ink-muted);
    font: 400 13px/1.5 var(--sans);
  }
  form {
    display: grid;
    gap: 10px;
  }
  label,
  .label {
    font: 600 13px var(--sans);
  }
  textarea {
    box-sizing: border-box;
    width: 100%;
    min-height: 110px;
    padding: 10px 12px;
    border: 1px solid var(--line-strong);
    background: var(--desk);
    color: var(--ink);
    font: 400 14px/1.6 var(--sans);
    resize: vertical;
  }
  textarea:focus-visible {
    border-color: var(--ink);
    outline: 1px solid var(--ink);
  }
  .foot {
    display: flex;
    align-items: center;
    gap: 16px;
    color: var(--ink-muted);
    font: 400 12px/1.5 var(--sans);
  }
  .foot > span {
    flex: 1;
    min-width: 0;
  }
  .said {
    color: var(--ink);
  }
  button.primary {
    display: inline-flex;
    align-items: center;
    gap: 8px;
    padding: 8px 14px;
    border: 0;
    background: var(--local);
    color: var(--desk);
    font: 600 13px var(--sans);
    cursor: pointer;
  }
  button.primary:disabled {
    opacity: 0.45;
    cursor: not-allowed;
  }
  .from {
    display: flex;
    flex-wrap: wrap;
    align-items: center;
    gap: 12px 16px;
  }
  .apps {
    display: flex;
    flex: 1;
    flex-wrap: wrap;
    justify-content: flex-end;
    gap: 8px;
  }
  .apps button {
    padding: 6px 10px;
    border: 1px solid var(--line-strong);
    background: none;
    color: var(--ink);
    font: 400 13px var(--sans);
    cursor: pointer;
  }
  .apps button:hover {
    border-color: var(--ink);
  }
  .apps button.text {
    border: 0;
    text-decoration: underline;
    text-underline-offset: 3px;
  }
  button:focus-visible {
    outline: 2px solid var(--ink);
    outline-offset: 2px;
  }
</style>
