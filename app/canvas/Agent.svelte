<script lang="ts">
  import { opens } from './bar.svelte.ts';
  // Whether an agent session takes what the canvas sends, and how to connect one.
  import Command from './Command.svelte';
  import { inbox } from './inbox.svelte.ts';
  import { live } from './live.svelte.ts';

  const ABOUT: Record<string, readonly [string, string]> = {
    listening: [
      'Agent connected',
      'An agent session is listening: notes, checklists and fix requests reach it right away.',
    ],
    busy: ['Agent working', 'The connected agent is working on a request; the next one waits for it.'],
    question: ['Agent needs you', 'The agent asked something about your run. Click to answer.'],
    quiet: [
      'Agent quiet',
      'It took a request and has neither finished it nor listened again since. If its session is done, run /koppler-run connect there; click for the steps.',
    ],
    none: [
      'No agent listening',
      'Runs work without one. Notes, checklists and fix requests wait until an agent connects; click to see how.',
    ],
  };
  const COMMAND = '/koppler-run connect';
  const id = $props.id();
  let chip = $state<HTMLButtonElement>();
  let pop = $state<HTMLDivElement>();
  let open = $state(false);
  const QUIET_AFTER = 10 * 60 * 1000;
  // How long it has been at what it took; the status comes every second and a half, so this keeps up.
  const minutes = $derived.by(() => {
    const took = Date.parse(live.status?.agent?.busy ?? '');
    return Number.isNaN(took) || !live.status ? 0 : Math.floor((Date.now() - took) / 60000);
  });
  const working = $derived(live.status?.agent?.state ?? 'none');
  // Working this long without a word or a listener, it has most likely stopped: say so, and how to reconnect.
  const listening = $derived(working === 'busy' && minutes * 60000 >= QUIET_AFTER ? 'quiet' : working);
  const agent = $derived(inbox.question ? 'question' : listening);
  const [name, about] = $derived(ABOUT[agent] ?? ABOUT['none'] ?? ['', '']);
  const queued = $derived(live.status?.queued ?? 0);
  const waiting = $derived(queued > 0 && agent !== 'listening');
  // No agent is fine: runs work without one. It only warns when something waits for an agent.
  const tone = $derived(agent === 'none' && !queued ? 'off' : agent);
  /** Which session is connected, in the agent's own words, and where it runs. */
  const who = $derived(listening === 'none' ? undefined : live.status?.agent?.who);
  const session = $derived(
    who && (who.agent || who.cwd)
      ? ` ${[who.agent && `${who.agent}${who.agentSession ? ` session ${who.agentSession}` : ''}`, who.cwd && `in ${who.cwd.replace(/^\/Users\/[^/]+/, '~')}`].filter(Boolean).join(', ')}.`
      : '',
  );
  const label = $derived(
    ({
      listening: who?.name ? `Agent: ${who.name}` : 'Agent',
      busy: minutes ? `Agent working, ${String(minutes)} min` : 'Agent working',
      quiet: `Agent quiet, ${String(minutes)} min`,
      none: queued ? name : 'No agent',
    }[agent] ?? name) + (waiting ? `, ${String(queued)} waiting` : ''),
  );
  const title = $derived(
    `${name}${who?.name ? `: ${who.name}` : ''}.${session} ${about}${waiting ? ` ${String(queued)} ${queued === 1 ? 'request waits' : 'requests wait'} for it; only the newest run or Stop is handed over.` : ''}`,
  );
  opens.connect = () => pop?.showPopover();
  const place = () => {
    const at = chip?.getBoundingClientRect();
    if (!at || !pop) return;
    pop.style.top = `${String(at.bottom + 6)}px`;
    pop.style.right = `${String(Math.max(12, innerWidth - at.right))}px`;
  };
  // An agent connected while the steps were open: they are no longer needed.
  $effect(() => {
    if ((listening === 'listening' || listening === 'busy') && open) pop?.hidePopover();
  });
</script>

{#if live.status}
  <button
    bind:this={chip}
    class="agent"
    type="button"
    data-state={tone}
    {title}
    aria-expanded={inbox.open}
    onclick={() => (inbox.open = !inbox.open)}
  >
    <span class="dot round" aria-hidden="true"></span><span class="words">{label}</span>
  </button>
  <div
    bind:this={pop}
    {id}
    class="connect"
    popover
    role="dialog"
    aria-labelledby="{id}-title"
    ontoggle={ev => {
      open = ev.newState === 'open';
      if (open) place();
    }}
  >
    <h2 id="{id}-title">Connect an agent</h2>
    <p>
      Koppler starts and stops a confirmed run by itself. The agent is needed for what it cannot do alone: manual
      checklists, notes, fixing a failed start, and anything a run leaves over.
    </p>
    <ol>
      <li>Open your agent session in this project</li>
      <li>
        Run this command there
        <Command command={COMMAND} />
      </li>
      <li>The dot turns green once it listens<small>Anything sent meanwhile waits for it.</small></li>
    </ol>
  </div>
{/if}

<style>
  .words {
    max-width: 240px;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }
  .agent {
    display: inline-flex;
    align-items: center;
    gap: 7px;
    height: 30px;
    padding: 0 9px;
    border: 1px solid var(--line-strong);
    background: none;
    color: var(--ink);
    cursor: pointer;
    font: 400 13px var(--sans);
    white-space: nowrap;
  }
  .agent:hover,
  .agent[aria-expanded='true'] {
    background: color-mix(in oklab, var(--ink) 6%, transparent);
  }
  .agent[data-state='listening'] .dot,
  .agent[data-state='busy'] .dot {
    color: var(--live);
  }
  .agent[data-state='question'] .dot {
    color: var(--warn);
  }
  .agent[data-state='none'] {
    border-style: dashed;
    color: var(--ink-muted);
  }
  .agent[data-state='quiet'] .dot {
    color: var(--warn);
  }
  .dot {
    width: 6px;
    height: 6px;
    border: 1px solid currentColor;
  }
  [data-state='listening'] .dot,
  [data-state='question'] .dot,
  [data-state='quiet'] .dot {
    background: currentColor;
  }
  [data-state='busy'] .dot {
    animation: working 1.4s ease-in-out infinite;
  }
  @keyframes working {
    50% {
      opacity: 0.35;
    }
  }
  @media (prefers-reduced-motion: reduce) {
    [data-state='busy'] .dot {
      animation: none;
    }
  }
  .connect {
    position: fixed;
    inset: auto;
    width: min(360px, calc(100vw - 24px));
    margin: 0;
    padding: 14px 16px;
    border: 1px solid var(--line);
    border-radius: 12px;
    background: var(--surface);
    color: var(--ink);
    box-shadow: var(--lift);
    font: 13px/1.45 var(--sans);
  }
  h2 {
    margin: 0 0 6px;
    font-size: 14px;
  }
  p {
    margin: 0 0 10px;
    color: var(--muted);
  }
  ol {
    display: grid;
    gap: 10px;
    margin: 0;
    padding-left: 20px;
    font-weight: 600;
  }
  li small {
    display: block;
    color: var(--muted);
    font-weight: 400;
    font-size: 12px;
  }
  li :global(.cmd) {
    margin-top: 6px;
    font-weight: 400;
  }
</style>
