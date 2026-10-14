<script lang="ts">
  import Info from '@lucide/svelte/icons/info';
  import Icon from './Icon.svelte';
  import KeyRound from '@lucide/svelte/icons/key-round';
  import Lock from '@lucide/svelte/icons/lock';
  import X from '@lucide/svelte/icons/x';
  // Credentials: what the apps on the board need stored for this environment. The page can set, test and remove a
  // value, never read one.
  import Command from './Command.svelte';
  import { SvelteMap } from 'svelte/reactivity';
  import { board } from './board.svelte.ts';
  import { post } from './data.ts';
  import { live } from './live.svelte.ts';

  type Credential = NonNullable<
    NonNullable<NonNullable<NonNullable<typeof live.status>['secrets']>[string]>[string]
  >[number];
  /** What is known of one credential on this page: its open parts, the last test, and a change not yet in the status. */
  interface Row {
    form?: boolean;
    info?: boolean;
    command?: boolean;
    message?: string;
    ok?: boolean;
    tested?: boolean;
    stored?: boolean;
    until?: number;
  }
  const WORDS = { missing: 'Missing', stored: 'Stored', ok: 'Works', failed: 'Does not work' } as const;
  const id = $props.id();
  let opener = $state<HTMLButtonElement>();
  let pop = $state<HTMLDivElement>();
  let open = $state(false);
  const rows = new SvelteMap<string, Row>();
  const env = $derived(board.env.toUpperCase());
  const key = (app: string, name: string) => `${app}|${board.env}|${name}`;
  const row = (app: string, name: string) => rows.get(key(app, name)) ?? {};
  const put = (app: string, name: string, change: Row) => rows.set(key(app, name), { ...row(app, name), ...change });
  /** What was just set or removed here wins over a status taken a moment earlier. */
  const stored = (app: string, one: Credential) => {
    const mine = row(app, one.name);
    return mine.until && mine.until > Date.now() ? !!mine.stored : !!one.stored;
  };
  const apps = $derived(
    board.cards
      .map(node => ({ id: node.id, name: node.data.name, list: live.status?.secrets?.[node.id]?.[board.env] ?? [] }))
      .filter(app => app.list.length),
  );
  const always = (one: Credential) => !one.when || /^always\b/i.test(one.when.trim());
  const missing = $derived(apps.flatMap(app => app.list.filter(one => !stored(app.id, one) && always(one))).length);
  const standing = (app: string, one: Credential) => {
    const mine = row(app, one.name);
    return !stored(app, one) ? 'missing' : mine.tested ? (mine.ok ? 'ok' : 'failed') : 'stored';
  };
  /** "A → B → C" as steps. */
  const steps = (text: string) =>
    text
      .split(/\s*(?:→|->|=>)\s*/)
      .map(step => step.trim())
      .filter(Boolean);
  const place = () => {
    const at = opener?.getBoundingClientRect();
    if (!at || !pop) return;
    pop.style.top = `${String(at.bottom + 6)}px`;
    pop.style.right = `${String(Math.max(12, innerWidth - at.right))}px`;
  };
  const save = async (ev: SubmitEvent, app: string, name: string) => {
    ev.preventDefault();
    const input = (ev.currentTarget as HTMLFormElement).querySelector('input');
    if (!input?.value.trim()) return;
    const said = await post('secret', { app, env: board.env, name, value: input.value });
    input.value = '';
    const error = 'error' in said ? said.error : '';
    put(app, name, { form: !!error, tested: false, ok: !error, message: error });
    if (!error) put(app, name, { stored: true, until: Date.now() + 8000 });
  };
  const test = async (app: string, name: string) => {
    put(app, name, { message: 'Testing…', tested: false });
    const said = await post<{ ok?: boolean; message?: string }>('secret-test', { app, env: board.env, name });
    if ('error' in said) {
      put(app, name, { message: said.error, ok: false });
      return;
    }
    const cannot = /^cannot test/.test(said.message ?? '');
    const why = (said.message ?? '').replace(/^failed: /, '').replace(/^cannot test: /, 'Cannot be tested: ');
    put(app, name, {
      tested: !cannot,
      ok: !!said.ok,
      message: said.ok ? '' : why.replace(/^./, first => first.toUpperCase()),
    });
  };
  const remove = async (app: string, name: string) => {
    const said = await post('secret-remove', { app, env: board.env, name });
    const error = 'error' in said ? said.error : '';
    put(app, name, { tested: false, ok: !error, message: error });
    if (!error) put(app, name, { stored: false, until: Date.now() + 8000 });
  };
</script>

<button
  bind:this={opener}
  class="open"
  class:missing={missing > 0}
  type="button"
  aria-label="Credentials"
  aria-haspopup="dialog"
  aria-expanded={open}
  title={missing
    ? `${String(missing)} ${missing === 1 ? 'credential is' : 'credentials are'} missing for the apps on the board (${env})`
    : 'What the apps on the board need stored'}
  popovertarget={id}
>
  <Icon of={KeyRound} size={16} />
</button>
<div
  bind:this={pop}
  {id}
  class="pop"
  popover
  role="dialog"
  tabindex="-1"
  aria-label="Credentials"
  data-secret
  ontoggle={ev => {
    open = ev.newState === 'open';
    if (open) place();
  }}
>
  {#each apps as app (app.id)}
    <section>
      <h3>{app.name} on {env}</h3>
      {#each app.list as one (one.name)}
        {@const mine = row(app.id, one.name)}
        {@const has = stored(app.id, one)}
        {@const now = standing(app.id, one)}
        <div class="cred">
          <div class="head">
            <code title={one.name}>{one.name}</code>
            {#if one.when || one.fetchUi}
              <button
                class="i"
                type="button"
                aria-expanded={!!mine.info}
                aria-label="When {one.name} is needed and where to get it"
                title="{always(one) ? '' : 'Only needed in some setups. '}When it is needed and where to get it"
                onclick={() => put(app.id, one.name, { info: !mine.info })}><Icon of={Info} size={14} /></button
              >
            {/if}
            <span class="state" data-state={now}>{WORDS[now]}</span>
          </div>
          {#if mine.message}<p class="result" data-ok={mine.ok}>{mine.message}</p>{/if}
          {#if mine.form}
            <form onsubmit={ev => void save(ev, app.id, one.name)}>
              <!-- svelte-ignore a11y_autofocus -->
              <input
                type="password"
                aria-label="Value for {one.name}"
                placeholder="Paste the value, Enter to save"
                autocomplete="off"
                spellcheck="false"
                autofocus
                onkeydown={ev => {
                  if (ev.key !== 'Escape') return;
                  // Escape leaves the paste field first; the panel stays.
                  ev.preventDefault();
                  put(app.id, one.name, { form: false });
                }}
              />
              <button class="go" type="submit">Save</button>
              <button type="button" aria-label="Cancel" onclick={() => put(app.id, one.name, { form: false })}
                ><Icon of={X} size={14} /></button
              >
            </form>
          {:else}
            <div class="acts">
              <button type="button" onclick={() => put(app.id, one.name, { form: true })}
                >{has ? 'Replace' : 'Set'}</button
              >
              {#if has}
                <button type="button" onclick={() => void test(app.id, one.name)}>Test</button>
                <button type="button" onclick={() => void remove(app.id, one.name)}>Remove</button>
              {:else if one.fetchCli}
                <button
                  type="button"
                  aria-expanded={!!mine.command}
                  title="A command for your own terminal that fetches and stores it without showing it"
                  onclick={() => put(app.id, one.name, { command: !mine.command })}
                  >{mine.command ? 'Hide fetch command' : 'Show fetch command'}</button
                >
              {/if}
            </div>
            {#if !has && !one.fetchCli && !one.fetchUi}
              <p class="nohow">
                The stack says nothing about where to get it on {env}. Ask whoever owns {app.name}, or ask the agent to
                find it in the repo and add the steps to the stack.
              </p>
            {/if}
            {#if mine.command && one.fetchCli && !has}
              <div class="cmd">
                <p>
                  This command comes from the stack file, so read it before you run it, in your own terminal. It should
                  fetch the value and store it without showing it.
                </p>
                <Command command={one.fetchCli} />
              </div>
            {/if}
          {/if}
          {#if mine.info}
            <dl>
              {#if one.when}
                <dt>When</dt>
                <dd>{one.when}</dd>
              {/if}
              {#if one.fetchUi}
                <dt>Where</dt>
                <dd>
                  {#if steps(one.fetchUi).length > 1}
                    <ol>
                      {#each steps(one.fetchUi) as step (step)}<li>{step}</li>{/each}
                    </ol>
                  {:else}{one.fetchUi}{/if}
                </dd>
              {/if}
            </dl>
          {/if}
        </div>
      {/each}
    </section>
  {:else}
    <p class="none">No app on the board needs a stored credential on {env}.</p>
  {/each}
  <p class="lock">
    <Icon of={Lock} size={13} />
    Kept in your Mac's Keychain. Nobody sees them again.
  </p>
</div>

<style>
  .open {
    position: relative;
    display: grid;
    place-items: center;
    width: 32px;
    height: 32px;
    padding: 0;
    border: 1px solid transparent;
    border-radius: 8px;
    background: none;
    color: var(--muted);
    cursor: pointer;
  }
  .open:hover,
  .open[aria-expanded='true'] {
    border-color: var(--line);
    color: var(--ink);
  }
  .open.missing::after {
    content: '';
    position: absolute;
    top: 5px;
    right: 5px;
    width: 7px;
    height: 7px;
    border-radius: 50%;
    background: var(--warn);
  }
  .pop {
    position: fixed;
    inset: auto;
    width: min(400px, calc(100vw - 24px));
    max-height: min(620px, calc(100vh - 100px));
    margin: 0;
    padding: 14px 16px;
    overflow-y: auto;
    border: 1px solid var(--line);
    border-radius: 12px;
    background: var(--surface);
    color: var(--ink);
    box-shadow: var(--lift);
    font: 13px/1.45 var(--sans);
  }
  section + section {
    margin-top: 14px;
    padding-top: 12px;
    border-top: 1px solid var(--line);
  }
  h3 {
    margin: 0 0 8px;
    font-size: 13px;
  }
  .cred {
    display: grid;
    gap: 6px;
    padding: 8px 0;
  }
  .cred + .cred {
    border-top: 1px dashed var(--line);
  }
  .head {
    display: flex;
    align-items: center;
    gap: 8px;
  }
  .head code {
    flex: 1;
    min-width: 0;
    overflow: hidden;
    font: 12px var(--mono);
    text-overflow: ellipsis;
    white-space: nowrap;
  }
  .state {
    flex: none;
    font-weight: 600;
    font-size: 12px;
  }
  .state[data-state='missing'] {
    color: var(--warn);
  }
  .state[data-state='stored'] {
    color: var(--muted);
  }
  .state[data-state='ok'] {
    color: var(--ok);
  }
  .state[data-state='failed'] {
    color: var(--bad);
  }
  .i {
    flex: none;
    width: 18px;
    height: 18px;
    padding: 0;
    display: grid;
    place-items: center;
    border: 0;
    border-radius: 50%;
    background: none;
    color: var(--muted);
    cursor: pointer;
  }
  .result,
  .nohow,
  .cmd p,
  .none,
  .lock {
    margin: 0;
    color: var(--muted);
    font-size: 12px;
  }
  .result[data-ok='false'] {
    color: var(--bad);
  }
  .acts,
  form {
    display: flex;
    flex-wrap: wrap;
    gap: 6px;
  }
  .acts button,
  form button {
    padding: 4px 10px;
    border: 1px solid var(--line);
    border-radius: 6px;
    background: none;
    color: var(--ink);
    font: 600 12px var(--sans);
    cursor: pointer;
  }
  form .go {
    border-color: transparent;
    background: var(--cable);
    color: var(--on-accent);
  }
  input {
    flex: 1;
    min-width: 0;
    height: 28px;
    padding: 0 8px;
    border: 1px solid var(--line);
    border-radius: 6px;
    background: var(--paper);
    color: var(--ink);
    font: 13px var(--sans);
  }
  .cmd {
    display: grid;
    gap: 6px;
  }
  dl {
    display: grid;
    grid-template-columns: auto minmax(0, 1fr);
    gap: 4px 10px;
    margin: 0;
    font-size: 12px;
  }
  dt {
    color: var(--muted);
    font-weight: 600;
  }
  dd {
    margin: 0;
  }
  ol {
    margin: 0;
    padding-left: 18px;
  }
  .lock {
    display: flex;
    align-items: center;
    gap: 6px;
    margin-top: 12px;
    padding-top: 10px;
    border-top: 1px solid var(--line);
  }
</style>
