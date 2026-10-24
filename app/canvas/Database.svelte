<script lang="ts">
  import Laptop from '@lucide/svelte/icons/laptop';
  import { tick } from 'svelte';
  import type { NodeProps } from '@xyflow/svelte';
  import Icon from './Icon.svelte';
  import InfraCard from './InfraCard.svelte';
  import { board, type DatabaseNode } from './board.svelte.ts';
  import { dialogs } from './dialogs.svelte.ts';
  import { live } from './live.svelte.ts';
  import { post } from './data.ts';
  import { toasts } from './toast.svelte.ts';
  import { addressText, localDatabases } from './local-databases.svelte.ts';

  const { id, data, selected }: NodeProps<DatabaseNode> = $props();
  const env = $derived(board.env.toUpperCase());
  const kind = $derived(data.kind ? data.kind.charAt(0) + data.kind.slice(1).toLowerCase() : 'database');
  const at = $derived(localDatabases.addresses[data.database]);
  const answer = $derived(localDatabases.answers[data.database]);
  const port = $derived(data.through.split(':').at(-1) ?? '');
  const tunnel = $derived(data.through ? live.tunnel(port, data.apps) : undefined);
  const prod = $derived(board.protected && !data.local);
  void localDatabases.load().then(() => {
    if (data.local) void localDatabases.test(data.database);
  });

  // The form asks where the local one runs, the first time and on Change address; the guard asks before PROD data.
  let asking = $state(false);
  let guarding = $state(false);
  let host = $state('localhost');
  let portText = $state('');
  let name = $state('');
  let problem = $state('');
  let tested = $state<boolean | null>(null);
  const ask = () => {
    host = at?.host ?? 'localhost';
    portText = at ? String(at.port) : '';
    name = at?.database ?? '';
    problem = '';
    tested = null;
    asking = true;
    // Its form opens under the card: brought into view once drawn, so its buttons are never under the toolbar.
    void tick().then(() => {
      board.show(id);
    });
  };
  const typed = () => ({ host: host.trim(), port: Number(portText), ...(name.trim() && { database: name.trim() }) });
  const test = async () => {
    const said = await localDatabases.test(data.database, typed());
    if (typeof said === 'string') problem = said;
    else tested = said;
  };
  const useLocal = async () => {
    const refused = await localDatabases.keep(data.database, typed());
    if (refused) {
      problem = refused;
      return;
    }
    asking = false;
    board.setDatabase(data.database, true);
    void localDatabases.test(data.database);
  };
  // While it asks, the switch stays where it was.
  const pick = (ev: Event, local: boolean) => {
    if (local === data.local) return;
    if ((local && !at) || (!local && board.protected))
      for (const input of (ev.currentTarget as HTMLElement).closest('.seg')?.querySelectorAll('input') ?? [])
        input.checked = (input.value === 'local') === data.local;
    if (local && !at) ask();
    else if (local) {
      board.setDatabase(data.database, true);
      void localDatabases.test(data.database);
    } else if (board.protected) guarding = true;
    else board.setDatabase(data.database, false);
  };
  const reconnect = async () => {
    const done = await post<{ ok: true }>('restart-tunnel', { port: Number(port) });
    if ('error' in done) toasts.show(done.error, 'warning');
    else toasts.show(`The tunnel to ${data.name} started again.`);
  };
  const users = $derived(data.apps.map(app => board.nameOf(app)).join(' and '));
  /** The state line: a light and words, then what to do. */
  const line = $derived.by((): { light: string; said: string; then: string; act?: [string, () => void] } => {
    if (data.local) {
      if (!at) return { light: 'absent', said: 'No address yet', then: 'Switch to Local to say where it runs.' };
      if (answer === 'testing') return { light: 'starting', said: 'Testing…', then: `On ${addressText(at)}` };
      if (answer === false)
        return {
          light: 'failed',
          said: 'Local not answering',
          then: `Nothing on ${at.host}:${String(at.port)}. Start your local ${kind}, or switch to Deployed.`,
          act: ['Test again', () => void localDatabases.test(data.database)],
        };
      return {
        light: answer ? 'running' : 'absent',
        said: answer ? 'Reachable' : 'Not tested yet',
        then: answer ? 'On this Mac, tested just now' : `Used by ${users}`,
        act: ['Change address', ask],
      };
    }
    if (prod) return { light: 'user', said: 'Asks before each run', then: 'Real customer data' };
    if (!data.through) return { light: 'absent', said: 'No tunnel', then: `The stack names no ${env} tunnel for it.` };
    if (tunnel === false)
      return {
        light: 'failed',
        said: 'Tunnel down',
        then: 'Comes back when the tunnel reconnects.',
        act: ['Reconnect tunnel', () => void reconnect()],
      };
    if (tunnel) return { light: 'running', said: 'Reachable', then: 'Through the tunnel' };
    return { light: 'absent', said: 'Not open yet', then: 'Its tunnel opens first when the board runs.' };
  });
</script>

<InfraCard
  {id}
  kind="database"
  variant={[data.local && 'local', prod && 'prod'].filter(Boolean).join(' ')}
  name={data.name}
  tag={data.kind || 'Database'}
  title={data.name}
  {selected}
  actions={[
    {
      label: `Settings for ${data.name}`,
      title: 'Settings: its name, and its tunnel and hosts entry on each environment',
      icon: 'cog',
      run: () => void dialogs.settings?.open({ title: data.name, path: `databases.${data.database}` }),
    },
  ]}
>
  {#snippet band()}
    {#if prod}<span class="band">PROD DATABASE</span>{/if}
  {/snippet}
  <span class="choice">
    <span class="seg nodrag" role="radiogroup" aria-label="Which {data.name} its apps use">
      <label title="The {env} database, through its tunnel">
        <input
          type="radio"
          name="database-{data.database}"
          value="deployed"
          checked={!data.local}
          onchange={ev => {
            pick(ev, false);
          }}
        />Deployed
      </label>
      <label title="Your own {kind} on this Mac">
        <input
          type="radio"
          name="database-{data.database}"
          value="local"
          checked={data.local}
          onchange={ev => {
            pick(ev, true);
          }}
        />Local
      </label>
    </span>
    {#if !data.local}<span class="env" class:prod>{env}</span>{/if}
  </span>
  {#if data.local}
    <span class="mac"><Icon of={Laptop} size={14} />On this Mac</span>
    {#if at}<span class="address">{addressText(at)}</span>{/if}
  {:else if data.through}
    <span class="via">Through {data.tunnel}</span>
    <span class="address deployed">{data.through}</span>
  {/if}
  {#snippet foot()}
    <span class="state"
      ><span class="led" data-state={line.light}></span><b>{line.said}</b>{#if line.act}<button
          class="link nodrag"
          type="button"
          onclick={line.act[1]}>{line.act[0]}</button
        >{/if}</span
    >
    <span class="then">{line.then}</span>
  {/snippet}
</InfraCard>
{#if asking}
  <form
    class="ask nodrag nopan nowheel"
    aria-label="Where your local {data.name} runs"
    onsubmit={ev => {
      ev.preventDefault();
      void useLocal();
    }}
  >
    <header>
      <b>Where does your local {data.name} database run?</b>
      <span>Asked once. Kept on this Mac only, never shared with the stack.</span>
    </header>
    <div class="fields">
      <label>Host<input class="mono" bind:value={host} autocomplete="off" spellcheck="false" /></label>
      <label>Port<input class="mono" bind:value={portText} inputmode="numeric" autocomplete="off" /></label>
      <label class="wide"
        >Database name<input class="mono" bind:value={name} autocomplete="off" spellcheck="false" /></label
      >
    </div>
    {#if problem || tested !== null}<p class="said" class:bad={!!problem || tested === false}>
        {problem ||
          (tested
            ? `${host}:${portText} answers.`
            : `Nothing answers on ${host}:${portText}. Is your ${kind} running?`)}
      </p>{/if}
    <footer>
      <button class="link" type="button" onclick={() => void test()}>Test connection</button>
      <span></span>
      <button class="text" type="button" onclick={() => (asking = false)}>Cancel</button>
      <button class="text go" type="submit">Use local</button>
    </footer>
  </form>
{/if}
{#if guarding}
  <div class="ask guard nodrag nopan" role="alertdialog" aria-label="Use the PROD {data.name} database?">
    <header>
      <b>Use the PROD {data.name} database?</b>
      <span>{users} will read and write real customer data. Koppler asks again before every run.</span>
    </header>
    <footer>
      <span></span>
      <button class="text" type="button" onclick={() => (guarding = false)}>Keep Local</button>
      <button
        class="text danger"
        type="button"
        onclick={() => {
          guarding = false;
          board.setDatabase(data.database, false);
        }}>Use PROD database</button
      >
    </footer>
  </div>
{/if}

<style>
  .band {
    display: flex;
    align-items: center;
    height: 22px;
    padding: 0 10px;
    background: var(--prod-stripes);
    color: var(--on-prod);
    font: 700 10px var(--mono);
    letter-spacing: 0.08em;
  }
  .choice {
    display: flex;
    align-items: center;
    gap: 8px;
  }
  .seg label {
    padding: 4px 10px;
    font-size: 12px;
  }
  .env {
    padding: 2px 5px;
    border: 1px dashed var(--deployed);
    color: var(--deployed);
    font: 500 10px var(--mono);
    letter-spacing: 0.06em;
  }
  .env.prod {
    border: 1px solid var(--prod);
    color: var(--prod);
  }
  .via {
    color: var(--ink-muted);
  }
  .mac {
    display: flex;
    align-items: center;
    gap: 6px;
    font-weight: 600;
  }
  .address {
    overflow: hidden;
    font: 11px var(--mono);
    text-overflow: ellipsis;
    white-space: nowrap;
  }
  .address.deployed {
    color: var(--deployed);
  }
  .state {
    display: flex;
    align-items: center;
    gap: 8px;
  }
  .state b {
    flex: 1;
    font-weight: 600;
  }
  .then {
    color: var(--ink-muted);
  }
  .ask {
    position: absolute;
    top: 0;
    left: calc(100% + 12px);
    display: grid;
    width: 340px;
    border: 1px solid var(--ink);
    background: var(--panel);
    color: var(--ink);
    font: 13px/1.45 var(--sans);
    cursor: default;
  }
  .ask header {
    display: grid;
    gap: 6px;
    padding: 16px 16px 12px;
    border-bottom: 1px solid var(--line);
  }
  .ask header b {
    font: 600 16px var(--sans);
  }
  .ask header span {
    color: var(--ink-muted);
  }
  .fields {
    display: grid;
    grid-template-columns: minmax(0, 1fr) 90px;
    gap: 12px;
    padding: 14px 16px;
  }
  .fields label {
    display: grid;
    gap: 4px;
    color: var(--ink-muted);
    font-size: 12px;
  }
  .fields .wide {
    grid-column: 1 / -1;
  }
  .fields input {
    box-sizing: border-box;
    width: 100%;
    min-width: 0;
    padding: 7px 9px;
    border: 1px solid var(--line-strong);
    background: var(--desk);
    color: var(--ink);
    font: 12px var(--mono);
  }
  .said {
    margin: 0;
    padding: 0 16px 12px;
    color: var(--ok);
    font-size: 12px;
  }
  .said.bad {
    color: var(--warn);
  }
  .ask footer {
    display: flex;
    align-items: center;
    gap: 10px;
    padding: 12px 16px;
    border-top: 1px solid var(--line);
  }
  .ask footer span {
    flex: 1;
  }
  .ask .text {
    padding: 8px 16px;
    border: 1px solid var(--line-strong);
    background: none;
    color: var(--ink);
    font: 600 13px var(--sans);
    cursor: pointer;
  }
  .ask .go {
    border-color: var(--local);
    background: var(--local);
    color: var(--desk);
  }
  .ask .danger {
    border-color: var(--prod);
    color: var(--prod);
  }
  .guard {
    width: 320px;
  }
</style>
