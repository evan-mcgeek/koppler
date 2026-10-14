<script lang="ts">
  // What the stack needs on this machine and does not have: missing programs with how to install them, the stack's
  // own checks that wait for approval, and facts the stack lacks for an environment. Shown only when there is
  // something to do.
  import Command from './Command.svelte';
  import { board } from './board.svelte.ts';
  import { live } from './live.svelte.ts';
  import { runs } from './run.svelte.ts';

  type Check = NonNullable<NonNullable<typeof live.status>['checks']>[number];
  const id = $props.id();
  let open = $state<HTMLButtonElement>();
  let pop = $state<HTMLDivElement>();
  let asked = $state<string[]>([]);
  const all = $derived((live.status?.checks ?? []).filter(check => check.state !== 'ok'));
  const todo = $derived(all.filter(check => check.state !== 'gap'));
  const gaps = $derived(all.filter(check => check.state === 'gap'));
  const envs = $derived([...new Set(gaps.map(gap => gap.env ?? ''))]);
  const several = (count: number, one: string, many: string) => `${String(count)} ${count === 1 ? one : many}`;
  const label = $derived.by(() => {
    const missing = todo.filter(check => check.state === 'missing').length;
    const pending = todo.length - missing;
    return [
      missing && `${String(missing)} missing on this Mac`,
      pending && `${several(pending, 'check waits', 'checks wait')} for your approval`,
      gaps.length &&
        `${String(gaps.length)} ${envs.map(env => env.toUpperCase()).join(' and ')} ${gaps.length === 1 ? 'fact' : 'facts'} missing from the stack`,
    ]
      .filter(Boolean)
      .join(', ');
  });
  /** What to run for a check, when it is a command. */
  const command = (check: Check) =>
    check.state === 'pending'
      ? 'koppler doctor --approve'
      : /^(brew|npm|xcode-select|nvm|pip|curl) /.test(check.detail ?? '')
        ? (check.detail ?? null)
        : null;
  const needed = (check: Check) => (check.for?.length ? `needed by ${check.for.join(', ')}` : '');
  const about = (check: Check) =>
    check.state === 'pending'
      ? 'A check written into this stack. It is a command, so it runs only after you have seen it. In your own terminal:'
      : command(check)
        ? `Missing${needed(check) ? `, ${needed(check)}` : ''}. Install it with:`
        : `${check.detail ?? ''}${needed(check) ? ` (${needed(check)})` : ''}`;
  const appName = board.nameOf;
  const appsIn = (env: string) => [...new Set(gaps.filter(gap => gap.env === env).map(gap => gap.app ?? ''))];
  const gapsOf = (env: string, app?: string) => gaps.filter(gap => gap.env === env && (!app || gap.app === app));
  /** A gap without the app's name, which its heading already says. */
  const gapLine = (gap: Check) =>
    (gap.detail ?? '')
      .replace(`for ${appName(gap.app ?? '')}'s `, 'for its ')
      .replace(` for ${appName(gap.app ?? '')}`, '');
  const ask = async (env: string, app?: string) => {
    const sent = await runs.askFacts(
      env,
      gapsOf(env, app).map(gap => gap.detail ?? ''),
    );
    if (sent) asked = [...asked, `${env}|${app ?? ''}`];
  };
  const place = () => {
    const at = open?.getBoundingClientRect();
    if (!at || !pop) return;
    pop.style.left = `${String(Math.max(12, at.left))}px`;
    pop.style.bottom = `${String(innerHeight - at.top + 6)}px`;
  };
</script>

{#if all.length}
  <button bind:this={open} class="open" type="button" aria-haspopup="dialog" popovertarget={id}>{label}</button>
  <div
    bind:this={pop}
    {id}
    class="pop"
    popover
    role="dialog"
    tabindex="-1"
    aria-labelledby="{id}-title"
    ontoggle={ev => {
      if (ev.newState === 'open') place();
    }}
  >
    <h2 id="{id}-title">What this stack needs on this Mac</h2>
    <ul>
      {#each todo as check (check.name)}
        {@const run = command(check)}
        <li>
          <strong>{check.name}</strong>
          <small>{about(check)}</small>
          {#if run}
            <Command command={run} />
          {/if}
        </li>
      {/each}
      {#each envs as env (env)}
        <li class="gaps">
          <h3>Missing from the stack for {env.toUpperCase()}</h3>
          <p>Koppler never uses another environment's sign-ins, tunnels or secret steps instead.</p>
          {#each appsIn(env) as app (app)}
            <div class="gap">
              <strong>{appName(app)}</strong>
              {#each gapsOf(env, app) as gap (gap.detail)}<small>{gapLine(gap)}</small>{/each}
              <button type="button" disabled={asked.includes(`${env}|${app}`)} onclick={() => void ask(env, app)}
                >{asked.includes(`${env}|${app}`) ? 'Sent to the agent' : 'Ask the agent to find it'}</button
              >
            </div>
          {/each}
          {#if appsIn(env).length > 1}
            <button class="all" type="button" disabled={asked.includes(`${env}|`)} onclick={() => void ask(env)}
              >{asked.includes(`${env}|`)
                ? 'Sent to the agent'
                : `Ask the agent to find all ${String(appsIn(env).length)}`}</button
            >
          {/if}
        </li>
      {/each}
    </ul>
  </div>
{/if}

<style>
  .open {
    width: 100%;
    padding: 7px 10px;
    border: 1px solid color-mix(in oklab, var(--warn) 50%, transparent);
    border-radius: 8px;
    background: color-mix(in oklab, var(--warn) 12%, transparent);
    color: var(--ink);
    font: 600 12.5px/1.4 var(--sans);
    text-align: left;
    cursor: pointer;
  }
  .pop {
    position: fixed;
    inset: auto;
    width: min(420px, calc(100vw - 24px));
    max-height: min(560px, calc(100vh - 120px));
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
  h2 {
    margin: 0 0 10px;
    font-size: 14px;
  }
  h3 {
    margin: 0;
    font-size: 13px;
  }
  ul {
    display: grid;
    gap: 12px;
    margin: 0;
    padding: 0;
    list-style: none;
  }
  li,
  .gap {
    display: grid;
    gap: 4px;
  }
  .gaps {
    gap: 10px;
    padding-top: 12px;
    border-top: 1px solid var(--line);
  }
  small,
  p {
    margin: 0;
    color: var(--muted);
    font-size: 12px;
  }
  .pop button {
    justify-self: start;
    padding: 5px 10px;
    border: 1px solid var(--line);
    border-radius: 6px;
    background: none;
    color: var(--ink);
    font: 600 12px var(--sans);
    cursor: pointer;
  }
  .pop button.all {
    border-color: transparent;
    background: var(--cable);
    color: var(--on-accent);
  }
  .pop button:disabled {
    opacity: 0.6;
    cursor: default;
  }
</style>
