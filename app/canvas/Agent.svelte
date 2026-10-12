<script lang="ts">
  // Whether an agent session takes what the canvas sends, and how to connect one.
  import { inbox } from './inbox.svelte.ts';
  import { live } from './live.svelte.ts';

  const ABOUT: Record<string, readonly [string, string]> = {
    listening: [
      'Agent connected',
      'An agent session is listening: notes, checklists and fix requests reach it right away.',
    ],
    busy: ['Agent working', 'The connected agent is working on a request; the next one waits for it.'],
    question: ['Agent needs you', 'The agent asked something about your run. Click to answer.'],
    none: [
      'No agent listening',
      'Runs work without one. Notes, checklists and fix requests wait until an agent connects; press ↻ to see how.',
    ],
  };
  const COMMAND = '/koppler-run connect';
  const id = $props.id();
  let how = $state<HTMLButtonElement>();
  let pop = $state<HTMLDivElement>();
  let open = $state(false);
  let copied = $state(false);
  const listening = $derived(live.status?.agent?.state ?? 'none');
  const agent = $derived(inbox.question ? 'question' : listening);
  const [name, about] = $derived(ABOUT[agent] ?? ABOUT['none'] ?? ['', '']);
  const queued = $derived(live.status?.queued ?? 0);
  const waiting = $derived(queued > 0 && agent !== 'listening');
  // No agent is fine: runs work without one. It only warns when something waits for an agent.
  const tone = $derived(agent === 'none' && !queued ? 'off' : agent);
  const label = $derived(
    ({ listening: 'Agent', busy: 'Agent working', none: queued ? name : 'No agent' }[agent] ?? name) +
      (waiting ? `, ${String(queued)} waiting` : ''),
  );
  const title = $derived(
    `${name}. ${about}${waiting ? ` ${String(queued)} ${queued === 1 ? 'request waits' : 'requests wait'} for it; only the newest run or Stop is handed over.` : ''}`,
  );
  const place = () => {
    const at = how?.getBoundingClientRect();
    if (!at || !pop) return;
    pop.style.top = `${String(at.bottom + 6)}px`;
    pop.style.right = `${String(Math.max(12, innerWidth - at.right))}px`;
  };
  const copy = async () => {
    await navigator.clipboard.writeText(COMMAND).catch(() => undefined);
    copied = true;
    setTimeout(() => (copied = false), 1500);
  };
  // An agent connected while the steps were open: they are no longer needed.
  $effect(() => {
    if (listening !== 'none' && open) pop?.hidePopover();
  });
</script>

{#if live.status}
  <button
    class="agent"
    type="button"
    data-state={tone}
    {title}
    aria-expanded={inbox.open}
    onclick={() => (inbox.open = !inbox.open)}
  >
    <span class="dot" aria-hidden="true"></span>{label}
  </button>
  {#if listening === 'none'}
    <button
      bind:this={how}
      class="how"
      type="button"
      aria-label="How to connect an agent"
      title="How to connect an agent"
      aria-haspopup="dialog"
      aria-expanded={open}
      popovertarget={id}
    >
      <svg viewBox="0 0 16 16" width="15" height="15" aria-hidden="true">
        <path d="M13 8a5 5 0 1 1-1.5-3.6M13 2.5v3h-3" />
      </svg>
    </button>
  {/if}
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
        <span class="cmd"
          ><code>{COMMAND}</code><button type="button" onclick={copy}>{copied ? 'Copied' : 'Copy'}</button></span
        >
      </li>
      <li>The dot turns green once it listens<small>Anything sent meanwhile waits for it.</small></li>
    </ol>
  </div>
{/if}

<style>
  .agent {
    display: inline-flex;
    align-items: center;
    gap: 7px;
    height: 32px;
    padding: 0 10px;
    border: 1px solid transparent;
    border-radius: 8px;
    background: none;
    color: var(--muted);
    cursor: pointer;
    font: 500 12.5px var(--sans);
    white-space: nowrap;
  }
  .agent:hover,
  .agent[aria-expanded='true'] {
    border-color: var(--line);
    color: var(--ink);
  }
  .agent[data-state='question'] {
    border-color: color-mix(in oklab, var(--warn) 55%, transparent);
    background: color-mix(in oklab, var(--warn) 12%, transparent);
    color: var(--ink);
    font-weight: 600;
  }
  [data-state='question'] .dot {
    background: var(--warn);
  }
  .dot {
    width: 8px;
    height: 8px;
    border-radius: 50%;
    background: var(--muted);
  }
  [data-state='listening'] .dot {
    background: var(--ok);
  }
  [data-state='busy'] .dot {
    background: var(--cable);
    animation: working 1.4s ease-in-out infinite;
  }
  [data-state='none'] .dot {
    background: var(--warn);
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
  .how {
    display: grid;
    place-items: center;
    width: 32px;
    height: 32px;
    margin-left: -8px;
    padding: 0;
    border: 1px solid transparent;
    border-radius: 8px;
    background: none;
    color: var(--muted);
    cursor: pointer;
  }
  .how:hover,
  .how[aria-expanded='true'] {
    border-color: var(--line);
    color: var(--ink);
  }
  .how path {
    fill: none;
    stroke: currentColor;
    stroke-width: 1.5;
    stroke-linecap: round;
    stroke-linejoin: round;
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
  .cmd {
    display: flex;
    align-items: center;
    gap: 8px;
    margin-top: 6px;
    font-weight: 400;
  }
  code {
    flex: 1;
    min-width: 0;
    padding: 5px 8px;
    border: 1px solid var(--line);
    border-radius: 6px;
    background: var(--paper);
    font: 12px var(--mono);
  }
  .cmd button {
    padding: 5px 10px;
    border: 1px solid var(--line);
    border-radius: 6px;
    background: none;
    color: var(--ink);
    font: 600 12px var(--sans);
    cursor: pointer;
  }
</style>
