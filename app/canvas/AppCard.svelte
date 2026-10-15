<script lang="ts">
  import Zap from '@lucide/svelte/icons/zap';
  import Waypoints from '@lucide/svelte/icons/waypoints';
  import RefreshCw from '@lucide/svelte/icons/refresh-cw';
  import Check from '@lucide/svelte/icons/check';
  import Icon from './Icon.svelte';
  import GripVertical from '@lucide/svelte/icons/grip-vertical';
  import Logs from '@lucide/svelte/icons/logs';
  import Play from '@lucide/svelte/icons/play';
  import RotateCw from '@lucide/svelte/icons/rotate-cw';
  import Square from '@lucide/svelte/icons/square';
  import X from '@lucide/svelte/icons/x';
  import Cog from './Cog.svelte';
  import Command from './Command.svelte';
  import CardFields from './CardFields.svelte';
  import { Handle, NodeToolbar, Position, useViewport, type NodeProps } from '@xyflow/svelte';
  import type { Side } from '../src/core/arrange.ts';
  import { board, FAR_ZOOM, type CardNode } from './board.svelte.ts';
  import { wiring } from './wiring.svelte.ts';
  import { COMMAND_ICON, openTerminal, runCommand } from './commands.ts';
  import SquareTerminal from '@lucide/svelte/icons/square-terminal';
  import { toasts } from './toast.svelte.ts';
  import { post } from './data.ts';
  import { live, progress, STATE_NAMES } from './live.svelte.ts';
  import { logs } from './logs.svelte.ts';
  import { runs } from './run.svelte.ts';
  import { dialogs } from './dialogs.svelte.ts';

  const { id, data, selected, dragging }: NodeProps<CardNode> = $props();
  // The action bar shows while the card or the bar is pointed at, and stays a moment as the pointer crosses the gap.
  let hovered = $state(false);
  let leaving: ReturnType<typeof setTimeout> | undefined;
  const show = () => {
    clearTimeout(leaving);
    hovered = true;
  };
  const hide = () => {
    leaving = setTimeout(() => (hovered = false), 250);
  };
  const bar = $derived(hovered || selected);
  const SIDES: Side[] = ['top', 'right', 'bottom', 'left'];
  const viewport = useViewport();
  const far = $derived(viewport.current.zoom < FAR_ZOOM);
  /** The short card: zoomed out, or in the Live view. It shows state, not fields. */
  const brief = $derived(far || board.live);
  // Short, the card keeps its full width: the board is spaced for that, so neighbours never run into each other.
  let width = $state(0);
  let fullWidth = $state(0);
  $effect(() => {
    if (!brief && width) fullWidth = width;
  });
  const app = $derived(board.app(id));
  const current = $derived(app?.current || 'current branch');
  const tunnels = $derived(board.tunnelsOf(id));
  const queues = $derived(board.queuesOf(id));
  const noQueues = $derived(queues.length > 0 && !data.showQueues);
  const calls = $derived(board.deployedCalls(id));
  /** "Acme Web Portal" reads as "Web Portal" on an Acme card. */
  const short = (name: string) => {
    const [first, ...rest] = name.split(' ');
    return rest.length && first === data.name.split(' ')[0] ? rest.join(' ') : name;
  };
  const mobile = $derived(!!app?.platforms.length && data.run === 'cli');
  const platform = $derived(app?.platforms.find(([value]) => value === data.platform)?.[1]);
  /** What the short card says about how it runs. */
  const runLabel = $derived(
    data.run === 'ide' ? 'Started by you' : data.run === 'mock' ? 'Mock' : mobile ? platform : undefined,
  );
  const up = $derived(live.up(id));
  const where = $derived(live.where(id));
  const now = $derived(live.state(id));
  /** Hot reload, or hot restart, through the canvas server: the toast says how it went. */
  const reload = async (restart: boolean) => {
    const said = await post<{ said: string }>('reload', { app: id, restart });
    if ('error' in said) toasts.show(said.error, 'warning');
    else toasts.show(`${said.said}.`);
  };
  const stateSaid = $derived(live.stateSaid(id));
  const steps = $derived(live.steps(id));
  const [tone, said] = $derived(steps.length ? progress(steps) : ['todo', '']);
  const failed = $derived(steps.find(step => step.state === 'failed'));
  let open = $state(false);
  let asked = $state(false);
  /** A side whose one cable sits on the port: the ring stays lit under its end. */
  const lit = (side: Side) => board.ends.onPort.some(port => port.id === id && port.side === side);
</script>

<!-- What can be done with the card, in a bar above it while it is pointed at or picked: the title keeps its room. -->
<NodeToolbar isVisible={bar && !dragging} position={Position.Top} align="end" offset={6}>
  <span
    class="tools nodrag"
    data-card={id}
    class:reading={board.live}
    role="toolbar"
    tabindex="-1"
    aria-label="{data.name} actions"
    onpointerenter={show}
    onpointerleave={hide}
  >
    {#if runs.started.includes(id)}
      <button
        class="stop"
        type="button"
        aria-label="Stop {data.name}"
        title="Stop this app; its changes stay"
        onclick={() => void runs.stopApp(id)}
      >
        <Icon of={Square} size={15} filled />
      </button>
      <button
        type="button"
        aria-label="Restart {data.name}"
        title="Restart this app; the rest keeps running"
        onclick={() => {
          runs.start({ restart: id });
        }}
      >
        <Icon of={RotateCw} size={15} />
      </button>
    {:else}
      <button
        type="button"
        aria-label="Run {data.name} alone"
        title="Run alone: just this app and its tunnels, on a board of its own"
        onclick={() => {
          runs.alone(id);
        }}
      >
        <Icon of={Play} size={15} filled />
      </button>
    {/if}
    {#if live.hasLog(id)}
      <button
        type="button"
        aria-label="Show log"
        title="Show log"
        onclick={() => {
          logs.open(id);
        }}
      >
        <Icon of={Logs} size={15} />
      </button>
    {/if}
    {#each board.commandsOf(id) as [key, command] (key)}
      {@const ask = { app: id, appName: data.name, key, command }}
      <button
        type="button"
        aria-label="{command.label} on {data.name}"
        title={command.confirm ? `${command.label}: ${command.confirm}` : command.label}
        onclick={() => {
          if (command.confirm || command.args?.length) dialogs.command?.open(ask);
          else
            void runCommand(ask).then(error => {
              if (error) toasts.show(error, 'warning');
            });
        }}
      >
        <Icon of={COMMAND_ICON[command.icon ?? 'terminal']} size={15} />
      </button>
    {/each}
    {#if live.status?.traces?.state === 'on' && live.sent(id)}
      <a
        class="tool"
        href="{live.status.traces.view}?service={encodeURIComponent(id)}"
        target="_blank"
        rel="noopener"
        aria-label="Traces of {data.name}"
        title="Its requests, followed across your local apps"
      >
        <Icon of={Waypoints} size={15} />
      </a>
    {/if}
    {#if app?.kind === 'flutter' && data.run === 'cli' && up}
      <button
        type="button"
        aria-label="Hot reload {data.name}"
        title="Hot reload: the app takes your code changes as it runs. Shift-click to hot restart."
        onclick={ev => void reload(ev.shiftKey)}
      >
        <Icon of={Zap} size={15} />
      </button>
    {/if}
    {#if app?.cloned && !app.outside}
      <button
        type="button"
        aria-label="Open a terminal for {data.name}"
        title="A terminal in its clone, with the settings its run starts it with; never its secrets"
        onclick={() => void openTerminal(id)}
      >
        <Icon of={SquareTerminal} size={15} />
      </button>
    {/if}
    {#if data.run === 'cli'}
      <button
        type="button"
        aria-pressed={!!data.watch}
        aria-label="Auto-restart for {data.name}"
        title={data.watch
          ? 'Auto-restart is on: Koppler starts it again whenever a file in its clone changes. Click to turn it off.'
          : 'Auto-restart: start it again whenever a file in its clone changes'}
        onclick={() => {
          board.set(id, { watch: !data.watch });
        }}
      >
        <Icon of={RefreshCw} size={15} />
      </button>
    {/if}
    <button
      type="button"
      aria-label="Settings for {data.name}"
      title="Settings: every fact the stack has about it"
      onclick={() => void dialogs.settings?.open({ title: data.name, path: `apps.${id}` })}
    >
      <Cog size={15} />
    </button>
    <button
      class="remove"
      type="button"
      aria-label="Remove {data.name}"
      title="Take off the board"
      onclick={() => {
        board.remove(id);
      }}
    >
      <Icon of={X} size={15} />
    </button>
  </span>
</NodeToolbar>

<article
  class="card kind-{data.kind}"
  class:selected
  class:dimmed={board.dimmed(id)}
  class:short={brief}
  class:far
  class:reading={board.live}
  class:drop-ok={wiring.drop?.id === id && wiring.drop.ok}
  class:drop-bad={wiring.drop?.id === id && !wiring.drop.ok}
  class:wiring={!!wiring.draft}
  bind:offsetWidth={width}
  onpointerenter={show}
  onpointerleave={hide}
  style:width={brief && fullWidth ? `${String(fullWidth)}px` : undefined}
>
  <header>
    <span class="grip" aria-hidden="true" title="Drag to move">
      <Icon of={GripVertical} size={14} />
    </span>
    {#if up !== null || now}
      <span
        class="live"
        data-on={up}
        data-state={now?.state}
        role="img"
        aria-label={now ? STATE_NAMES[now.state] : up ? 'Running' : 'Not answering'}
        title={stateSaid || live.about(id)}
      ></span>
    {/if}
    <span class="name" title={data.name}>{data.name}</span>
    {#if data.watch && data.run === 'cli'}<span
        class="watch"
        role="img"
        aria-label="Auto-restart"
        title="Restarts when its files change"><Icon of={RefreshCw} size={12} /></span
      >{/if}
    <span class="kind">{data.kindLabel}</span>
  </header>
  {#if brief}
    <p class="glance">
      <span title="Branch: {data.branch || current}">{data.branch || current}</span>
      {#if runLabel}<span>{runLabel}</span>{/if}
      {#if noQueues}<span title="It is taken off its queues and keeps the deployed ones">No queues</span>{/if}
      {#if data.hideTunnels && tunnels.length}<span
          class="off"
          title="Only the API runs; calls through its tunnels fail">No tunnels</span
        >{/if}
    </p>
  {:else}
    <CardFields {id} />
  {/if}
  {#if where}<p class="where nodrag" data-on={up ?? 'other'}>{where}</p>
  {:else if stateSaid}<p class="where nodrag" data-state={now?.state}>{stateSaid}</p>{/if}
  {#if steps.length}
    <button class="progress nodrag" type="button" data-tone={tone} aria-expanded={open} onclick={() => (open = !open)}>
      <span class="marks">
        {#each steps as step, at (at)}<i data-state={step.state} title={step.label}></i>{/each}
      </span>
      <span class="text">{said}</span>
      <span class="chev">{open ? 'Hide' : 'Details'}</span>
    </button>
    {#if failed?.detail && !open}<p class="why nodrag">{failed.detail}</p>{/if}
    {#if open}
      <ul class="steps nodrag nopan">
        {#each steps as step, at (at)}
          <li class="step" data-state={step.state}>
            <span class="mark" aria-hidden="true"
              >{#if step.state === 'done'}<Icon of={Check} size={11} />{:else if step.state === 'failed'}!{/if}</span
            >
            <span class="what">{step.label}</span>
            {#if step.detail}<span class="detail">{step.detail}</span>{/if}
            {#if step.copy}
              <Command command={step.copy} />
            {/if}
          </li>
        {/each}
      </ul>
    {/if}
  {/if}
  {#if failed}
    <div class="acts nodrag">
      <!-- The failure goes to the agent with the app and step; it says what it would change and asks before it acts. -->
      <button
        class="act fix"
        type="button"
        disabled={asked}
        onclick={async () => {
          asked = await runs.askToFix(id, `${failed.label}${failed.detail ? `: ${failed.detail}` : ''}`);
        }}>{asked ? 'Sent to the agent' : 'Ask the agent to fix'}</button
      >
    </div>
  {/if}
  {#if calls.length}
    <div class="calls nodrag nopan">
      <span class="calls-label">Calls {board.env.toUpperCase()}</span>
      {#each calls as other (other.id)}
        {@const onBoard = board.cards.some(node => node.id === other.id)}
        {@const can = onBoard || other.cloned}
        <button
          class="chip"
          type="button"
          disabled={!can}
          title="{other.name} stays on deployed {board.env.toUpperCase()}.{can
            ? ` Click to ${onBoard ? 'wire it to your local copy' : 'run it locally too and wire it'}.`
            : ' It is not cloned on this Mac.'}"
          onclick={() => {
            board.callLocally(id, other.id);
          }}>{short(other.name)}</button
        >
      {/each}
    </div>
  {/if}
  <!-- The one anchor Svelte Flow needs to draw this card's cables; the ports below are ours. -->
  <Handle type="source" position={Position.Top} isConnectable={false} class="anchor" />
  {#each SIDES as side (side)}
    <button
      class="port {side} nodrag nopan"
      class:on={lit(side)}
      aria-label="Draw a cable from the {side} of {data.name}"
      title="Drag a cable to an app this one should call locally"
      tabindex="-1"
      onpointerdown={ev => {
        if (ev.button !== 0) return;
        ev.stopPropagation();
        wiring.start(id, side);
      }}
    ></button>
  {/each}
</article>

<style>
  .card {
    position: relative;
    width: max-content;
    min-width: 260px;
    max-width: 380px;
    background: var(--surface);
    border: 1px solid var(--line);
    border-radius: 10px;
    color: var(--ink);
    font: 14px/1.4 var(--sans);
    user-select: none;
  }
  .card.selected,
  :global(.svelte-flow__node:focus-visible) .card {
    outline: 2px solid var(--cable);
    /* On the border itself: one frame, not a ring around a frame. */
    outline-offset: -1px;
  }
  .card.drop-ok {
    box-shadow: 0 0 0 3px var(--ok);
  }
  .card.drop-bad {
    box-shadow: 0 0 0 3px var(--bad);
  }
  /* Only the title sets a card's width: everything below it fits whatever width the title makes. */
  .body,
  .glance {
    contain: inline-size;
  }
  header {
    display: flex;
    align-items: center;
    gap: 8px;
    min-height: 44px;
    padding: 6px 8px 6px 16px;
    border-bottom: 1px solid var(--line);
    cursor: grab;
  }
  .short header {
    border-bottom: 0;
  }
  .grip {
    display: grid;
    margin-left: -6px;
    fill: var(--muted);
    opacity: 0.6;
  }
  .kind {
    flex: none;
    margin-left: 10px;
    padding: 1px 7px;
    border-radius: 999px;
    font: 600 12px/1.5 var(--sans);
    white-space: nowrap;
    color: var(--kind);
    background: color-mix(in oklab, var(--kind) 14%, transparent);
  }
  .name {
    flex: 1;
    min-width: 0;
    font-weight: 700;
    font-size: 15px;
    line-height: 1.2;
    text-wrap: balance;
    overflow-wrap: break-word;
  }
  /* A word is never broken: what follows the name goes to the next line instead. */
  .short header {
    flex-wrap: wrap;
  }
  .short .name {
    min-width: min-content;
    font-size: 22px;
  }
  .tools {
    display: flex;
    gap: 1px;
    padding: 3px;
    border: 1px solid var(--line);
    border-radius: 9px;
    background: var(--panel);
    box-shadow: var(--lift);
  }
  .tools.reading .remove {
    display: none;
  }
  .tools :is(button, .tool) {
    display: grid;
    place-items: center;
    width: 26px;
    height: 26px;
    padding: 0;
    border: 0;
    border-radius: 6px;
    background: none;
    color: var(--muted);
    cursor: pointer;
  }
  .tools :is(button, .tool):hover,
  .tools :is(button, .tool):focus-visible {
    background: color-mix(in oklab, var(--ink) 8%, transparent);
    color: var(--ink);
  }
  .tools button[aria-pressed='true'] {
    background: color-mix(in oklab, var(--cable) 14%, transparent);
    color: var(--cable);
  }
  .tools :is(.remove, .stop):hover {
    color: var(--bad);
  }
  .tools .fill {
    fill: currentColor;
    stroke: none;
  }
  .watch {
    display: inline-grid;
    flex: none;
    color: var(--muted);
  }
  .live {
    flex: none;
    width: 9px;
    height: 9px;
    border-radius: 50%;
    background: var(--bad);
  }
  .live[data-on='true'],
  .live[data-state='running'] {
    background: var(--ok);
  }
  .live:is([data-state='waiting'], [data-state='building']) {
    background: var(--warn);
  }
  .live:is(
    [data-state='unhealthy'],
    [data-state='exited'],
    [data-state='failed-to-start'],
    [data-state='secret-missing']
  ) {
    background: var(--bad);
  }
  .where {
    contain: inline-size;
    margin: 0;
    padding: 0 14px 10px 16px;
    color: var(--muted);
    font-size: 12px;
    user-select: text;
    cursor: auto;
  }
  .where[data-on='true'] {
    color: var(--ok);
  }
  .where:is(
    [data-state='unhealthy'],
    [data-state='exited'],
    [data-state='failed-to-start'],
    [data-state='secret-missing']
  ) {
    color: var(--bad);
  }
  .progress {
    contain: inline-size;
    display: flex;
    align-items: center;
    gap: 8px;
    width: 100%;
    padding: 9px 14px 9px 16px;
    border: 0;
    border-top: 1px solid var(--line);
    background: none;
    color: var(--ink);
    font: 600 12.5px var(--sans);
    text-align: left;
    cursor: pointer;
  }
  .progress:hover {
    background: color-mix(in oklab, var(--ink) 5%, transparent);
  }
  .marks {
    display: flex;
    gap: 4px;
  }
  .marks i {
    width: 9px;
    height: 9px;
    border-radius: 50%;
    background: var(--line);
  }
  .marks i[data-state='done'] {
    background: var(--ok);
  }
  .marks i[data-state='user'] {
    background: var(--warn);
  }
  .marks i[data-state='failed'] {
    background: var(--bad);
  }
  .text {
    flex: 1;
    min-width: 0;
  }
  .progress[data-tone='user'] .text {
    color: var(--warn);
  }
  .progress[data-tone='failed'] .text {
    color: var(--bad);
  }
  .chev {
    color: var(--muted);
    font-size: 12px;
    font-weight: 500;
  }
  .why {
    contain: inline-size;
    display: -webkit-box;
    margin: -4px 0 0;
    padding: 0 14px 10px 16px;
    overflow: hidden;
    font-size: 12.5px;
    line-height: 1.4;
    -webkit-line-clamp: 3;
    line-clamp: 3;
    -webkit-box-orient: vertical;
  }
  .steps {
    contain: inline-size;
    display: grid;
    gap: 7px;
    margin: 0;
    padding: 4px 14px 12px 16px;
    list-style: none;
    user-select: text;
    cursor: auto;
  }
  .step {
    display: grid;
    grid-template-columns: 18px 1fr;
    column-gap: 8px;
    font-size: 12.5px;
    line-height: 1.3;
  }
  .mark {
    display: grid;
    place-items: center;
    width: 18px;
    height: 18px;
    border-radius: 50%;
    background: var(--line);
    color: var(--on-accent);
    font-size: 12px;
    font-weight: 700;
  }
  .step[data-state='done'] .mark {
    background: var(--ok);
  }
  .step[data-state='user'] .mark {
    background: var(--warn);
  }
  .step[data-state='failed'] .mark {
    background: var(--bad);
  }
  .step[data-state='todo'] .mark {
    border: 2px solid var(--line);
    background: none;
  }
  .what {
    font-weight: 600;
  }
  .step[data-state='user'] .what::after {
    content: ' (you)';
    color: var(--warn);
    font-weight: 500;
  }
  .detail {
    grid-column: 2;
    color: var(--muted);
  }
  .step :global(.cmd) {
    grid-column: 2;
    margin-top: 4px;
  }
  .acts {
    contain: inline-size;
    display: flex;
    flex-wrap: wrap;
    gap: 8px;
    padding: 0 14px 12px 16px;
    cursor: default;
  }
  .act {
    padding: 2px 8px;
    border: 1px solid var(--line);
    border-radius: 5px;
    background: none;
    color: var(--ink);
    font: 600 12px var(--sans);
    cursor: pointer;
  }
  .act:hover {
    background: color-mix(in oklab, var(--ink) 8%, transparent);
  }
  .act.fix {
    border-color: color-mix(in oklab, var(--bad) 45%, var(--line));
    background: color-mix(in oklab, var(--bad) 10%, transparent);
  }
  .act:disabled {
    opacity: 0.6;
    cursor: default;
  }
  .short .act {
    font-size: 16px;
  }
  .calls {
    contain: inline-size;
    display: flex;
    flex-wrap: wrap;
    align-items: center;
    gap: 6px;
    padding: 8px 12px 10px 16px;
    border-top: 1px dashed var(--line);
    cursor: default;
  }
  .reading.far .calls {
    display: none;
  }
  .calls-label {
    margin-right: 2px;
    color: var(--muted);
    font-size: 12px;
  }
  .chip {
    max-width: 180px;
    min-height: 24px;
    padding: 3px 8px;
    overflow: hidden;
    border: 1px dashed color-mix(in oklab, var(--muted) 70%, transparent);
    border-radius: 999px;
    background: none;
    color: var(--ink);
    font: 500 12px var(--sans);
    white-space: nowrap;
    text-overflow: ellipsis;
    cursor: pointer;
  }
  .chip:hover:not(:disabled) {
    border-style: solid;
    border-color: var(--cable);
    color: var(--cable);
  }
  .chip:disabled {
    color: var(--muted);
    cursor: default;
  }
  /* The short card reads at a glance: larger, and nothing on it to edit or pull. */
  .short {
    min-width: 260px;
    max-width: 380px;
    padding-bottom: 4px;
  }
  .short header {
    min-height: 60px;
  }
  .short .port {
    display: none;
  }
  .short .progress {
    padding: 12px 16px;
    font-size: 21px;
  }
  .short .marks i {
    transform: scale(1.4);
  }
  /* Short, the row is a summary: its words keep one line, and the row itself opens the steps. */
  .short .chev {
    display: none;
  }
  .short .text {
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }
  .short .where {
    font-size: 16px;
  }
  .short .why {
    font-size: 16px;
  }
  .short :is(.calls-label, .chip) {
    font-size: 15px;
  }
  .reading.far .progress {
    font-size: 24px;
  }
  .reading.far :is(.glance, .where) {
    display: none;
  }
  .glance .off {
    background: color-mix(in oklab, var(--warn) 14%, transparent);
    color: var(--warn);
    font: 600 15px var(--sans);
  }
  .remove:focus-visible {
    outline: 2px solid var(--cable);
    outline-offset: 1px;
  }
  .glance {
    display: flex;
    flex-wrap: wrap;
    gap: 6px;
    margin: 0;
    padding: 0 16px 10px;
  }
  .glance span {
    padding: 2px 8px;
    border-radius: 6px;
    background: color-mix(in oklab, var(--ink) 7%, transparent);
    font: 15px var(--mono);
    color: var(--muted);
  }
  .port {
    position: absolute;
    width: 16px;
    height: 16px;
    margin: -8px 0 0 -8px;
    padding: 0;
    border: 2px solid var(--ink);
    border-radius: 50%;
    background: var(--surface);
    opacity: 0;
    cursor: crosshair;
    transition: opacity 0.1s;
  }
  .card:hover .port,
  .card.wiring .port,
  .port.on {
    opacity: 1;
  }
  .port:hover {
    border-color: var(--cable);
  }
  /* On the card's outer edge, where its cables end: one pixel out from where the border's inside puts them. */
  .port.top {
    left: 50%;
    top: -1px;
  }
  .port.right {
    left: calc(100% + 1px);
    top: 50%;
  }
  .port.bottom {
    left: 50%;
    top: calc(100% + 1px);
  }
  .port.left {
    left: -1px;
    top: 50%;
  }
  .card :global(.anchor) {
    visibility: hidden;
  }
  @media (prefers-reduced-motion: reduce) {
    .port {
      transition: none;
    }
  }
</style>
