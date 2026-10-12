<script lang="ts">
  // Setting Koppler up with a stack: one the team shares (found on this machine, or from a link on GitHub), or a new
  // one. One choice at a time.
  import { board } from './board.svelte.ts';
  import { post } from './data.ts';

  type Pane = 'start' | 'join' | 'new';
  let dialog = $state<HTMLDialogElement>();
  let pane = $state<Pane>('start');
  let error = $state('');
  let busy = $state(false);
  let link = $state('');
  let name = $state('');
  let typed = $state('');
  let envs = $state<string[]>([]);
  const stacks = $derived(board.known);

  export function open(at: Pane = 'start'): void {
    go(at);
    link = name = typed = '';
    envs = [];
    dialog?.showModal();
  }
  const go = (to: Pane) => {
    pane = to;
    error = '';
  };
  /** Any of the three ways in ends the same: the stack is in use, and the page opens again with it. */
  const use = async (asked: object) => {
    busy = true;
    error = '';
    const said = await post('stack', asked);
    busy = false;
    if ('error' in said) error = said.error;
    else location.reload();
  };
  // Environments are added one at a time: Enter, a comma or a space adds what is typed, Backspace on an empty field
  // removes the last.
  const add = (text: string): boolean => {
    for (const raw of text.split(/[\s,]+/).filter(Boolean)) {
      const env = raw.toLowerCase();
      if (!/^[a-z0-9-]{1,16}$/.test(env)) {
        error = `"${raw}" will not work as a name: use lowercase letters, digits and dashes, e.g. qa.`;
        return false;
      }
      if (envs.length >= 8) {
        error = 'Eight environments is the most a stack can have.';
        return false;
      }
      if (!envs.includes(env)) envs = [...envs, env];
    }
    error = '';
    typed = '';
    return true;
  };
  const typing = (ev: KeyboardEvent) => {
    if (['Enter', ',', ' ', 'Tab'].includes(ev.key) && typed.trim()) {
      ev.preventDefault();
      add(typed);
    } else if (ev.key === 'Backspace' && !typed && envs.length) envs = envs.slice(0, -1);
  };
  const create = (ev: SubmitEvent) => {
    ev.preventDefault();
    if (typed.trim() && !add(typed)) return;
    void use({ name, envs });
  };
</script>

<dialog
  bind:this={dialog}
  aria-labelledby="setup-title"
  oncancel={ev => {
    // Escape steps back to the first choice; from there it closes only when there is a stack to go back to.
    if (pane !== 'start') {
      ev.preventDefault();
      go('start');
    } else if (board.setup) ev.preventDefault();
  }}
>
  {#if pane === 'start'}
    {#if !board.setup}<button class="x" type="button" aria-label="Close" onclick={() => dialog?.close()}>×</button>{/if}
    <h2 id="setup-title">Set up Koppler</h2>
    <p class="sub">
      Koppler runs the apps you pick on this Mac and connects them to each other. Everything else keeps calling the
      deployed environment.
    </p>
    <ol class="concept" aria-label="How it fits together">
      <li><strong>Stack</strong><span>Every app you might run. Added once.</span></li>
      <li>
        <strong>Board</strong><span
          >The few you run now, wired together. Saved as you go; keep as many as you like.</span
        >
      </li>
    </ol>
    <div class="choices">
      <button
        type="button"
        onclick={() => {
          go('join');
        }}
      >
        <strong>Use a shared stack</strong>
        <span
          >{stacks.length
            ? `${String(stacks.length)} found on this Mac, or one from a link on GitHub.`
            : 'From a link on GitHub, set up by your team.'}</span
        >
      </button>
      <button
        type="button"
        onclick={() => {
          go('new');
        }}
      >
        <strong>Start a new stack</strong><span>Name it, then pick your repos.</span>
      </button>
    </div>
  {:else if pane === 'join'}
    <button
      class="back"
      type="button"
      onclick={() => {
        go('start');
      }}>Back</button
    >
    <h2 id="setup-title">Use a shared stack</h2>
    <p class="sub">
      {stacks.length
        ? 'Found on this Mac, or paste a link to one on GitHub. Koppler never changes the original.'
        : 'Paste a link to its stack.json on GitHub. Koppler keeps a copy here and never changes the original.'}
    </p>
    {#each stacks as stack (stack.dir)}
      <div class="stack">
        <span>
          <strong>{stack.name}</strong>
          <span class="about"
            >{stack.linked ? 'from GitHub' : stack.shared ? 'shared' : 'private'}, {stack.apps}
            {stack.apps === 1 ? 'app' : 'apps'}, {stack.envs.join(' / ')}</span
          >
          <small title={stack.path}>{stack.path}</small>
        </span>
        <button type="button" disabled={busy} aria-label="Use {stack.name}" onclick={() => void use({ use: stack.dir })}
          >Use</button
        >
      </div>
    {/each}
    <form
      class="link"
      onsubmit={ev => {
        ev.preventDefault();
        if (link.trim()) void use({ link: link.trim() });
      }}
    >
      <input
        type="text"
        inputmode="url"
        placeholder="Link to a stack.json on GitHub"
        aria-label="Link to a shared stack on GitHub"
        autocomplete="off"
        spellcheck="false"
        bind:value={link}
      />
      <button class="go" type="submit" disabled={busy || !link.trim()}>Use</button>
    </form>
  {:else}
    <button
      class="back"
      type="button"
      onclick={() => {
        go('start');
      }}>Back</button
    >
    <h2 id="setup-title">Start a new stack</h2>
    <p class="sub">It stays private on this Mac until you choose to share it.</p>
    <form class="new" onsubmit={create}>
      <label>
        Name
        <input
          maxlength="60"
          placeholder="e.g. Orders platform"
          autocomplete="off"
          spellcheck="false"
          bind:value={name}
        />
      </label>
      <label>
        Environments
        <span class="tags">
          {#each envs as env, index (env)}
            <span class="tag">
              {env}{#if index === 0 && envs.length > 1}<small>default</small>{/if}
              <button type="button" aria-label="Remove {env}" onclick={() => (envs = envs.filter(one => one !== env))}
                >×</button
              >
            </span>
          {/each}
          <input
            placeholder={envs.length ? 'Add another' : 'Type one, e.g. qa, and press Enter'}
            autocomplete="off"
            spellcheck="false"
            autocapitalize="off"
            maxlength="16"
            bind:value={typed}
            onkeydown={typing}
            onblur={() => {
              if (typed.trim()) add(typed);
            }}
          />
        </span>
        <small>Where your apps are deployed, e.g. qa and prod. The first one is the default.</small>
      </label>
      <button class="go" type="submit" disabled={busy}>Create and add repos</button>
    </form>
  {/if}
  <p class="error" role="alert">{error}</p>
</dialog>

<style>
  dialog {
    width: min(520px, calc(100vw - 32px));
    padding: 22px;
    border: 1px solid var(--line);
    border-radius: 14px;
    background: var(--surface);
    color: var(--ink);
    box-shadow: var(--lift-high);
    font: 13px/1.45 var(--sans);
  }
  dialog::backdrop {
    background: color-mix(in oklab, var(--desk) 70%, transparent);
  }
  h2 {
    margin: 0 28px 6px 0;
    font-size: 18px;
  }
  .sub {
    margin: 0 0 14px;
    color: var(--muted);
  }
  .x {
    position: absolute;
    top: 12px;
    right: 12px;
    width: 28px;
    height: 28px;
    border: 0;
    border-radius: 7px;
    background: none;
    color: var(--muted);
    font-size: 18px;
    cursor: pointer;
  }
  .back {
    margin: 0 0 8px -6px;
    padding: 2px 6px;
    border: 0;
    background: none;
    color: var(--cable-ink);
    font: 600 12.5px var(--sans);
    cursor: pointer;
  }
  .concept {
    display: grid;
    grid-template-columns: 1fr 1fr;
    gap: 10px;
    margin: 0 0 16px;
    padding: 0;
    list-style: none;
  }
  .concept li {
    display: grid;
    align-content: start;
    gap: 2px;
    padding: 10px 12px;
    border: 1px solid var(--line);
    border-radius: 10px;
    background: var(--panel);
  }
  .concept span,
  .choices span,
  small,
  .about {
    color: var(--muted);
    font-size: 12px;
  }
  .choices {
    display: grid;
    gap: 8px;
  }
  .choices button {
    display: grid;
    gap: 2px;
    padding: 12px 14px;
    border: 1px solid var(--line);
    border-radius: 10px;
    background: var(--paper);
    color: var(--ink);
    font: inherit;
    text-align: left;
    cursor: pointer;
  }
  .choices button:hover,
  .choices button:focus-visible {
    border-color: var(--cable);
    outline: none;
  }
  .choices strong {
    font-size: 14px;
  }
  .stack {
    display: flex;
    align-items: center;
    gap: 10px;
    padding: 10px 0;
    border-top: 1px solid var(--line);
  }
  .stack > span {
    display: grid;
    flex: 1;
    min-width: 0;
    gap: 1px;
  }
  .stack small {
    overflow: hidden;
    font-family: var(--mono);
    text-overflow: ellipsis;
    white-space: nowrap;
  }
  .stack button,
  .go {
    flex: none;
    padding: 6px 14px;
    border: 1px solid var(--line);
    border-radius: 8px;
    background: none;
    color: var(--ink);
    font: 600 13px var(--sans);
    cursor: pointer;
  }
  .go {
    border-color: transparent;
    background: var(--cable);
    color: var(--on-accent);
  }
  button:disabled {
    opacity: 0.55;
    cursor: not-allowed;
  }
  .link {
    display: flex;
    gap: 8px;
    padding-top: 12px;
    border-top: 1px solid var(--line);
  }
  input {
    flex: 1;
    min-width: 0;
    height: 32px;
    padding: 0 10px;
    border: 1px solid var(--line);
    border-radius: 7px;
    background: var(--paper);
    color: var(--ink);
    font: 13px var(--sans);
  }
  .new {
    display: grid;
    gap: 14px;
  }
  .new label {
    display: grid;
    gap: 4px;
    font-weight: 600;
  }
  .new small {
    font-weight: 400;
  }
  .new .go {
    justify-self: end;
  }
  .tags {
    display: flex;
    flex-wrap: wrap;
    align-items: center;
    gap: 6px;
    min-height: 32px;
    padding: 3px 6px;
    border: 1px solid var(--line);
    border-radius: 7px;
    background: var(--paper);
    font-weight: 400;
  }
  .tags input {
    min-width: 120px;
    height: 24px;
    padding: 0 4px;
    border: 0;
    background: none;
  }
  .tag {
    display: inline-flex;
    align-items: center;
    gap: 5px;
    padding: 1px 4px 1px 8px;
    border-radius: 999px;
    background: color-mix(in oklab, var(--ink) 9%, transparent);
    font: 600 12px/1.6 var(--mono);
  }
  .tag small {
    font-family: var(--sans);
  }
  .tag button {
    padding: 0 4px;
    border: 0;
    background: none;
    color: var(--muted);
    font-size: 14px;
    line-height: 1;
    cursor: pointer;
  }
  .error {
    min-height: 1.45em;
    margin: 10px 0 0;
    color: var(--bad);
  }
</style>
